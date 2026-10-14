import { applyActions, checkAdapters, computeSync } from '../adapters/sync.ts';
import { CONFIG_PATH, loadConfig } from '../config.ts';
import { UsageError } from '../diagnostics.ts';
import { report } from './report.ts';
import type { CommandArgs } from './types.ts';

export async function runAdapters(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command !== 'sync' && command !== 'check')
    throw new UsageError(`неизвестная команда: adapters ${command ?? ''}`.trimEnd());
  const config = await loadConfig(args.root);
  if (config === null) throw new UsageError(`нет ${CONFIG_PATH}: список adapters берётся оттуда`);
  if (command === 'check')
    return report('adapters check', await checkAdapters(args.root, config.adapters));

  const { actions, diagnostics } = await computeSync(args.root, config.adapters);
  await applyActions(args.root, actions);
  for (const action of actions)
    console.error(`${action.op === 'write' ? 'wrote' : 'deleted'} ${action.path}`);
  if (actions.length === 0) console.error('adapters: без изменений');
  return report('adapters', diagnostics);
}
