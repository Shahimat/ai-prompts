import { existsSync } from 'node:fs';
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
import { UsageError, type Diagnostic } from '#shared/diagnostics';
import { report, warn } from '#shared/report';
import type { CommandArgs } from '#shared/args';

export async function runDelta(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command !== 'check' && command !== 'close')
    throw new UsageError(`неизвестная команда: delta ${command ?? ''}`.trimEnd());
  const result = await checkDelta(args.root);
  const ownFile = args.name === undefined ? undefined : `${DELTA_DIR}/${args.name}.yml`;
  const isForeign = (d: Diagnostic): boolean =>
    ownFile !== undefined && d.file.startsWith(`${DELTA_DIR}/`) && d.file !== ownFile;
  const foreign = result.diagnostics.filter(isForeign);
  const errors = result.diagnostics.filter((d) => !isForeign(d));
  warn(result.warnings);
  if (foreign.length > 0) {
    warn(foreign);
    const files = new Set(foreign.map((d) => d.file)).size;
    console.error(
      `дельты прошлых сессий с нарушениями (${files}): исправь их или удали, если их сессии не продолжатся — сессию ${args.name ?? ''} они не валят`,
    );
  }
  const own =
    ownFile === undefined ? result.deltas : result.deltas.filter((d) => d.file === ownFile);
  for (const line of revisionLines(own)) console.log(line);
  if (command === 'check') return report('delta check', errors);

  if (ownFile !== undefined && own.length === 0 && !existsSync(path.join(args.root, ownFile)))
    return report('delta close', [{ file: ownFile, message: 'дельты нет — закрывать нечего' }]);
  const diagnostics = [...errors, ...unfinishedItems(args.root, result, own)];
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
