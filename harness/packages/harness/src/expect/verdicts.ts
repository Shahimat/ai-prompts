import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

export async function loadVerdicts(): Promise<VerdictStore> {
  try {
    const data = JSON.parse(await readFile(path.join(repoRoot(), VERDICTS_PATH), 'utf8')) as Partial<VerdictStore>;
    return { verdicts: data.verdicts ?? {}, lint: data.lint ?? {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { verdicts: {}, lint: {} };
    throw error;
  }
}

/**
 * Убирает вердикты, которые не нужны ни одному текущему ожиданию, и
 * проверки заголовков удалённых файлов: кэш не растёт с историей правок.
 */
export function pruneStore(store: VerdictStore, liveIds: Set<string>, liveFiles: Set<string>): number {
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
