import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { artifactPath } from '#lib/artifacts';
import { ordinaryDeclaration, BOUNDED_TEST } from '#lib/proof/ordinary';
import { PROOF_TRANSPORT } from '#lib/proof/transport';
import { testArguments } from '#lib/proof/options';
import { fixtureEnvironment } from './environment.ts';
import { isRecord } from '#shared/guards';

const project = path.resolve(import.meta.dirname, '..', '..', '..');
const originalPackage = path.join(project, 'packages/ai-core');
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('rejects unsupported producer/npm flags without forwarding them as Vitest permission', () => {
  expect(testArguments([BOUNDED_TEST, '--force'])).toEqual({ force: true, argv: [BOUNDED_TEST] });
  for (const flag of ['--run', '--apply', '--force=true', '--unknown'])
    expect(() => testArguments([flag])).toThrow('unsupported');
});

it('real bounded Vitest leaf executes cold/warm/force, invalidates real mutations and deduplicates authenticated current results', async () => {
  const parent = artifactPath(project, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: 'fixtures',
  });
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'ordinary-'));
  roots.push(root);
  const packageRoot = path.join(root, 'packages/ai-core');
  const declaration = await ordinaryDeclaration(project, originalPackage);
  for (const directory of declaration.membership ?? []) {
    await mkdir(path.dirname(path.join(root, directory)), { recursive: true });
    await cp(path.join(project, directory), path.join(root, directory), { recursive: true });
  }
  for (const file of [
    'package.json',
    'package-lock.json',
    'tsconfig.base.json',
    'scripts/verification.ts',
  ]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await cp(path.join(project, file), path.join(root, file));
  }
  await mkdir(packageRoot, { recursive: true });
  for (const file of [
    'src',
    'package.json',
    'tsconfig.json',
    'vitest.bounded.config.ts',
    BOUNDED_TEST,
  ]) {
    await mkdir(path.dirname(path.join(packageRoot, file)), { recursive: true });
    await cp(path.join(originalPackage, file), path.join(packageRoot, file), { recursive: true });
  }
  await mkdir(path.join(root, 'node_modules/@shahimat'), { recursive: true });
  await symlink(packageRoot, path.join(root, 'node_modules/@shahimat/ai-core'));
  const require = createRequire(path.join(originalPackage, 'package.json'));
  await cp(
    path.dirname(require.resolve('typescript/package.json')),
    path.join(root, 'node_modules/typescript'),
    { recursive: true },
  );
  await symlink(
    path.dirname(require.resolve('ajv/package.json')),
    path.join(root, 'node_modules/ajv'),
  );
  await writeFile(
    path.join(packageRoot, 'vitest.config.ts'),
    `import {defineConfig} from 'vitest/config';
export default defineConfig({envDir:false,resolve:{conditions:['source']},ssr:{resolve:{conditions:['source'],externalConditions:['source']}},test:{include:['${BOUNDED_TEST}','test/fallback-remainder.test.ts'],reporters:['verbose']}});`,
  );
  const npmFile = path.join(packageRoot, 'src/lib/proof/npm.ts');
  const npmSource = await readFile(npmFile, 'utf8');
  const instrumented = npmSource.replace(
    'const child = spawn(',
    "console.log('BOUNDARY_VITEST_LAUNCH');\n    const child = spawn(",
  );
  expect(instrumented).not.toBe(npmSource);
  await writeFile(npmFile, instrumented);
  const env = fixtureEnvironment(process.env);
  delete env[PROOF_TRANSPORT];
  const agentLog = path.join(root, 'agent-attempts.jsonl');
  const forbiddenAgent = path.join(root, 'forbidden-agent.mjs');
  await writeFile(
    forbiddenAgent,
    `import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(agentLog)},'attempt\\n');process.exit(97);`,
  );
  env['HARNESS_OPENCODE'] = forbiddenAgent;
  const records: { name: string; code: number | null; stdout: string; stderr: string }[] = [];
  const fallbackObservations: { name: string; code: number | null; remainderExecutions: number }[] =
    [];
  const output = artifactPath(project, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: `checks/ordinary-counters-b-v2-${randomUUID()}.json`,
  });
  await mkdir(path.dirname(output), { recursive: true });
  const native = (
    name: string,
    flags: string[] = [],
    file = 'src/lib/proof/npm.ts',
    scope = [BOUNDED_TEST],
  ) => {
    const result = spawnSync(
      process.execPath,
      ['--conditions=source', file, ...(file.endsWith('npm.ts') ? scope : []), ...flags],
      { cwd: packageRoot, env, encoding: 'utf8', timeout: 60000 },
    );
    records.push({ name, code: result.status, stdout: result.stdout, stderr: result.stderr });
    writeFileSync(output, JSON.stringify({ records, fallbackObservations }, null, 2));
    return result;
  };
  const cold = native('cold');
  const guarded = process.env['NODE_OPTIONS'] !== undefined;
  expect(cold.status).toBe(0);
  expect(cold.stdout).toContain('BOUNDARY_VITEST_LAUNCH');
  const warm = native('warm');
  expect(warm.status).toBe(0);
  expect(warm.stdout.includes('baseline pass')).toBe(!guarded);
  expect(warm.stdout.includes('BOUNDARY_VITEST_LAUNCH')).toBe(guarded);
  const forced = native('force', ['--force']);
  expect(forced.status).toBe(0);
  expect(forced.stdout.match(/BOUNDARY_VITEST_LAUNCH/g)).toHaveLength(1);
  await writeFile(
    path.join(packageRoot, 'driver.mjs'),
    `import {spawnSync} from 'node:child_process';
import {beginProofRun,proofRunEnvironment} from './src/lib/proof/transport.ts';
const root=new URL('../../',import.meta.url).pathname;
const run=await beginProofRun(root,{owner:'synthetic',scope:['*'],force:true,allowJudge:false});
for(let i=0;i<2;i++){const result=spawnSync(process.execPath,['--conditions=source','src/lib/proof/npm.ts','${BOUNDED_TEST}'],{cwd:process.cwd(),env:proofRunEnvironment(run),encoding:'utf8'});process.stdout.write(result.stdout);process.stderr.write(result.stderr);console.log('child exit='+result.status);}`,
  );
  const current = native('current', [], 'driver.mjs');
  expect(current.status).toBe(0);
  expect(current.stdout.match(/BOUNDARY_VITEST_LAUNCH/g)).toHaveLength(1);
  expect(current.stdout.includes('current-run pass')).toBe(!guarded);
  expect(current.stdout).toContain('child exit=0');
  expect(current.stdout).toContain(`child exit=${guarded ? 1 : 0}`);
  await writeFile(
    path.join(packageRoot, 'test/fallback-remainder.test.ts'),
    `import {it,expect} from 'vitest';
it('executes the default remainder',()=>{console.log('B1_DEFAULT_REMAINDER_EXECUTED');expect(2+2).toBe(4);});`,
  );
  const modeledDefault = native('default-modeled-profile', [], 'src/lib/proof/npm.ts', []);
  expect(modeledDefault.status).toBe(0);
  expect(modeledDefault.stdout).toContain('B1_DEFAULT_REMAINDER_EXECUTED');
  expect(modeledDefault.stdout.includes('bounded-guards: baseline pass')).toBe(!guarded);
  expect(modeledDefault.stdout.match(/BOUNDARY_VITEST_LAUNCH/g)).toHaveLength(1);
  await writeFile(
    path.join(packageRoot, 'wrapper-driver.mjs'),
    `import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {joinProofRun,PROOF_TRANSPORT} from './src/lib/proof/transport.ts';
const root=new URL('../../',import.meta.url).pathname;
const calls=[];
childProcess.spawn=(command,args,options)=>{const child=new EventEmitter();queueMicrotask(async()=>{const run=await joinProofRun(root,options.env[PROOF_TRANSPORT]);calls.push({command,args,run:run.id,force:run.force,allowJudge:run.allowJudge});child.emit('close',0)});return child};
syncBuiltinESMExports();
await import('../../scripts/verification.ts');
console.log('WRAPPER_MATRIX='+JSON.stringify(calls));`,
  );
  const ci = native('npm-ci-force-conformance', ['ci', '--force'], 'wrapper-driver.mjs');
  expect(ci.status).toBe(0);
  expect(ci.stdout).toContain('"force":true,"allowJudge":false');
  expect(ci.stdout).toContain('"args":["run","expect"]');
  expect(ci.stdout).not.toContain('"--force"');
  const matrix: unknown = JSON.parse(
    ci.stdout
      .split('\n')
      .find((line) => line.startsWith('WRAPPER_MATRIX='))
      ?.slice('WRAPPER_MATRIX='.length) ?? 'null',
  );
  if (!Array.isArray(matrix) || !matrix.every(isRecord))
    throw new Error('missing authenticated wrapper matrix');
  expect(new Set(matrix.map((item) => item['run'])).size).toBe(1);
  const test = native(
    'npm-test-force-conformance',
    ['test', '--force', BOUNDED_TEST],
    'wrapper-driver.mjs',
  );
  expect(test.status).toBe(0);
  expect(test.stdout).toContain(
    '"args":["test","-w","@shahimat/ai-core","--","test/bounded-guards.test.ts"]',
  );
  expect(test.stdout).not.toContain('"--force"');
  const unsupported = native('npm-ci-unsupported', ['ci', '--run'], 'wrapper-driver.mjs');
  expect(unsupported.status).toBe(2);
  expect(unsupported.stdout).not.toContain('WRAPPER_MATRIX=');
  await writeFile(
    path.join(packageRoot, 'checker-driver.mjs'),
    `import {readFile,writeFile} from 'node:fs/promises';
import {titlePlan} from './src/lib/expect/title-proof.ts';
const producer={adapter:'controlled',complete:true,instructions:[],contract:'no tools',diagnostics:[]};
const plan=()=>titlePlan('sample.expect.ts',[{file:'sample.expect.ts',path:[],title:'one'}],producer);
const before=plan();
const observations=[];
for(const file of ['src/lib/expect/title-proof.ts','../../node_modules/typescript/lib/typescript.js','../../node_modules/yaml/dist/index.js']){const bytes=await readFile(file,'utf8');try{await writeFile(file,bytes+'\\n');const after=plan();observations.push({file,before:before.complete,after:after.complete,changed:before.policy!==after.policy});}finally{await writeFile(file,bytes)}}
console.log('CHECKER_NEGATIVES='+JSON.stringify(observations));
if(!observations.every(item=>item.before&&!item.after&&item.changed))process.exitCode=1;`,
  );
  const checker = native('loaded-checker-and-runtime-dependencies', [], 'checker-driver.mjs');
  expect(checker.status).toBe(0);
  expect(checker.stdout).toContain('"before":true,"after":false,"changed":true');
  const runtimeLog = path.join(root, '.oc3/reports/b1/runtime.jsonl');
  await mkdir(path.dirname(runtimeLog), { recursive: true });
  const remainderFile = path.join(packageRoot, 'test/fallback-remainder.test.ts');
  const remainderSource = `import {it,expect} from 'vitest';import {appendFileSync} from 'node:fs';
it('executes the runtime remainder with inherited guard',()=>{appendFileSync(${JSON.stringify(runtimeLog)},'remainder\\n');expect(process.env['OC3_B1_GUARD_ACTIVE']).toBe('yes');expect(2+2).toBe(4);});`;
  await writeFile(remainderFile, remainderSource);
  const guardFile = path.join(root, 'b1-guard.cjs');
  await writeFile(guardFile, "process.env['OC3_B1_GUARD_ACTIVE']='yes';");
  const inheritedOptions = env['NODE_OPTIONS'];
  env['NODE_OPTIONS'] = [
    inheritedOptions,
    '--no-warnings',
    `--require ${JSON.stringify(guardFile)}`,
  ]
    .filter((value) => value !== undefined)
    .join(' ');
  const runtimeExecutions = async () =>
    readFile(runtimeLog, 'utf8').then(
      (text) => text.trim().split('\n').length,
      (error) => {
        if (isRecord(error) && error['code'] === 'ENOENT') return 0;
        throw error;
      },
    );
  const defaultPass = native('guarded-default-pass', [], 'src/lib/proof/npm.ts', []);
  fallbackObservations.push({
    name: 'guarded-default-pass',
    code: defaultPass.status,
    remainderExecutions: await runtimeExecutions(),
  });
  writeFileSync(output, JSON.stringify({ records, fallbackObservations }, null, 2));
  expect(await runtimeExecutions()).toBe(1);
  expect(defaultPass.status).toBe(0);
  expect(defaultPass.stdout).toContain(BOUNDED_TEST);
  expect(defaultPass.stdout).toContain('fallback-remainder.test.ts');
  expect(defaultPass.stdout).not.toContain('baseline pass');
  expect(defaultPass.stdout).not.toContain('current-run pass');
  expect(defaultPass.stdout.match(/BOUNDARY_VITEST_LAUNCH/g)).toHaveLength(1);
  await writeFile(remainderFile, remainderSource.replace('toBe(4)', 'toBe(5)'));
  const defaultFail = native('guarded-default-fail', [], 'src/lib/proof/npm.ts', []);
  fallbackObservations.push({
    name: 'guarded-default-fail',
    code: defaultFail.status,
    remainderExecutions: await runtimeExecutions(),
  });
  expect(defaultFail.status).toBe(1);
  expect(defaultFail.stdout).toContain(BOUNDED_TEST);
  expect(defaultFail.stdout).toContain('fallback-remainder.test.ts');
  expect(await runtimeExecutions()).toBe(2);
  await writeFile(remainderFile, remainderSource);
  await writeFile(
    path.join(packageRoot, 'default-driver.mjs'),
    `import {spawnSync} from 'node:child_process';
import {beginProofRun,proofRunEnvironment} from './src/lib/proof/transport.ts';
const root=new URL('../../',import.meta.url).pathname;
const run=await beginProofRun(root,{owner:'synthetic',scope:['*'],force:true,allowJudge:false});
for(let i=0;i<2;i++){const result=spawnSync(process.execPath,['--conditions=source','src/lib/proof/npm.ts'],{cwd:process.cwd(),env:proofRunEnvironment(run),encoding:'utf8'});process.stdout.write(result.stdout);process.stderr.write(result.stderr);console.log('child exit='+result.status);}`,
  );
  const defaultCurrent = native('guarded-default-current', [], 'default-driver.mjs');
  fallbackObservations.push({
    name: 'guarded-default-current',
    code: defaultCurrent.status,
    remainderExecutions: await runtimeExecutions(),
  });
  expect(defaultCurrent.stdout.match(/BOUNDARY_VITEST_LAUNCH/g)).toHaveLength(1);
  expect(defaultCurrent.stdout).toContain('child exit=0');
  expect(defaultCurrent.stdout).toContain('child exit=1');
  expect(defaultCurrent.stdout).toContain('stale');
  expect(defaultCurrent.stdout).not.toContain('current-run pass');
  expect(await runtimeExecutions()).toBe(3);
  const unknownRuntime = native('unknown-inherited-runtime');
  expect(unknownRuntime.status).toBe(0);
  expect(unknownRuntime.stdout).not.toContain('baseline pass');
  expect(unknownRuntime.stdout).not.toContain('current-run pass');
  expect(unknownRuntime.stdout).toContain('run-only');
  const selectedCurrent = native('guarded-selected-current', [], 'driver.mjs');
  expect(selectedCurrent.stdout.match(/BOUNDARY_VITEST_LAUNCH/g)).toHaveLength(1);
  expect(selectedCurrent.stdout).toContain('child exit=0');
  expect(selectedCurrent.stdout).toContain('child exit=1');
  expect(selectedCurrent.stdout).toContain('stale');
  expect(selectedCurrent.stdout).not.toContain('current-run pass');
  expect(selectedCurrent.stdout).not.toContain('baseline pass');
  expect(await runtimeExecutions()).toBe(3);
  if (inheritedOptions === undefined) delete env['NODE_OPTIONS'];
  else env['NODE_OPTIONS'] = inheritedOptions;
  const boundedConfig = path.join(packageRoot, 'vitest.bounded.config.ts');
  const configSource = await readFile(boundedConfig, 'utf8');
  await writeFile(boundedConfig, `${configSource}\n`);
  const unreviewedConfig = native('unreviewed-bounded-config');
  expect(unreviewedConfig.status).toBe(0);
  expect(unreviewedConfig.stdout).not.toContain('baseline pass');
  expect(unreviewedConfig.stdout).not.toContain('current-run pass');
  expect(unreviewedConfig.stderr).toContain(
    guarded
      ? 'bounded eligibility unavailable: NODE_OPTIONS is defined'
      : 'unattested bounded source',
  );
  expect(unreviewedConfig.stdout.match(/BOUNDARY_VITEST_LAUNCH/g)).toHaveLength(1);
  await writeFile(boundedConfig, configSource);
  const helper = path.join(packageRoot, 'src/shared/guards.ts');
  const before = await readFile(helper, 'utf8');
  const mutated = before.replace(
    'values.some((v) => v === value)',
    'values.every((v) => v === value)',
  );
  expect(mutated).not.toBe(before);
  await writeFile(helper, mutated);
  const mutation = native('unattested-mutant');
  expect(mutation.status).toBe(1);
  expect(mutation.stdout).toContain('executed fail');
  expect(mutation.stderr).toContain(
    guarded
      ? 'bounded eligibility unavailable: NODE_OPTIONS is defined'
      : 'unattested bounded source',
  );
  expect(mutation.stdout).toContain('BOUNDARY_VITEST_LAUNCH');
  const incomplete = native('unattested-mutant-current', [], 'driver.mjs');
  expect(incomplete.stdout.match(/BOUNDARY_VITEST_LAUNCH/g)).toHaveLength(1);
  expect(incomplete.stdout).not.toContain('current-run fail');
  expect(incomplete.stdout).toContain('stale');
  expect(incomplete.stdout).toContain('executed 0');
  const adapter = path.join(packageRoot, 'src/lib/proof/ordinary.ts');
  const oldHash = createHash('sha256').update(before).digest('hex');
  const newHash = createHash('sha256').update(mutated).digest('hex');
  const adapterSource = await readFile(adapter, 'utf8');
  expect(adapterSource).toContain(oldHash);
  await writeFile(adapter, adapterSource.replace(oldHash, newHash));
  const modeledFailure = native('controlled-pure-mutant-current', [], 'driver.mjs');
  expect(modeledFailure.stdout.match(/BOUNDARY_VITEST_LAUNCH/g)).toHaveLength(1);
  expect(modeledFailure.stdout.includes('current-run fail')).toBe(!guarded);
  expect(modeledFailure.stdout).toContain('executed fail');
  const attempts = await readFile(agentLog, 'utf8').then(
    (text) => text.trim().split('\n').length,
    () => 0,
  );
  expect(attempts).toBe(0);
  await writeFile(
    output,
    JSON.stringify(
      {
        guarded,
        records,
        fallbackObservations,
        vitestExecutions: records.reduce(
          (count, item) => count + (item.stdout.match(/BOUNDARY_VITEST_LAUNCH/g)?.length ?? 0),
          0,
        ),
        configuredAgentBoundaryAttempts: attempts,
        scope:
          'native leaf instrumentation; wrapper stages intercepted only for conformance; actual production npm pretest checked separately',
      },
      null,
      2,
    ),
  );
  console.log(output);
}, 60000);
