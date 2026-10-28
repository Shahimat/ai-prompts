// expect:verdict-prune
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { errorCode, isRecord } from '#shared/guards';
import { repoRoot } from './repo.ts';

export const ENTRY_ENV = 'HARNESS_EXPECT_ENTRY';

const DEFAULT_ENTRY = 'expectations/index.expect.ts';

export const entryOf = (): string => process.env[ENTRY_ENV] ?? DEFAULT_ENTRY;

export const verdictsPath = (entry: string = entryOf()): string =>
  path.posix.join(path.posix.dirname(entry.split(path.sep).join('/')), '.verdicts.json');

export interface Verdict {
  question: string;
  evidence: Record<string, string>;
  verdict: boolean;
  quote: string;
  ref: string;
  reason: string;
  at: string;
}

export interface LintVerdict {
  titles: string;
  contradictions: { a: string; b: string; reason: string }[];
  unmeasurable: { id: string; reason: string }[];
  at: string;
}

export interface VerdictStore {
  verdicts: Record<string, Verdict>;
  lint: Record<string, LintVerdict>;
}

const isStringRecord = (v: unknown): v is Record<string, string> =>
  isRecord(v) && Object.values(v).every((x) => typeof x === 'string');

function isVerdict(v: unknown): v is Verdict {
  return (
    isRecord(v) &&
    typeof v['question'] === 'string' &&
    isStringRecord(v['evidence']) &&
    typeof v['verdict'] === 'boolean' &&
    typeof v['quote'] === 'string' &&
    typeof v['ref'] === 'string' &&
    typeof v['reason'] === 'string' &&
    typeof v['at'] === 'string'
  );
}

export function isContradictions(v: unknown): v is LintVerdict['contradictions'] {
  return (
    Array.isArray(v) &&
    v.every(
      (c) =>
        isRecord(c) &&
        typeof c['a'] === 'string' &&
        typeof c['b'] === 'string' &&
        typeof c['reason'] === 'string',
    )
  );
}

export function isUnmeasurable(v: unknown): v is LintVerdict['unmeasurable'] {
  return (
    Array.isArray(v) &&
    v.every((u) => isRecord(u) && typeof u['id'] === 'string' && typeof u['reason'] === 'string')
  );
}

function isLintVerdict(v: unknown): v is LintVerdict {
  return (
    isRecord(v) &&
    typeof v['titles'] === 'string' &&
    isContradictions(v['contradictions']) &&
    isUnmeasurable(v['unmeasurable']) &&
    typeof v['at'] === 'string'
  );
}

function section<T>(value: unknown, name: string, is: (v: unknown) => v is T): Record<string, T> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`${verdictsPath()}: ${name} должно быть объектом`);
  const out: Record<string, T> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!is(item)) throw new Error(`${verdictsPath()}: ${name}.${key} — неверная форма записи`);
    out[key] = item;
  }
  return out;
}

export async function loadVerdicts(): Promise<VerdictStore> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path.join(repoRoot(), verdictsPath()), 'utf8'));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { verdicts: {}, lint: {} };
    throw error;
  }
  if (!isRecord(data)) throw new Error(`${verdictsPath()}: корень должен быть объектом`);
  return {
    verdicts: section(data['verdicts'], 'verdicts', isVerdict),
    lint: section(data['lint'], 'lint', isLintVerdict),
  };
}

export function pruneStore(
  store: VerdictStore,
  liveIds: Set<string>,
  liveFiles: Set<string>,
): number {
  let removed = 0;
  for (const id of Object.keys(store.verdicts)) {
    if (!liveIds.has(id)) {
      delete store.verdicts[id];
      removed++;
    }
  }
  for (const file of Object.keys(store.lint)) {
    if (!liveFiles.has(file)) {
      delete store.lint[file];
      removed++;
    }
  }
  return removed;
}

const sortKeys = <T>(obj: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export async function saveVerdicts(store: VerdictStore): Promise<void> {
  const file = path.join(repoRoot(), verdictsPath());
  await mkdir(path.dirname(file), { recursive: true });
  const data = { verdicts: sortKeys(store.verdicts), lint: sortKeys(store.lint) };
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
