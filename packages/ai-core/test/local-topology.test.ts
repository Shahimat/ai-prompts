import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { artifactPath } from '#lib/artifacts';
import { topologyOf } from '#lib/local-store';
import { isStringArray } from '#shared/guards';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawnSync: vi.fn<typeof original.spawnSync>(original.spawnSync) };
});

let base: string;
beforeEach(async () => {
  const parent = artifactPath(path.resolve(import.meta.dirname, '..', '..', '..'), {
    kind: 'run',
    key: 'incremental-verification-final',
    name: 'topology-fixtures',
  });
  await mkdir(parent, { recursive: true });
  base = await mkdtemp(path.join(parent, 'fresh-'));
  vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(base));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function git(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, env: process.env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

it('fresh topology combines revision facts without caching unborn, committed, changed, detached or linked roots', async () => {
  const root = path.join(base, 'repository with spaces\nand newline');
  await mkdir(root);
  git(root, ['init', '-q', '--initial-branch=synthetic']);
  vi.mocked(spawnSync).mockClear();
  const unborn = await topologyOf(root);
  expect(unborn).toEqual({
    project: await realpath(root),
    worktree: await realpath(root),
    head: null,
    branch: 'synthetic',
  });
  const queries = vi.mocked(spawnSync).mock.calls.filter(([command]) => command === 'git');
  expect(queries).toHaveLength(2);
  expect(queries.filter(([, args]) => isStringArray(args) && args[0] === 'rev-parse')).toHaveLength(
    1,
  );
  git(root, ['commit', '--allow-empty', '-qm', 'synthetic first']);
  const first = await topologyOf(root);
  expect(first.head).toMatch(/^[a-f0-9]{40,64}$/);
  git(root, ['commit', '--allow-empty', '-qm', 'synthetic second']);
  const second = await topologyOf(root);
  expect(second.head).not.toBe(first.head);
  git(root, ['checkout', '-q', '--detach']);
  expect((await topologyOf(root)).branch).toBe('');
  const linked = path.join(base, 'linked');
  git(root, ['worktree', 'add', '-q', '--detach', linked]);
  expect(await topologyOf(linked)).toEqual({
    ...second,
    branch: '',
    worktree: await realpath(linked),
  });
});

it('fresh topology retains non-git null facts and rejects an actual bare repository', async () => {
  const plain = path.join(base, 'plain');
  const bare = path.join(base, 'bare');
  await mkdir(plain);
  await mkdir(bare);
  expect(await topologyOf(plain)).toEqual({
    project: await realpath(plain),
    worktree: await realpath(plain),
    head: null,
    branch: null,
  });
  git(bare, ['init', '--bare', '-q']);
  await expect(topologyOf(bare)).rejects.toThrow('STORE_UNAVAILABLE: bare topology');
});
