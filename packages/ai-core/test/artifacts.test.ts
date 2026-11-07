import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { publishProjectJson } from '#lib/local-store';
import {
  ARTIFACT_ROOTS,
  artifactPath,
  artifactKey,
  artifactRelative,
  artifactRetention,
  assertArtifactNamespace,
  entryKey,
  expectCacheFile,
  expectHelperDir,
  expectStateFile,
  normalizedProjectPath,
  machineArtifactPath,
  validateArtifactOutput,
} from '#lib/artifacts';
import { ENTRY_ENV, loadVerdicts, saveVerdicts } from '#lib/expect/verdicts';
import { main } from '@shahimat/cli';
import { historicalArtifactPath, migrateArtifacts } from '#lib/artifact-migration';
import { loadTaskPacket } from '#lib/task-gates';

let root: string;
it('migration rejects a deterministic temporary final symlink without reading or changing its target', async () => {
  await put('.ops/a/report.json', 'historical synthetic');
  await put('sentinel', 'unchanged');
  const to = '.oc3/reports/artifact-history/ops/a/report.json';
  const temp = artifactPath(root, {
    kind: 'lock',
    key: 'migration-tmp',
    name: createHash('sha256').update(to).digest('hex'),
  });
  await mkdir(path.dirname(temp), { recursive: true });
  await symlink(path.join(root, 'sentinel'), temp);
  await expect(migrateArtifacts(root)).rejects.toThrow('ARTIFACT_SYMLINK');
  expect(await readFile(path.join(root, 'sentinel'), 'utf8')).toBe('unchanged');
  expect(await readFile(path.join(root, '.ops/a/report.json'), 'utf8')).toBe(
    'historical synthetic',
  );
});
function invoke(fn: (...args: never[]) => unknown, args: unknown[]): void {
  Reflect.apply(fn, undefined, args);
}
it('public JS and Reflect reject unsupported kinds and malformed identities without coercion', () => {
  const bad = ['unknown', '__proto__', 'constructor', 'toString', 1, null, {}, ['run']];
  for (const kind of bad) {
    for (const fn of [artifactRelative, artifactPath]) {
      const args =
        fn === artifactRelative ? [{ kind, key: 'probe' }] : [root, { kind, key: 'probe' }];
      expect(() => invoke(fn, args)).toThrow('ARTIFACT_KIND_INVALID');
    }
    expect(() => invoke(validateArtifactOutput, [root, 'undefined/probe/file.json', kind])).toThrow(
      'ARTIFACT_KIND_INVALID',
    );
  }
  for (const identity of [
    null,
    [],
    {},
    Object.create({ kind: 'run', key: 'probe' }),
    { kind: 'run', key: { toString: () => 'probe' } },
    { kind: 'run', key: 123 },
    { kind: 'run', key: 'probe', name: 1 },
    Object.assign(Object.create({ name: 'file' }), { kind: 'run', key: 'probe' }),
  ]) {
    expect(() => invoke(artifactRelative, [identity])).toThrow();
    expect(() => invoke(artifactPath, [root, identity])).toThrow();
  }
  for (const value of [123, null, {}, ['probe']]) {
    expect(() => invoke(artifactKey, [value])).toThrow();
    expect(() => invoke(normalizedProjectPath, [value])).toThrow();
    expect(() => invoke(artifactPath, [value, { kind: 'run', key: 'probe' }])).toThrow();
  }
  for (const scope of [
    null,
    {},
    { kind: 'project', home: root },
    Object.create({ kind: 'machine', home: root }),
    { kind: 'machine', home: 123 },
  ])
    expect(() => invoke(machineArtifactPath, [scope, 'ops/probe'])).toThrow();
  expect(Object.isFrozen(ARTIFACT_ROOTS)).toBe(true);
  expect(Reflect.set(ARTIFACT_ROOTS, 'unknown', 'undefined')).toBe(false);
});
it('compiled public JS rejects the retained D1 inputs', () => {
  const script = `import { artifactRelative, artifactPath, validateArtifactOutput } from './dist/index.js';
  for (const kind of ['unknown','__proto__','constructor','toString',1,null,{},['run']]) {
    for (const [fn,args] of [[artifactRelative,[{kind,key:'probe'}]],[artifactPath,[process.argv[1],{kind,key:'probe'}]],[validateArtifactOutput,[process.argv[1],'undefined/probe/file.json',kind]]]) {
      let rejected=false; try { Reflect.apply(fn,undefined,args); } catch { rejected=true; }
      if (!rejected) throw Error('accepted malformed kind');
    }
  }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, root], {
    encoding: 'utf8',
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
async function put(file: string, text: string) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'artifact-layout-'));
});
afterEach(async () => {
  delete process.env[ENTRY_ENV];
  delete process.env['HARNESS_EXPECT_ROOT'];
  await rm(root, { recursive: true, force: true });
});
it('every typed writer destination stays confined and publication denies arbitrary external/source output', async () => {
  for (const base of Object.values(ARTIFACT_ROOTS)) {
    const file = `${base}/synthetic/proof.json`;
    await publishProjectJson(root, file, { synthetic: true });
    expect(JSON.parse(await readFile(validateArtifactOutput(root, file), 'utf8'))).toEqual({
      synthetic: true,
    });
  }
  await expect(publishProjectJson(root, 'arbitrary-external/proof.json', {})).rejects.toThrow(
    'ARTIFACT_NAMESPACE',
  );
  await expect(publishProjectJson(root, '.oc3/knowledge/canonical.yml', {})).rejects.toThrow(
    'ARTIFACT_NAMESPACE',
  );
  expect(artifactRetention('.oc3/reports/synthetic/proof.json')).toBe('local');
  expect(artifactRetention('.oc3/verdicts/expect/entry/verdicts.json')).toBe('versioned');
  expect(artifactRetention('.oc3/inbox/knowledge/project.json')).toBe('versioned');
});
it('semantic store is isolated by normalized entry and retains the other entry on reset', async () => {
  process.env['HARNESS_EXPECT_ROOT'] = root;
  process.env[ENTRY_ENV] = 'a/index.expect.ts';
  await saveVerdicts({
    verdicts: {},
    lint: { a: { titles: 'synthetic-a', contradictions: [], unmeasurable: [], at: 'synthetic' } },
  });
  process.env[ENTRY_ENV] = 'b/index.expect.ts';
  expect(await loadVerdicts()).toEqual({ verdicts: {}, lint: {} });
  await saveVerdicts({ verdicts: {}, lint: {} });
  process.env[ENTRY_ENV] = './a\\index.expect.ts';
  expect((await loadVerdicts()).lint['a']?.titles).toBe('synthetic-a');
});
it('real CLI denies manual external output before a model spawn and CI tree sees external artifacts', async () => {
  await expect(
    main(['role', 'run', 'judge', '--file', 'task.md', '--out', 'elsewhere.json', '--root', root]),
  ).rejects.toThrow('ARTIFACT_NAMESPACE');
  await put('.ops/forbidden/proof.json', '{"synthetic":true}');
  expect(await main(['tree', 'check', '--root', root])).toBe(1);
});
it.each([
  '../outside',
  '/tmp/export',
  'C:\\export',
  '.oc3/reports/../../outside',
  '.oc3//reports/x',
  '\\\\server\\share',
])('rejects absolute/traversal/ambiguous path %s', (file) => {
  expect(() => validateArtifactOutput(root, file)).toThrow();
});
it('normalizes entry separators/segments and isolates same-basename entries', () => {
  expect(entryKey('./a\\index.expect.ts')).toBe(entryKey('a/index.expect.ts'));
  expect(entryKey('a/index.expect.ts')).not.toBe(entryKey('b/index.expect.ts'));
  expect(expectCacheFile('a/index.expect.ts')).toContain('.oc3/verdicts/expect/');
  expect(expectHelperDir('a/index.expect.ts')).toContain('.oc3/reports/expect/');
  expect(expectStateFile('a/index.expect.ts')).toContain('/state.json');
  expect(expectStateFile('.oc3/goals/a.expect.ts')).toBe('.oc3/goals/a.expect.json');
  expect(normalizedProjectPath('.oc3\\reports\\x')).toBe('.oc3/reports/x');
});
it('rejects kind confusion, ticket traversal, foreign scope, symlink ancestors and final targets', async () => {
  expect(() => artifactRelative({ kind: 'run', key: '../outside' })).toThrow();
  expect(() => validateArtifactOutput(root, '.oc3/knowledge/canonical.yml')).toThrow(
    'ARTIFACT_NAMESPACE',
  );
  expect(() => validateArtifactOutput(root, '.oc3/reports/a/x', 'expect-cache')).toThrow(
    'ARTIFACT_NAMESPACE',
  );
  expect(() =>
    artifactPath(root, { kind: 'run', key: 'a' }, { root: tmpdir(), worktree: root }),
  ).toThrow('ARTIFACT_SCOPE_MISMATCH');
  await mkdir(path.join(root, '.oc3'), { recursive: true });
  await symlink(tmpdir(), path.join(root, '.oc3/reports'));
  expect(() => artifactPath(root, { kind: 'run', key: 'a' })).toThrow('ARTIFACT_SYMLINK');
  await rm(path.join(root, '.oc3/reports'));
  await mkdir(path.join(root, '.oc3/reports'), { recursive: true });
  await symlink(path.join(root, 'missing'), path.join(root, '.oc3/reports/a'));
  expect(() => artifactPath(root, { kind: 'run', key: 'a' })).toThrow('ARTIFACT_SYMLINK');
});
it.each([
  '.ops/run/proof.json',
  'else/.judge/plan.json',
  'else/.verdicts.json',
  '.opencode/artifacts/bridge.json',
  'else/a.expect.json',
])('namespace cannot be authorized by source classification: %s', (file) => {
  expect(() => assertArtifactNamespace(root, file)).toThrow('ARTIFACT_NAMESPACE');
});
it('packet location is independently confined before schema/classification', async () => {
  await put('elsewhere.json', '{}');
  await expect(loadTaskPacket(root, 'elsewhere.json')).rejects.toThrow('ARTIFACT_NAMESPACE');
});
it('migration moves actual legacy bytes, records readonly provenance and is idempotent', async () => {
  await put('.ops/knowledge-inbox/checks/full.json', '{"historical":"unchanged"}\n');
  await put('.ops/project-role-models/reports/code.md', 'historical models report\n');
  await put('expectations/index.expect.ts', 'synthetic expectation source');
  await put('expectations/.verdicts.json', '{"verdicts":{},"lint":{}}\n');
  await put('expectations/.judge/plan.json', '{"historical_plan":true}');
  await put('expectations/index.expect.json', '{"results":[{"pass":true}]}');
  await put('.opencode/artifacts/plan-review/bridge.json', '{"historical_bridge":true}');
  spawnSync('git', ['init', '-q'], { cwd: root });
  const result = await migrateArtifacts(root);
  expect(result.moved).toBe(6);
  const alias = await historicalArtifactPath(root, '.ops/knowledge-inbox/checks/full.json');
  expect(await readFile(alias, 'utf8')).toBe('{"historical":"unchanged"}\n');
  await expect(
    readFile(path.join(root, '.ops/knowledge-inbox/checks/full.json')),
  ).rejects.toThrow();
  expect((await migrateArtifacts(root)).moved).toBe(0);
  expect(
    await readFile(path.join(root, expectCacheFile('expectations/index.expect.ts')), 'utf8'),
  ).toBe('{"verdicts":{},"lint":{}}\n');
  await writeFile(
    path.join(root, expectCacheFile('expectations/index.expect.ts')),
    '{"new_semantic_store":true}',
  );
  expect(
    await readFile(await historicalArtifactPath(root, 'expectations/.verdicts.json'), 'utf8'),
  ).toBe('{"verdicts":{},"lint":{}}\n');
  expect((await migrateArtifacts(root)).moved).toBe(0);
  await writeFile(alias, 'tampered');
  await expect(
    historicalArtifactPath(root, '.ops/knowledge-inbox/checks/full.json'),
  ).rejects.toThrow('MIGRATION_ALIAS_HASH');
});
it('migration collision does not remove sources or overwrite unrelated files', async () => {
  await put('.ops/a/report.json', 'original');
  await put('.oc3/reports/artifact-history/ops/a/report.json', 'foreign');
  await expect(migrateArtifacts(root)).rejects.toThrow('MIGRATION_COLLISION');
  expect(await readFile(path.join(root, '.ops/a/report.json'), 'utf8')).toBe('original');
  expect(
    await readFile(path.join(root, '.oc3/reports/artifact-history/ops/a/report.json'), 'utf8'),
  ).toBe('foreign');
});
it('migration preserves original expectation sources even beside the legacy bridge', async () => {
  await put('.opencode/artifacts/plan-review/demo.expect.ts', 'synthetic original source');
  await put('.opencode/artifacts/plan-review/bridge.json', '{"historical_bridge":true}');
  expect((await migrateArtifacts(root)).moved).toBe(1);
  expect(
    await readFile(path.join(root, '.opencode/artifacts/plan-review/demo.expect.ts'), 'utf8'),
  ).toBe('synthetic original source');
  expect(() =>
    assertArtifactNamespace(root, '.opencode/artifacts/plan-review/demo.expect.ts'),
  ).not.toThrow();
  await expect(
    publishProjectJson(root, '.opencode/artifacts/plan-review/demo.expect.ts', { forbidden: true }),
  ).rejects.toThrow('ARTIFACT_NAMESPACE');
});
it('retry after a post-publication failure preserves both history and pending source', async () => {
  await put('.ops/a/proof.json', 'original-a');
  await put('.ops/b/proof.json', 'original-b');
  const module = pathToFileURL(
    path.join(path.dirname(import.meta.dirname), 'src/lib/artifact-migration.ts'),
  ).href;
  const script = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';const rm=fs.rm;fs.rm=async(file,...args)=>{if(String(file).endsWith('/.ops/b/proof.json'))throw new Error('synthetic failure');return rm(file,...args)};syncBuiltinESMExports();const{migrateArtifacts}=await import(${JSON.stringify(module)});try{await migrateArtifacts(${JSON.stringify(root)});process.exitCode=4}catch(e){process.exitCode=e.message.includes('synthetic failure')?0:5}`;
  const result = spawnSync(
    process.execPath,
    ['--conditions=source', '--input-type=module', '-e', script],
    { encoding: 'utf8' },
  );
  expect(result.status).toBe(0);
  expect(await readFile(path.join(root, '.ops/b/proof.json'), 'utf8')).toBe('original-b');
  expect((await migrateArtifacts(root)).retained).toBe(2);
  expect(await readFile(await historicalArtifactPath(root, '.ops/a/proof.json'), 'utf8')).toBe(
    'original-a',
  );
  expect(await readFile(await historicalArtifactPath(root, '.ops/b/proof.json'), 'utf8')).toBe(
    'original-b',
  );
});
it('migration prunes a wholly empty legacy tree and retry is a no-op', async () => {
  await mkdir(path.join(root, '.ops/knowledge-inbox/checks'), { recursive: true });
  await mkdir(path.join(root, '.ops/project-role-models/verdicts'), { recursive: true });
  const first = await migrateArtifacts(root);
  expect(first.moved).toBe(0);
  expect(first.pruned).toContain('.ops');
  await expect(readdir(path.join(root, '.ops'))).rejects.toThrow();
  expect((await migrateArtifacts(root)).pruned).toEqual([]);
});
it('nonrecursive prune preserves a concurrent source collision and is retry-safe', async () => {
  await mkdir(path.join(root, '.ops/empty'), { recursive: true });
  const module = pathToFileURL(
    path.join(path.dirname(import.meta.dirname), 'src/lib/artifact-migration.ts'),
  ).href;
  const script = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';const rmdir=fs.rmdir;fs.rmdir=async(file,...args)=>{if(String(file).endsWith('/.ops'))await fs.writeFile(String(file)+'/concurrent.expect.ts','synthetic concurrent source');return rmdir(file,...args)};syncBuiltinESMExports();const{migrateArtifacts}=await import(${JSON.stringify(module)});await migrateArtifacts(${JSON.stringify(root)});`;
  expect(
    spawnSync(process.execPath, ['--conditions=source', '--input-type=module', '-e', script], {
      encoding: 'utf8',
    }).status,
  ).toBe(0);
  expect(await readFile(path.join(root, '.ops/concurrent.expect.ts'), 'utf8')).toBe(
    'synthetic concurrent source',
  );
  expect((await migrateArtifacts(root)).pruned).toEqual([]);
  expect(await readFile(path.join(root, '.ops/concurrent.expect.ts'), 'utf8')).toBe(
    'synthetic concurrent source',
  );
});
