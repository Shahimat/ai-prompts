import { collectContext } from './context.ts';
import { UsageError } from '#shared/diagnostics';
import { report } from '#shared/report';
import type { CommandArgs } from '#shared/args';

export async function runContext(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command !== 'check')
    throw new UsageError(`неизвестная команда: context ${command ?? ''}`.trimEnd());
  return report('context check', await collectContext(args.root));
}

export { collectContext } from './context.ts';
