import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { artifactPath } from '#lib/artifacts';
import { fixtureEnvironment } from './environment.ts';

it('defined runtime skips ineligible ordinary work but preserves actual opaque execution, failure, stale and root rejection', async () => {
  const project = path.resolve(import.meta.dirname, '..', '..', '..');
  const parent = artifactPath(project, {
    kind: 'run',
    key: 'incremental-verification-final',
    name: 'eligibility-fixtures',
  });
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'runtime-'));
  try {
    const pkg = path.join(root, 'packages/ai-core');
    const original = path.dirname(import.meta.dirname);
    for (const file of [
      'src/lib/proof',
      'src/shared',
      'src/lib/local-store.ts',
      'src/lib/artifacts.ts',
      'package.json',
    ]) {
      await mkdir(path.dirname(path.join(pkg, file)), { recursive: true });
      await cp(path.join(original, file), path.join(pkg, file), { recursive: true });
    }
    await writeFile(
      path.join(pkg, 'src/lib/proof/ordinary.ts'),
      "import {appendFileSync} from 'node:fs';export const BOUNDED_TEST='test/bounded-guards.test.ts';export const BOUNDED_CONFIG='vitest.bounded.config.ts';export async function ordinaryDeclaration(){appendFileSync('forbidden-attestation','called');throw new Error('unexpected ineligible attestation');}",
    );
    await mkdir(path.join(pkg, 'test'));
    await writeFile(path.join(pkg, 'vitest.config.ts'), 'export default {};');
    await writeFile(path.join(root, 'package-lock.json'), '{}');
    await writeFile(path.join(root, 'package.json'), '{"type":"module","private":true}');
    const fake = path.join(root, 'node_modules/vitest');
    await mkdir(fake, { recursive: true });
    await writeFile(path.join(fake, 'package.json'), '{"name":"vitest","type":"module"}');
    await writeFile(
      path.join(fake, 'vitest.mjs'),
      "import {appendFileSync,readFileSync} from 'node:fs';appendFileSync('actual-executions.jsonl',JSON.stringify(process.argv.slice(2))+'\\n');process.exit(Number(readFileSync('exit-code','utf8')));",
    );
    await writeFile(
      path.join(pkg, 'driver.mjs'),
      `import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {beginProofRun,proofRunEnvironment} from './src/lib/proof/transport.ts';
const root=new URL('../../',import.meta.url).pathname;
const invoke=env=>spawnSync(process.execPath,['--conditions=source','src/lib/proof/npm.ts'],{cwd:process.cwd(),env,encoding:'utf8'});
const clean={...process.env};delete clean.OC3_PROOF_TRANSPORT;
writeFileSync('exit-code','0');assert.equal(invoke(clean).status,0);
writeFileSync('exit-code','1');assert.equal(invoke(clean).status,1);
const run=await beginProofRun(root,{owner:'synthetic',scope:['*'],force:false,allowJudge:false});
const first=invoke({...clean,...proofRunEnvironment(run)});const second=invoke({...clean,...proofRunEnvironment(run)});
assert.equal(first.status,1);assert.equal(second.status,1);assert.ok(second.stdout.includes('stale'));assert.ok(!second.stdout.includes('current-run'));
const foreign=root+'foreign';mkdirSync(foreign);const other=await beginProofRun(foreign,{owner:'synthetic',scope:['*'],force:false,allowJudge:false});
const rejected=invoke({...clean,...proofRunEnvironment(other)});assert.equal(rejected.status,1);assert.ok(rejected.stderr.includes('PROOF_TRANSPORT_REJECTED'));
const executions=readFileSync('actual-executions.jsonl','utf8').trim().split('\\n').map(line=>JSON.parse(line));assert.deepEqual(executions,[['run'],['run'],['run']]);
console.log('actual opaque executions=3; default scope preserved; stale reexecutions=0; foreign launches=0');`,
    );
    const env = fixtureEnvironment(process.env);
    env['NODE_OPTIONS'] = env['NODE_OPTIONS'] ?? '--no-warnings';
    const result = spawnSync(process.execPath, ['--conditions=source', 'driver.mjs'], {
      cwd: pkg,
      env,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'actual opaque executions=3; default scope preserved; stale reexecutions=0; foreign launches=0',
    );
    await expect(readFile(path.join(pkg, 'forbidden-attestation'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
