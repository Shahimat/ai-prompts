import { checkData } from '#lib/data-check';
import type { CommandArgs } from '#shared/args';
import { UsageError } from '#shared/diagnostics';

export const runData = async (command: string | undefined, args: CommandArgs): Promise<number> => {
  if (command !== 'check')
    throw new UsageError(`неизвестная команда: data ${command ?? ''}`.trimEnd());
  const report = await checkData(args.root);
  for (const error of report.errors) console.error(`ERROR: ${error.file}: ${error.message}`);
  console.log(
    `data check: ${report.structures} structures, ${report.records} records, ${report.errors.length} errors`,
  );
  return report.errors.length === 0 ? 0 : 1;
};
