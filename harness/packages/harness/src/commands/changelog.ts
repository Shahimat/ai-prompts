import { checkChangelog } from '../checks/changelog.ts';
import { DEFAULT_CHANGELOG, loadConfig } from '../config.ts';
import { UsageError } from '../diagnostics.ts';
import { report } from './report.ts';
import type { CommandArgs } from './types.ts';

export async function runChangelog(
  command: string | undefined,
  args: CommandArgs,
): Promise<number> {
  if (command !== 'lint')
    throw new UsageError(`неизвестная команда: changelog ${command ?? ''}`.trimEnd());
  // Работает и без harness.yml — со значениями по умолчанию.
  const config = await loadConfig(args.root);
  const options = config?.checks.changelog ?? DEFAULT_CHANGELOG;
  return report('changelog', await checkChangelog(args.root, options, args.now));
}
