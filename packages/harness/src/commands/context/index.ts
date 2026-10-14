import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONTEXT_INDEX_PATH } from '#shared/layout';
import { buildContextIndex, checkContextIndex } from './context-index.ts';
import { UsageError } from '#shared/diagnostics';
import { report } from '#shared/report';
import type { CommandArgs } from '#shared/args';

export async function runContext(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command === 'check') return report('context check', await checkContextIndex(args.root));
  if (command !== 'index')
    throw new UsageError(`неизвестная команда: context ${command ?? ''}`.trimEnd());
  const { text, diagnostics } = await buildContextIndex(args.root);
  const file = path.join(args.root, CONTEXT_INDEX_PATH);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
  console.error(`wrote ${CONTEXT_INDEX_PATH}`);
  return report('context index', diagnostics);
}

export { buildContextIndex, checkContextIndex, type ContextIndexResult } from './context-index.ts';
