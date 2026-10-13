import path from 'node:path';
import { parseArgs } from 'node:util';
import { runChangelog } from './commands/changelog.ts';
import { runCheck } from './commands/check.ts';
import { runContext } from './commands/context.ts';
import { runIndex } from './commands/prompt-index.ts';
import type { CommandArgs } from './commands/types.ts';
import { UsageError } from './diagnostics.ts';

const USAGE = `Использование:
  harness check [--root <dir>]
  harness changelog lint [--root <dir>]
  harness context index [--root <dir>]
  harness index build --raw-base <url> [--root <dir>] [--out <file>]
  harness index check --raw-base <url> [--root <dir>]

Коды выхода: 0 — ok, 1 — найдены нарушения, 2 — ошибка вызова или конфигурации.`;

export async function main(argv: string[], now: Date = new Date()): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string', default: '.' },
      out: { type: 'string' },
      'raw-base': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const args: CommandArgs = { root: path.resolve(values.root), now };
  if (values.out !== undefined) args.out = values.out;
  if (values['raw-base'] !== undefined) args.rawBase = values['raw-base'];

  const [group, command] = positionals;
  switch (group) {
    case 'check':
      return runCheck(args);
    case 'changelog':
      return runChangelog(command, args);
    case 'context':
      return runContext(command, args);
    case 'index':
      return runIndex(command, args);
    default:
      throw new UsageError(`неизвестная команда: ${positionals.join(' ') || '<пусто>'}`);
  }
}

export async function run(argv: string[]): Promise<number> {
  try {
    return await main(argv);
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof UsageError) {
      console.error(USAGE);
      return 2;
    }
    // parseArgs бросает TypeError с code ERR_PARSE_ARGS_* на неизвестных опциях.
    return String((error as NodeJS.ErrnoException).code).startsWith('ERR_PARSE_ARGS') ? 2 : 1;
  }
}
