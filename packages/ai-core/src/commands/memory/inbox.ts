import type { CommandArgs } from '#shared/args';
import { UsageError } from '#shared/diagnostics';
import { isRecord } from '#shared/guards';
import {
  enqueueKnowledge,
  queryPendingKnowledge,
  pendingViewOf,
  prepareKnowledgeBatch,
  knowledgeSelectionOf,
} from '#lib/knowledge';
import { localSnapshot } from '#lib/local-store';
import { readBoundedInput } from '#lib/intents';

async function inputOf(args: CommandArgs): Promise<unknown> {
  if (args.file === undefined) throw new UsageError('--file обязателен');
  const raw = await readBoundedInput(args.root, args.file, 131072);
  try {
    return JSON.parse(raw);
  } catch {
    throw new UsageError('INVALID_JSON');
  }
}

export async function runInbox(command: string, args: CommandArgs): Promise<number> {
  if (command === 'pending' && args.file === undefined) {
    console.log(await pendingViewOf(args.root));
    return 0;
  }
  const input = await inputOf(args);
  if (!isRecord(input)) throw new UsageError('ожидается объект');
  if (command === 'enqueue') {
    if (Object.keys(input).some((k) => k !== 'knowledge_delta'))
      throw new UsageError('SPOOFED_METADATA');
    const snapshot = await localSnapshot(args.root);
    const receipt = await enqueueKnowledge(
      {
        root: args.root,
        actor: 'operator/manual-cli',
        channel: 'manual-cli',
        execution: snapshot.scope,
        start: snapshot,
      },
      input['knowledge_delta'],
    );
    console.log(JSON.stringify(receipt ?? { pending: 0 }));
    return 0;
  }
  let selection: ReturnType<typeof knowledgeSelectionOf>;
  try {
    selection = knowledgeSelectionOf(input);
  } catch {
    throw new UsageError('INVALID_SELECTION');
  }
  if (command === 'batch')
    console.log(JSON.stringify(await prepareKnowledgeBatch(args.root, selection)));
  else console.log(JSON.stringify(await queryPendingKnowledge(args.root, selection)));
  return 0;
}
