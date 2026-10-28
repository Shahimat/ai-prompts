import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const HEAD_SOURCE_ENV = 'HARNESS_EXPECT_HEAD_SOURCE';

export interface Titled {
  path: string[];
  title: string;
}

export type DiffMark = { kind: 'added' } | { kind: 'changed'; was: string };

export interface TitleDiff {
  marks: Map<Titled, DiffMark>;
  removed: Titled[];
}

const git = (cwd: string, args: string[]) =>
  spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

export function headTitles(
  root: string,
  file: string,
  collect: (env: Record<string, string>) => Titled[],
): Titled[] | undefined {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return undefined;
  const abs = path.join(root, file);
  const rel = path.relative(top.stdout.trim(), abs).split(path.sep).join('/');
  const shown = git(root, ['show', `HEAD:${rel}`]);
  if (shown.status !== 0) return undefined;
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-head-'));
  const source = path.join(dir, path.basename(abs));
  writeFileSync(source, shown.stdout, 'utf8');
  try {
    return collect({ [HEAD_SOURCE_ENV]: source });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const keyOf = (t: Titled): string => [...t.path, t.title].join('\u0000');
const pathOf = (t: Titled): string => t.path.join('\u0000');

export function diffTitles(current: Titled[], head: Titled[] | undefined): TitleDiff {
  const marks = new Map<Titled, DiffMark>();
  if (head === undefined) return { marks, removed: [] };
  const now = new Set(current.map(keyOf));
  const before = new Set(head.map(keyOf));
  const gone = head.filter((t) => !now.has(keyOf(t)));
  const removed: Titled[] = [];
  const pool = new Map<string, Titled[]>();
  for (const t of gone) pool.set(pathOf(t), [...(pool.get(pathOf(t)) ?? []), t]);
  for (const t of current) {
    if (before.has(keyOf(t))) continue;
    const was = pool.get(pathOf(t))?.shift();
    marks.set(t, was === undefined ? { kind: 'added' } : { kind: 'changed', was: was.title });
  }
  for (const list of pool.values()) removed.push(...list);
  return { marks, removed };
}
