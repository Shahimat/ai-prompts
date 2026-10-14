import path from 'node:path';
import { parseArgs } from 'node:util';
import { findCommand, renderUsage } from './commands/tree.ts';
import type { CommandArgs } from './commands/types.ts';
import { UsageError } from './diagnostics.ts';

export async function main(argv: string[], now: Date = new Date()): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string', default: '.' },
      out: { type: 'string' },
      'raw-base': { type: 'string' },
      apply: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(renderUsage());
    return 0;
  }
  const args: CommandArgs = { root: path.resolve(values.root), now };
  if (values.out !== undefined) args.out = values.out;
  if (values['raw-base'] !== undefined) args.rawBase = values['raw-base'];
  if (values.apply === true) args.apply = true;

  const command = findCommand(positionals);
  if (command === undefined)
    throw new UsageError(`неизвестная команда: ${positionals.join(' ') || '<пусто>'}`);
  return command.run(args);
}

export async function run(argv: string[]): Promise<number> {
  try {
    return await main(argv);
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof UsageError) {
      console.error(renderUsage());
      return 2;
    }
    // parseArgs бросает TypeError с code ERR_PARSE_ARGS_* на неизвестных опциях.
    return String((error as NodeJS.ErrnoException).code).startsWith('ERR_PARSE_ARGS') ? 2 : 1;
  }
}
