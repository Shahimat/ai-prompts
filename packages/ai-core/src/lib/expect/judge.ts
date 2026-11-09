// expect:expect-cycles
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { readEvidence, shaOf } from './evidence.ts';
import { findImplementationVerdict, loadVerdicts } from './verdicts.ts';
import { implementationContext } from './proof.ts';
import { expectHelperPath } from '#lib/artifacts';
import { entryOf } from './verdicts.ts';
import { repoRoot } from './repo.ts';
import { joinProofRun, PROOF_TRANSPORT } from '#lib/proof/transport';

export { COLLECT_ENV, idOf, isPendingItem, SEEN_ENV, type PendingItem } from './pending.ts';
import { COLLECT_ENV, idOf, SEEN_ENV, type PendingItem } from './pending.ts';

export async function judged(evidence: string[]): Promise<void> {
  const question = expect.getState().currentTestName ?? '';
  if (question === '') throw new Error('judged() вызывается только внутри it()');
  if (evidence.length === 0) throw new Error('judged(): нужен хотя бы один файл-доказательство');
  const refs = await Promise.all(
    evidence.map(async (ref) => {
      const text = await readEvidence(ref);
      return { ref, sha: shaOf(text), bytes: Buffer.byteLength(text, 'utf8') };
    }),
  );
  const context = await implementationContext(repoRoot(), entryOf(), question, evidence);
  const binding = context.binding;
  const expectedGeneration = process.env['HARNESS_EXPECT_SOURCE_GENERATION'];
  if (expectedGeneration !== undefined && expectedGeneration !== context.generation)
    throw new Error('STALE_EXPECT_GENERATION');
  const id = idOf(`${binding.criterion}:${question}`, evidence);

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

  const cached = findImplementationVerdict(await loadVerdicts(), binding);
  const transport = process.env[PROOF_TRANSPORT];
  const run = transport === undefined ? undefined : await joinProofRun(repoRoot(), transport);
  const fresh =
    (run?.force !== true || cached?.run === run.id) &&
    cached !== undefined &&
    binding.complete &&
    cached.binding?.complete === true &&
    cached.binding.input === binding.input &&
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
      const item: PendingItem = { id, question, evidence: refs, binding, source: context.source };
      await writeFile(file, JSON.stringify(item), { encoding: 'utf8', flag: 'wx' });
      return;
    }
    throw new Error(`нет свежего вердикта судьи — запусти ai expect judge [${id}]`);
  }
  if (!cached.verdict) {
    throw new Error(`судья: нет — ${cached.reason} (${cached.ref}: «${cached.quote}»)`);
  }
}
