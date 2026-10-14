import { rm } from 'node:fs/promises';
import path from 'node:path';
import { checkDelta, revisionLines, unfinishedItems } from './delta.ts';
import { UsageError } from '../../shared/diagnostics.ts';
import { report } from '../../shared/report.ts';
import type { CommandArgs } from '../../shared/args.ts';

export async function runDelta(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command !== 'check' && command !== 'close')
    throw new UsageError(`неизвестная команда: delta ${command ?? ''}`.trimEnd());
  const result = await checkDelta(args.root);
  for (const line of revisionLines(result.deltas)) console.log(line);
  if (command === 'check') return report('delta check', result.diagnostics);

  const diagnostics = [...result.diagnostics, ...unfinishedItems(args.root, result)];
  if (diagnostics.length > 0) return report('delta close', diagnostics);
  // Приёмка пройдена: знание уже в документации, дельта больше не нужна.
  for (const d of result.deltas) {
    await rm(path.join(args.root, d.file), { force: true });
    console.error(`removed ${d.file}`);
  }
  return report('delta close', []);
}

export {
  checkDelta,
  DELTA_SCHEMA,
  matchesTarget,
  revisionLines,
  unfinishedItems,
  type Delta,
  type DeltaItem,
  type DeltaResult,
  type Revision,
} from './delta.ts';
