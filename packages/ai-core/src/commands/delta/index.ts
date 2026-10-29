import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ACCEPTED_FILE,
  acceptedOf,
  checkDelta,
  matchesTarget,
  revisionLines,
  unfinishedItems,
} from './delta.ts';
import { DELTA_DIR } from '#shared/layout';
import { UsageError } from '#shared/diagnostics';
import { report } from '#shared/report';
import type { CommandArgs } from '#shared/args';

export async function runDelta(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command !== 'check' && command !== 'close')
    throw new UsageError(`неизвестная команда: delta ${command ?? ''}`.trimEnd());
  const result = await checkDelta(args.root);
  for (const line of revisionLines(result.deltas)) console.log(line);
  if (command === 'check') return report('delta check', result.diagnostics);

  const own =
    args.name === undefined
      ? result.deltas
      : result.deltas.filter((d) => d.file === `${DELTA_DIR}/${args.name ?? ''}.yml`);
  if (args.name !== undefined && own.length === 0)
    return report('delta close', [
      { file: `${DELTA_DIR}/${args.name}.yml`, message: 'дельты нет — закрывать нечего' },
    ]);
  const diagnostics = [...result.diagnostics, ...unfinishedItems(args.root, result, own)];
  if (diagnostics.length > 0) return report('delta close', diagnostics);
  const still = result.revisions.map((r) => r.file);
  const accepted = [...result.accepted, ...acceptedOf(own)].filter((a) =>
    still.some((f) => matchesTarget(a.target, f)),
  );
  const ledger = path.join(args.root, ACCEPTED_FILE);
  if (accepted.length === 0) await rm(ledger, { force: true });
  else {
    await mkdir(path.dirname(ledger), { recursive: true });
    await writeFile(ledger, `${JSON.stringify({ v: 1, items: accepted }, null, 2)}\n`, 'utf8');
  }
  for (const d of own) {
    await rm(path.join(args.root, d.file), { force: true });
    console.error(`removed ${d.file}`);
  }
  return report('delta close', []);
}

export {
  ACCEPTED_FILE,
  checkDelta,
  readAccepted,
  type Accepted,
  DELTA_SCHEMA,
  matchesTarget,
  revisionLines,
  unfinishedItems,
  type Delta,
  type DeltaItem,
  type DeltaResult,
  type Revision,
} from './delta.ts';
