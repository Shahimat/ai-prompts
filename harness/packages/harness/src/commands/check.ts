import { checkChangelog } from '../checks/changelog.ts';
import { checkContextIndex } from '../checks/context-index.ts';
import { CONFIG_PATH, loadConfig } from '../config.ts';
import { UsageError, type Diagnostic } from '../diagnostics.ts';
import { report } from './report.ts';
import type { CommandArgs } from './types.ts';

/** Запускает все проверки, включённые в harness.yml. */
export async function runCheck(args: CommandArgs): Promise<number> {
  const config = await loadConfig(args.root);
  if (config === null) throw new UsageError(`нет ${CONFIG_PATH}: harness в проекте не настроен`);

  const ran: string[] = [];
  const diags: Diagnostic[] = [];
  if (config.checks.changelog !== undefined) {
    ran.push('changelog');
    diags.push(...(await checkChangelog(args.root, config.checks.changelog, args.now)));
  }
  if (config.checks['context-index'] !== undefined) {
    ran.push('context-index');
    diags.push(...(await checkContextIndex(args.root)));
  }
  if (ran.length === 0) {
    console.log(`check: в ${CONFIG_PATH} не включено ни одной проверки`);
    return 0;
  }
  return report(`check (${ran.join(', ')})`, diags);
}
