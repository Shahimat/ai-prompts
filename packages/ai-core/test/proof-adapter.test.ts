import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fixtureEnvironment } from './environment.ts';
import { PROOF_TRANSPORT } from '#lib/proof/transport';

let root: string;
const packageRoot = path.dirname(import.meta.dirname);
const require = createRequire(import.meta.url);
const guarded = (fixtureEnvironment(process.env)['NODE_OPTIONS'] ?? '').trim() !== '';

function expectWarm(result: ReturnType<typeof npm>): void {
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(
    `proof changelog lint: ${guarded ? 'executed' : 'baseline'} pass`,
  );
  expect(result.stdout).toContain(`registered executions=${guarded ? 1 : 0}`);
  expect(result.stdout.includes('baseline pass')).toBe(!guarded);
  expect(result.stdout).not.toContain('current-run pass');
}

beforeEach(async () => {
  const parent = path.join(import.meta.dirname, '.tmp');
  await mkdir(parent, { recursive: true });
  root = await mkdtemp(path.join(parent, 'proof-adapter-'));
  for (const file of [
    'lib/proof',
    'lib/local-store.ts',
    'lib/artifacts.ts',
    'registry.ts',
    'shared/args.ts',
    'shared/proof.ts',
    'shared/guards.ts',
    'shared/config.ts',
    'shared/diagnostics.ts',
    'shared/report.ts',
    'shared/layout.ts',
    'shared/frontmatter.ts',
    'commands/changelog/index.ts',
    'commands/changelog/lint.ts',
  ]) {
    const target = path.join(root, 'packages/ai-core/src', file);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(packageRoot, 'src', file), target, { recursive: true });
  }
  await cp(
    path.join(packageRoot, 'package.json'),
    path.join(root, 'packages/ai-core/package.json'),
  );
  await cp(
    path.dirname(require.resolve('yaml/package.json')),
    path.join(root, 'node_modules/yaml'),
    { recursive: true },
  );
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      scripts: {
        check: 'node --conditions=source driver.mjs',
        instrumented: 'node --conditions=source --import ./loader.mjs driver.mjs --loader-mutation',
      },
    }),
  );
  await writeFile(path.join(root, 'loader.mjs'), 'export const syntheticLoader = 1;\n');
  await writeFile(
    path.join(root, 'CHANGELOG.md'),
    '- 2025-01-01 · [arch] synthetic · synthetic reason\n',
  );
  await writeFile(
    path.join(root, 'driver.mjs'),
    `import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {runChangelog} from './packages/ai-core/src/commands/changelog/index.ts';
import {runRegisteredCommand} from './packages/ai-core/src/lib/proof/adapter.ts';
import {beginProofRun} from './packages/ai-core/src/lib/proof/transport.ts';
let launches=0;
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) childProcess[name]=()=>{launches++;throw new Error('unexpected child/agent launch')};
syncBuiltinESMExports();
const root=process.cwd();
const run=await beginProofRun(root,{owner:'synthetic',scope:['*'],force:process.argv.includes('--force'),allowJudge:false});
const args={root,now:new Date('2026-01-01'),proofRun:run};
let checkerCalls=0;
const checker=()=>{checkerCalls++;return runChangelog('lint',args)};
const inheritedNodeOptions=process.env.NODE_OPTIONS;
if(process.argv.includes('--unknown-env')) process.env.NODE_OPTIONS=[inheritedNodeOptions,'--no-warnings'].filter(value=>value!==undefined).join(' ');
let calls=0;
const raw=async()=>{calls++;return 0};
let code=await runRegisteredCommand(['changelog','lint'],args,checker);
if(process.argv.includes('--twice')) code=Math.max(code,await runRegisteredCommand(['changelog','lint'],args,checker));
if(process.argv.includes('--generation-mutation')) {
 const file='packages/ai-core/src/commands/changelog/lint.ts';
 const source=await readFile(file,'utf8');
 const changed=source.replace('const diags: Diagnostic[] = [];',"const diags: Diagnostic[] = [{file,message:'synthetic changed checker'}];");
 if(changed===source) throw new Error('checker mutation did not apply');
 await writeFile(file,changed);
 console.log('old callback outcome='+await runChangelog('lint',args));
 const next=await beginProofRun(root,{owner:'synthetic',scope:['*'],force:false,allowJudge:false});
 code=await runRegisteredCommand(['changelog','lint'],{...args,proofRun:next},checker);
}
if(process.argv.includes('--loader-mutation') || process.argv.includes('--unknown-env')) {
 if(process.argv.includes('--loader-mutation')) await writeFile('loader.mjs','export const syntheticLoader = 2;');
 else process.env.NODE_OPTIONS=[inheritedNodeOptions,'--trace-warnings'].filter(value=>value!==undefined).join(' ');
 code=await runRegisteredCommand(['changelog','lint'],args,checker);
}
if(process.argv.includes('--unknown')){await runRegisteredCommand(['unknown'],args,raw);console.log('unknown executions='+calls)}
console.log('child/agent launches='+launches+' allowJudge='+run.allowJudge);
console.log('registered executions='+checkerCalls);
if(launches!==0) throw new Error('unexpected launch');
process.exitCode=code;`,
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function npm(...args: string[]) {
  return npmScript('check', ...args);
}

function npmScript(script: string, ...args: string[]) {
  const executable = process.env['npm_execpath'];
  if (executable === undefined) throw new Error('Run adapter tests through npm test');
  const env = fixtureEnvironment(process.env);
  delete env[PROOF_TRANSPORT];
  return spawnSync(process.execPath, [executable, 'run', script, '--', ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
}

it('registered existing changelog script executes cold, reuses warm, bypasses on force and deduplicates current run through npm flags', () => {
  const cold = npm();
  expect(cold.status).toBe(0);
  expect(cold.stdout).toContain('proof changelog lint: executed pass');
  expect(cold.stdout).toContain('registered executions=1');
  expectWarm(npm());
  const force = npm('--force', '--twice');
  expect(force.status).toBe(guarded ? 1 : 0);
  expect(force.stdout.match(/changelog: ok/g)).toHaveLength(1);
  expect(force.stdout.match(/proof changelog lint: executed pass/g)).toHaveLength(1);
  expect(force.stdout).toContain(
    `proof changelog lint: ${guarded ? 'executed stale' : 'current-run pass'}`,
  );
  expect(force.stdout).toContain('registered executions=1');
  expect(force.stdout).not.toContain('baseline pass');
  expect(force.stdout.includes('current-run pass')).toBe(!guarded);
  expect(force.stdout).toContain('child/agent launches=0 allowJudge=false');
});

it.each([
  'packages/ai-core/src/commands/changelog/lint.ts',
  'packages/ai-core/src/shared/frontmatter.ts',
  'node_modules/yaml/dist/index.js',
])(
  'registered adapter invalidates %s and leaves unrelated content reusable',
  async (file) => {
    expect(npm().status).toBe(0);
    await writeFile(path.join(root, 'unrelated'), 'unrelated');
    expectWarm(npm());
    await writeFile(path.join(root, file), `${await readFile(path.join(root, file), 'utf8')}\n`);
    const changed = npm();
    expect(changed.status).toBe(0);
    expect(changed.stdout).toContain('executed pass');
    expect(changed.stdout).toContain('registered executions=1');
    expect(changed.stdout).not.toContain('baseline pass');
    expectWarm(npm());
  },
  30000,
);

it('registered adapter invalidates effective config/content and retains current failure', async () => {
  expect(npm().status).toBe(0);
  await mkdir(path.join(root, '.oc3'), { recursive: true });
  await writeFile(
    path.join(root, '.oc3/ai-core.yml'),
    'checks:\n  changelog:\n    tags: [arch]\n    max_line: 200\n',
  );
  const configured = npm();
  expect(configured.status).toBe(0);
  expect(configured.stdout).toContain('executed pass');
  await writeFile(path.join(root, 'CHANGELOG.md'), '- malformed\n');
  const failure = npm('--twice');
  expect(failure.status).not.toBe(0);
  expect(failure.stdout).not.toContain('baseline pass');
  expect(failure.stdout.match(/proof changelog lint: executed fail/g)).toHaveLength(1);
  expect(failure.stdout).toContain(
    `proof changelog lint: ${guarded ? 'executed stale' : 'current-run fail'}`,
  );
  expect(failure.stdout).toContain('registered executions=1');
  expect(failure.stdout.includes('current-run fail')).toBe(!guarded);
});

it('unknown command remains explicitly run-only and never calls a provider', () => {
  const result = npm('--unknown');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('run-only (unmodelled command/effects)');
  expect(result.stdout).toContain('unknown executions=1');
  expect(result.stdout).toContain('child/agent launches=0 allowJudge=false');
});

it('loaded checker generation cannot certify new disk bytes in a long-lived registered process', async () => {
  const result = npm('--generation-mutation');
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('old callback outcome=0');
  expect(result.stdout).toContain('proof changelog lint: executed stale');
  expect(result.stdout).toContain('registered executions=1');
  expect(result.stdout).toContain('child/agent launches=0 allowJudge=false');
  const fresh = npm();
  expect(fresh.status).toBe(1);
  expect(fresh.stdout).toContain('proof changelog lint: executed fail');
  expect(fresh.stdout).not.toContain('baseline pass');
});

it.each(['instrumented', 'unknown-env'])(
  '%s current compatibility is not inferred from identical partial manifests',
  (kind) => {
    const result = kind === 'instrumented' ? npmScript('instrumented') : npm('--unknown-env');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('proof changelog lint: executed pass');
    expect(result.stdout).toContain('proof changelog lint: executed stale');
    expect(result.stdout).not.toContain('current-run pass');
    expect(result.stdout).toContain('registered executions=1');
    expect(result.stdout).toContain('child/agent launches=0 allowJudge=false');
  },
);
