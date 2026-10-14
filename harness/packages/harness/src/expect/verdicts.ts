// expect:verdict-prune
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { errorCode, isRecord } from '../guards.ts';
import { repoRoot } from './repo.ts';

export const VERDICTS_PATH = 'expectations/.verdicts.json';

/** Вердикт судьи по одному ожиданию. */
export interface Verdict {
  question: string;
  /** Ссылка на доказательство → SHA-256 его содержимого на момент вердикта. */
  evidence: Record<string, string>;
  verdict: boolean;
  /** Дословная цитата из доказательства, на которой держится ответ. */
  quote: string;
  ref: string;
  reason: string;
  at: string;
}

/** Результат смысловой проверки заголовков одного файла ожиданий. */
export interface LintVerdict {
  /** SHA-256 списка заголовков файла. */
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

/** Раздел кэша: каждая запись проверена; неверная форма — ошибка с её ключом. */
function section<T>(value: unknown, name: string, is: (v: unknown) => v is T): Record<string, T> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`${VERDICTS_PATH}: ${name} должно быть объектом`);
  const out: Record<string, T> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!is(item)) throw new Error(`${VERDICTS_PATH}: ${name}.${key} — неверная форма записи`);
    out[key] = item;
  }
  return out;
}

export async function loadVerdicts(): Promise<VerdictStore> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path.join(repoRoot(), VERDICTS_PATH), 'utf8'));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { verdicts: {}, lint: {} };
    throw error;
  }
  if (!isRecord(data)) throw new Error(`${VERDICTS_PATH}: корень должен быть объектом`);
  return {
    verdicts: section(data['verdicts'], 'verdicts', isVerdict),
    lint: section(data['lint'], 'lint', isLintVerdict),
  };
}

/**
 * Убирает вердикты, которые не нужны ни одному текущему ожиданию, и
 * проверки заголовков удалённых файлов: кэш не растёт с историей правок.
 */
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

/** Ключи отсортированы: diff кэша в PR читается и не конфликтует без нужды. */
export async function saveVerdicts(store: VerdictStore): Promise<void> {
  const file = path.join(repoRoot(), VERDICTS_PATH);
  await mkdir(path.dirname(file), { recursive: true });
  const data = { verdicts: sortKeys(store.verdicts), lint: sortKeys(store.lint) };
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
