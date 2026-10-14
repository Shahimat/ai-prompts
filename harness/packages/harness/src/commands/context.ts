import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildContextIndex,
  checkContextIndex,
  CONTEXT_INDEX_PATH,
} from '../checks/context-index.ts';
import { UsageError } from '../diagnostics.ts';
import { report } from './report.ts';
import type { CommandArgs } from './types.ts';

export async function runContext(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command === 'check') return report('context check', await checkContextIndex(args.root));
  if (command !== 'index')
    throw new UsageError(`неизвестная команда: context ${command ?? ''}`.trimEnd());
  const { text, diagnostics } = await buildContextIndex(args.root);
  // Пишем и при нарушениях: индекс с пробелами полезнее устаревшего.
  const file = path.join(args.root, CONTEXT_INDEX_PATH);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
  console.error(`wrote ${CONTEXT_INDEX_PATH}`);
  return report('context index', diagnostics);
}
