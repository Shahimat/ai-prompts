import { applyActions, checkAdapters, computeSync } from './sync.ts';
import { CONFIG_PATH, loadConfig } from '../../shared/config.ts';
import { UsageError } from '../../shared/diagnostics.ts';
import { report } from '../../shared/report.ts';
import type { CommandArgs } from '../../shared/args.ts';

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

export { applyActions, checkAdapters, computeSync, type Action, type SyncResult } from './sync.ts';
