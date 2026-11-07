// expect:expect-cycles
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { readEvidence, shaOf } from './evidence.ts';
import { loadVerdicts, type VerdictStore } from './verdicts.ts';
import { expectHelperPath } from '#lib/artifacts';
import { entryOf } from './verdicts.ts';
import { repoRoot } from './repo.ts';

export { COLLECT_ENV, idOf, isPendingItem, SEEN_ENV, type PendingItem } from './pending.ts';
import { COLLECT_ENV, idOf, SEEN_ENV, type PendingItem } from './pending.ts';

const stores = new Map<string, Promise<VerdictStore>>();

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
    const file = expectHelperPath(
      repoRoot(),
      entryOf(),
      `${path.relative(repoRoot(), seen)}/${id}`,
    );
    await mkdir(seen, { recursive: true });
    await writeFile(file, '', 'utf8');
  }

  const key = `${repoRoot()}:${entryOf()}`;
  let store = stores.get(key);
  if (store === undefined) {
    store = loadVerdicts();
    stores.set(key, store);
  }
  const cached = (await store).verdicts[id];
  const fresh =
    cached !== undefined &&
    cached.question === question &&
    Object.keys(cached.evidence).length === refs.length &&
    refs.every((r) => cached.evidence[r.ref] === r.sha);

  if (!fresh) {
    const dir = process.env[COLLECT_ENV];
    if (dir !== undefined) {
      const file = expectHelperPath(
        repoRoot(),
        entryOf(),
        `${path.relative(repoRoot(), dir)}/${id}.json`,
      );
      await mkdir(dir, { recursive: true });
      const item: PendingItem = { id, question, evidence: refs };
      await writeFile(file, JSON.stringify(item), 'utf8');
      return;
    }
    throw new Error(`нет свежего вердикта судьи — запусти ai expect judge [${id}]`);
  }
  if (!cached.verdict) {
    throw new Error(`судья: нет — ${cached.reason} (${cached.ref}: «${cached.quote}»)`);
  }
}
