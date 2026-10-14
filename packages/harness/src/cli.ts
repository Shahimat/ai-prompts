import path from 'node:path';
import { parseArgs } from 'node:util';
import { runShell } from './shell.ts';
import { childrenOf, findCommand, isNamespace, renderUsage } from './tree.ts';
import type { CommandArgs } from './shared/args.ts';
import { UsageError } from './shared/diagnostics.ts';
import { errorCode, errorMessage } from './shared/guards.ts';

export async function main(argv: string[], now: Date = new Date()): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string', default: '.' },
      out: { type: 'string' },
      file: { type: 'string' },
      html: { type: 'string' },
      'raw-base': { type: 'string' },
      apply: { type: 'boolean' },
      home: { type: 'string' },
      name: { type: 'string' },
      request: { type: 'string' },
      hook: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help === true) {
    console.log(renderUsage(positionals));
    return 0;
  }
  const args: CommandArgs = { root: path.resolve(values.root), now };
  if (values.out !== undefined) args.out = values.out;
  if (values.file !== undefined) args.file = values.file;
  if (values.html !== undefined) args.html = values.html;
  if (values['raw-base'] !== undefined) args.rawBase = values['raw-base'];
  if (values.apply === true) args.apply = true;
  if (values.home !== undefined) args.home = values.home;
  if (values.name !== undefined) args.name = values.name;
  if (values.request !== undefined) args.request = values.request;
  if (values.hook === true) args.hook = true;

  const match = findCommand(positionals);
  if (match !== undefined) return match.command.run({ ...args, params: match.params });

  const last = positionals.at(-1);
  const prefix = positionals.slice(0, -1);
  if (last === 'help' && (prefix.length === 0 || isNamespace(prefix))) {
    console.log(renderUsage(prefix));
    return 0;
  }
  if (last === 'list' && (prefix.length === 0 || isNamespace(prefix))) {
    console.log(childrenOf(prefix).join('\n'));
    return 0;
  }
  if (positionals.length > 0 && isNamespace(positionals))
    throw new UsageError(
      `${positionals.join(' ')} — уровень, а не команда: ${childrenOf(positionals).join(' | ')}`,
    );
  throw new UsageError(`неизвестная команда: ${positionals.join(' ') || '<пусто>'}`);
}

export async function run(argv: string[]): Promise<number> {
  if (argv.length === 0 && process.stdin.isTTY && process.stdout.isTTY) return runShell(run);
  try {
    return await main(argv);
  } catch (error) {
    console.error(`ERROR: ${errorMessage(error)}`);
    if (error instanceof UsageError) {
      console.error(renderUsage());
      return 2;
    }
    return (errorCode(error) ?? '').startsWith('ERR_PARSE_ARGS') ? 2 : 1;
  }
}
