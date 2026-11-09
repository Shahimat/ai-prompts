import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { expectCacheFile, expectHelperDir, expectStateFile } from '#lib/artifacts';
import { idOf, COLLECT_ENV, SEEN_ENV } from '#lib/expect/pending';
import { shaOf } from '#lib/expect/evidence';
import { isRecord } from '#shared/guards';
import { fixtureEnvironment } from './environment.ts';
import { PROOF_TRANSPORT } from '#lib/proof/transport';
import { implementationContext } from '#lib/expect/proof';

const dist = (file: string): string => pathToFileURL(path.join(process.cwd(), 'dist', file)).href;
const compiledJudge: unknown = await import(dist('lib/expect/judge.js'));
const compiledVerdicts: unknown = await import(dist('lib/expect/verdicts.js'));
const compiledGoals: unknown = await import(dist('commands/goals/index.js'));
const compiledOpencode: unknown = await import(dist('lib/opencode.js'));
const compiledProof: unknown = await import(dist('lib/expect/proof.js'));
async function invoke(module: unknown, name: string, args: unknown[]): Promise<unknown> {
  if (!isRecord(module) || typeof module[name] !== 'function')
    throw new Error('missing compiled API');
  const result: unknown = Reflect.apply(module[name], undefined, args);
  return await result;
}
const entry = 'expectations/synthetic.expect.ts';
let base: string;
let root: string;
let foreign: string;
let helper: string;
let id: string;
async function put(relative: string, text: string): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}
async function unchanged(): Promise<void> {
  expect(await readFile(path.join(foreign, 'sentinel'), 'utf8')).toBe('unchanged');
  expect(await readdir(foreign)).toEqual(['sentinel']);
}
const judged = (): Promise<unknown> => invoke(compiledJudge, 'judged', [['input.md']]);
async function command(name: string, options: Record<string, unknown> = {}): Promise<unknown> {
  const env = fixtureEnvironment(process.env);
  delete env[PROOF_TRANSPORT];
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
let collections=0;
let forbidden=0;
const original=cp.spawnSync;
cp.spawnSync=(file,args,...rest)=>{
 if(file!==process.execPath || !args[0].endsWith('/vitest.mjs') || args[1]!=='run') {forbidden++; throw new Error('unexpected process launch');}
 collections++; return original(file,args,...rest);
};
for(const name of ['spawn','exec','execSync','execFile','execFileSync','fork']) cp[name]=()=>{forbidden++; throw new Error('unexpected provider/process launch')};
syncBuiltinESMExports();
const {runExpect}=await import(${JSON.stringify(dist('commands/expect/index.js'))});
try { const value=await runExpect(${JSON.stringify(name)}, {...${JSON.stringify({ root, params: { file: entry }, ...options })},now:new Date(0)}); console.log('RESULT='+JSON.stringify({value,collections,forbidden})); }
catch(error) { console.log('RESULT='+JSON.stringify({error:error.message,collections,forbidden})); }
`,
    ],
    { env, encoding: 'utf8', timeout: 60000 },
  );
  expect(result.status).toBe(0);
  const line = result.stdout.split('\n').find((text) => text.startsWith('RESULT='));
  if (line === undefined) throw new Error('missing compiled result');
  const value: unknown = JSON.parse(line.slice(7));
  if (!isRecord(value)) throw new Error('invalid compiled result');
  expect(value['forbidden']).toBe(0);
  expect(value['collections']).toBe(options['apply'] === true ? 0 : 1);
  if (typeof value['error'] === 'string') throw new Error(value['error']);
  return value['value'];
}
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'helper-leaves-'));
  root = path.join(base, 'project');
  foreign = path.join(base, 'foreign');
  await mkdir(root);
  await mkdir(foreign);
  await writeFile(path.join(foreign, 'sentinel'), 'unchanged');
  await put('input.md', 'synthetic evidence');
  await put('package.json', '{"name":"fixture","private":true,"type":"module"}');
  const modules = path.dirname(
    path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  );
  await symlink(modules, path.join(root, 'node_modules'));
  await put(
    entry,
    `import {it,expect} from 'vitest'; it(${JSON.stringify(expect.getState().currentTestName)},()=>expect(1).toBe(1));\n`,
  );
  helper = path.join(root, expectHelperDir(entry));
  vi.stubEnv('HARNESS_EXPECT_ROOT', root);
  vi.stubEnv('HARNESS_EXPECT_ENTRY', entry);
  vi.stubEnv(COLLECT_ENV, path.join(helper, 'pending'));
  vi.stubEnv(SEEN_ENV, path.join(helper, 'seen'));
  const context = await invoke(compiledProof, 'implementationContext', [
    root,
    entry,
    expect.getState().currentTestName ?? '',
    ['input.md'],
  ]);
  if (
    !isRecord(context) ||
    !isRecord(context['binding']) ||
    typeof context['binding']['criterion'] !== 'string'
  )
    throw new Error('missing binding');
  if (context['binding']['criterion'] === 'unresolved')
    throw new Error('unresolved fixture criterion');
  id = idOf(`${context['binding']['criterion']}:${expect.getState().currentTestName ?? ''}`, [
    'input.md',
  ]);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(base, { recursive: true, force: true });
});
it.each([
  { area: 'pending', suffix: '.json', target: 'missing' },
  { area: 'pending', suffix: '.json', target: 'sentinel' },
  { area: 'seen', suffix: '', target: 'missing' },
  { area: 'seen', suffix: '', target: 'sentinel' },
])(
  'compiled judged rejects pre-existing final symlink $area → $target',
  async ({ area, suffix, target }) => {
    await mkdir(path.join(helper, area), { recursive: true });
    await symlink(path.join(foreign, target), path.join(helper, area, `${id}${suffix}`));
    await expect(judged()).rejects.toThrow('ARTIFACT_SYMLINK');
    await unchanged();
  },
);
it.each(['pending', 'seen'])('compiled judged rejects parent symlink %s', async (area) => {
  await mkdir(helper, { recursive: true });
  await symlink(foreign, path.join(helper, area));
  await expect(judged()).rejects.toThrow('ARTIFACT_SYMLINK');
  await unchanged();
});
it('compiled judged normal collection preserves question/evidence and seen marker', async () => {
  await expect(judged()).resolves.toBeUndefined();
  const item: unknown = JSON.parse(
    await readFile(path.join(helper, 'pending', `${id}.json`), 'utf8'),
  );
  expect(item).toMatchObject({
    id,
    question: expect.getState().currentTestName,
    evidence: [{ ref: 'input.md', sha: shaOf('synthetic evidence'), bytes: 18 }],
  });
  if (!isRecord(item) || !isRecord(item['binding'])) throw new Error('missing v2 binding');
  expect(item['binding']['version']).toBe(2);
  expect(item['binding']['complete']).toBe(false);
  expect(item['source']).toBeTypeOf('string');
  expect(await readFile(path.join(helper, 'seen', id), 'utf8')).toBe('');
  await unchanged();
});
it.each([
  {
    freshness: 'legacy matching evidence needs review',
    hash: shaOf('synthetic evidence'),
    collected: true,
  },
  { freshness: 'stale', hash: 'old-hash', collected: true },
])('compiled judged retains $freshness cache semantics', async ({ hash, collected }) => {
  await invoke(compiledVerdicts, 'saveVerdicts', [
    {
      verdicts: {
        [id]: {
          question: expect.getState().currentTestName,
          evidence: { 'input.md': hash },
          verdict: true,
          ref: 'input.md',
          quote: 'synthetic evidence',
          reason: 'synthetic fixture',
          at: '1970-01-01',
        },
      },
      lint: {},
    },
  ]);
  await judged();
  expect(existsSync(path.join(helper, 'pending', `${id}.json`))).toBe(collected);
  expect(existsSync(path.join(helper, 'seen', id))).toBe(true);
  await unchanged();
});
it('compiled judged rejects foreign entry overrides without writing another entry', async () => {
  const peer = path.join(root, expectHelperDir('peer.expect.ts'), 'pending');
  vi.stubEnv(COLLECT_ENV, peer);
  await expect(judged()).rejects.toThrow('ARTIFACT_ENTRY_MISMATCH');
  expect(existsSync(peer)).toBe(false);
  await unchanged();
});
it.each(['loadVerdicts', 'saveVerdicts'])(
  'compiled semantic cache %s rejects a final symlink',
  async (name) => {
    const file = expectCacheFile(entry);
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await symlink(path.join(foreign, 'sentinel'), path.join(root, file));
    const args =
      name === 'loadVerdicts' ? [root, entry] : [{ verdicts: {}, lint: {} }, root, entry];
    await expect(invoke(compiledVerdicts, name, args)).rejects.toThrow('ARTIFACT_SYMLINK');
    await unchanged();
  },
);
it('compiled transcript writer rejects a final symlink before a process or model launch', async () => {
  await mkdir(helper, { recursive: true });
  const transcript = path.join(helper, 'transcript.jsonl');
  await symlink(path.join(foreign, 'sentinel'), transcript);
  await expect(
    invoke(compiledOpencode, 'spawnOpenCode', [{ cwd: root, out: '' }, { transcript }]),
  ).rejects.toThrow('ARTIFACT_SYMLINK');
  await unchanged();
});
it('source and compiled checker bindings differ without changing fixture inputs', async () => {
  const question = expect.getState().currentTestName;
  if (typeof question !== 'string') throw new Error('missing fixture question');
  const source = await implementationContext(root, entry, question, ['input.md']);
  const compiled = await invoke(compiledProof, 'implementationContext', [
    root,
    entry,
    question,
    ['input.md'],
  ]);
  if (!isRecord(compiled) || !isRecord(compiled['binding']))
    throw new Error('missing compiled binding');
  expect(compiled['generation']).toBe(source.generation);
  expect(compiled['source']).toBe(source.source);
  expect(compiled['binding']['criterion']).toBe(source.binding.criterion);
  expect(compiled['binding']['diagnostics']).toEqual(source.binding.diagnostics);
  expect(compiled['binding']['complete']).toBe(source.binding.complete);
  expect(compiled['binding']['policy']).not.toBe(source.binding.policy);
  expect(compiled['binding']['input']).not.toBe(source.binding.input);
});
it('compiled preparation publishes a current bound plan without an attested producer', async () => {
  expect(await command('judge')).toBe(1);
  const plan: unknown = JSON.parse(await readFile(path.join(helper, 'plan.json'), 'utf8'));
  if (
    !isRecord(plan) ||
    !isRecord(plan['bound']) ||
    !isRecord(plan['bound']['binding']) ||
    !isRecord(plan['bound']['generation'])
  )
    throw new Error('missing current plan');
  expect(plan['bound']['version']).toBe(2);
  expect(plan['bound']['binding']['entry']).toBe(entry);
  expect(plan['bound']['generation']['complete']).toBe(false);
  await expect(command('judge', { apply: true })).rejects.toThrow('INCOMPLETE_EXPECT_PRODUCER');
  await unchanged();
});
it.each(['pending/extra.json', 'seen/extra', 'seen', 'batch-1.md', 'lint-1.md', 'plan.json'])(
  'compiled helper prepare validates final %s at actual I/O',
  async (leaf) => {
    await put(
      entry,
      `import {it} from 'vitest';
import {mkdirSync,symlinkSync,rmSync} from 'node:fs'; import path from 'node:path';
import {judged} from ${JSON.stringify(dist('lib/expect/judge.js'))};
it('synthetic',async()=>{await judged(['input.md']); const file=${leaf === 'plan.json' ? JSON.stringify(path.join(helper, leaf)) : `path.join(path.dirname(process.env.HARNESS_EXPECT_COLLECT),${JSON.stringify(leaf)})`}; ${leaf === 'seen' ? 'rmSync(file,{recursive:true});' : ''} mkdirSync(path.dirname(file),{recursive:true}); symlinkSync(${JSON.stringify(path.join(foreign, 'sentinel'))},file);});\n`,
    );
    await expect(command('judge')).rejects.toThrow('ARTIFACT_SYMLINK');
    await unchanged();
  },
  60_000,
);
it.each(['plan.json', 'task.md', 'answer.json'])(
  'compiled helper apply validates final %s before reading',
  async (leaf) => {
    expect(await command('judge')).toBe(1);
    const planFile = path.join(helper, 'plan.json');
    const plan: unknown = JSON.parse(await readFile(planFile, 'utf8'));
    if (
      !isRecord(plan) ||
      !Array.isArray(plan['lint']) ||
      !isRecord(plan['lint'][0]) ||
      !isRecord(plan['bound'])
    )
      throw new Error('missing current plan');
    expect(plan['bound']['version']).toBe(2);
    const target =
      leaf === 'plan.json' ? planFile : plan['lint'][0][leaf === 'task.md' ? 'task' : 'answer'];
    if (typeof target !== 'string') throw new Error('missing current task path');
    const file = leaf === 'plan.json' ? target : path.join(root, target);
    await rm(file, { force: true });
    await symlink(path.join(foreign, 'sentinel'), file);
    await expect(command('judge', { apply: true })).rejects.toThrow('ARTIFACT_SYMLINK');
    await unchanged();
  },
);
it('compiled HTML output and goal-state reader reject final symlinks', async () => {
  await mkdir(helper, { recursive: true });
  await symlink(path.join(foreign, 'sentinel'), path.join(helper, 'page.html'));
  await expect(command('report', { html: `${expectHelperDir(entry)}/page.html` })).rejects.toThrow(
    'ARTIFACT_SYMLINK',
  );
  const state = expectStateFile(entry);
  await mkdir(path.dirname(path.join(root, state)), { recursive: true });
  await symlink(path.join(foreign, 'sentinel'), path.join(root, state));
  await expect(
    invoke(compiledGoals, 'runGoals', [
      'status',
      { root, now: new Date(0), params: { file: entry } },
    ]),
  ).rejects.toThrow('ARTIFACT_SYMLINK');
  await unchanged();
}, 60_000);
