import { existsSync } from 'node:fs';
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

const dist = (file: string): string => pathToFileURL(path.join(process.cwd(), 'dist', file)).href;
const compiledJudge: unknown = await import(dist('lib/expect/judge.js'));
const compiledExpect: unknown = await import(dist('commands/expect/index.js'));
const compiledVerdicts: unknown = await import(dist('lib/expect/verdicts.js'));
const compiledGoals: unknown = await import(dist('commands/goals/index.js'));
const compiledOpencode: unknown = await import(dist('lib/opencode.js'));
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
const command = (name: string, options: Record<string, unknown> = {}): Promise<unknown> =>
  invoke(compiledExpect, 'runExpect', [
    name,
    { root, now: new Date(0), params: { file: entry }, ...options },
  ]);
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
  await put(entry, "import {it,expect} from 'vitest'; it('synthetic',()=>expect(1).toBe(1));\n");
  helper = path.join(root, expectHelperDir(entry));
  id = idOf(expect.getState().currentTestName ?? '', ['input.md']);
  vi.stubEnv('HARNESS_EXPECT_ROOT', root);
  vi.stubEnv('HARNESS_EXPECT_ENTRY', entry);
  vi.stubEnv(COLLECT_ENV, path.join(helper, 'pending'));
  vi.stubEnv(SEEN_ENV, path.join(helper, 'seen'));
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
  expect(JSON.parse(await readFile(path.join(helper, 'pending', `${id}.json`), 'utf8'))).toEqual({
    id,
    question: expect.getState().currentTestName,
    evidence: [{ ref: 'input.md', sha: shaOf('synthetic evidence'), bytes: 18 }],
  });
  expect(await readFile(path.join(helper, 'seen', id), 'utf8')).toBe('');
  await unchanged();
});
it.each([
  { freshness: 'fresh', hash: shaOf('synthetic evidence'), collected: false },
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
    await expect(invoke(compiledVerdicts, name, [{ verdicts: {}, lint: {} }])).rejects.toThrow(
      'ARTIFACT_SYMLINK',
    );
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
it.each(['pending/extra.json', 'seen/extra', 'batch-1.md', 'lint-1.md', 'plan.json'])(
  'compiled helper prepare validates final %s at actual I/O',
  async (leaf) => {
    await put(
      entry,
      `import {it} from 'vitest';
import {mkdirSync,symlinkSync} from 'node:fs'; import path from 'node:path';
import {judged} from ${JSON.stringify(dist('lib/expect/judge.js'))};
it('synthetic',async()=>{await judged(['input.md']); const file=path.join(path.dirname(process.env.HARNESS_EXPECT_COLLECT),${JSON.stringify(leaf)}); mkdirSync(path.dirname(file),{recursive:true}); symlinkSync(${JSON.stringify(path.join(foreign, 'sentinel'))},file);});\n`,
    );
    await expect(command('judge')).rejects.toThrow('ARTIFACT_SYMLINK');
    await unchanged();
  },
  60_000,
);
it.each(['plan.json', 'task.md', 'answer.json'])(
  'compiled helper apply validates final %s before reading',
  async (leaf) => {
    const prefix = expectHelperDir(entry);
    await put(
      `${prefix}/plan.json`,
      JSON.stringify({
        batches: [],
        lint: [
          {
            task: `${prefix}/task.md`,
            answer: `${prefix}/answer.json`,
            file: entry,
            titles: 'synthetic',
            ids: [],
          },
        ],
      }),
    );
    await rm(path.join(helper, leaf), { force: true });
    await symlink(path.join(foreign, 'sentinel'), path.join(helper, leaf));
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
