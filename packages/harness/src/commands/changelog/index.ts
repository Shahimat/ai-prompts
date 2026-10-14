import { checkChangelog } from './lint.ts';
import { DEFAULT_CHANGELOG, loadConfig } from '../../shared/config.ts';
import { UsageError } from '../../shared/diagnostics.ts';
import { report } from '../../shared/report.ts';
import type { CommandArgs } from '../../shared/args.ts';

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

export { checkChangelog, lintChangelog, CHANGELOG_PATH } from './lint.ts';
