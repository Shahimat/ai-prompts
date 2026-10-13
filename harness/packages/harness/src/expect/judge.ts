// expect:expect-cycles
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { readEvidence, shaOf } from './evidence.ts';
import { loadVerdicts, type VerdictStore } from './verdicts.ts';

/** Каталог, куда в режиме сбора пишутся ожидания без свежего вердикта. */
export const COLLECT_ENV = 'HARNESS_EXPECT_COLLECT';

/** Каталог, куда в режиме сбора пишутся id всех смысловых ожиданий — для очистки кэша. */
export const SEEN_ENV = 'HARNESS_EXPECT_SEEN';

/** Ожидание, которому нужен вердикт судьи. */
export interface PendingItem {
  id: string;
  question: string;
  evidence: { ref: string; sha: string; bytes: number }[];
}

/**
 * Ключ вердикта: заголовок + доказательства. Один и тот же набор ожиданий
 * (например, из @shahimat/expectations) проверяет разные файлы — вердикты
 * не должны затирать друг друга.
 */
export const idOf = (question: string, refs: string[] = []): string =>
  shaOf([question, ...[...refs].sort()].join('\n')).slice(0, 12);

let store: Promise<VerdictStore> | null = null;

/**
 * Смысловая проверка: вопрос — заголовок текущего `it`, доказательства —
 * файлы или разделы (`path#Заголовок`). Вердикт берётся из кэша; нет
 * свежего — тест падает с подсказкой `harness expect judge`.
 */
export async function judged(evidence: string[]): Promise<void> {
  const question = expect.getState().currentTestName ?? '';
  if (question === '') throw new Error('judged() вызывается только внутри it()');
  if (evidence.length === 0) throw new Error('judged(): нужен хотя бы один файл-доказательство');
  const id = idOf(question, evidence);
  const refs = await Promise.all(
    evidence.map(async (ref) => {
      const text = await readEvidence(ref);
      return { ref, sha: shaOf(text), bytes: Buffer.byteLength(text, 'utf8') };
    }),
  );

  const seen = process.env[SEEN_ENV];
  if (seen !== undefined) {
    await mkdir(seen, { recursive: true });
    await writeFile(path.join(seen, id), '', 'utf8');
  }

  store ??= loadVerdicts();
  const cached = (await store).verdicts[id];
  const fresh =
    cached !== undefined &&
    cached.question === question &&
    Object.keys(cached.evidence).length === refs.length &&
    refs.every((r) => cached.evidence[r.ref] === r.sha);

  if (!fresh) {
    const dir = process.env[COLLECT_ENV];
    if (dir !== undefined) {
      await mkdir(dir, { recursive: true });
      const item: PendingItem = { id, question, evidence: refs };
      await writeFile(path.join(dir, `${id}.json`), JSON.stringify(item), 'utf8');
      return;
    }
    throw new Error(`нет свежего вердикта судьи — запусти harness expect judge [${id}]`);
  }
  if (!cached.verdict) {
    throw new Error(`судья: нет — ${cached.reason} (${cached.ref}: «${cached.quote}»)`);
  }
}
