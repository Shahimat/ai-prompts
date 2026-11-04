import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  errorCode,
  errorMessage,
  InputError,
  UsageError,
  type CommandArgs,
} from '@shahimat/ai-core';
import { OC3_TREE } from '#tree';

async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      file: { type: 'string' },
      ticket: { type: 'string' },
      out: { type: 'string' },
      html: { type: 'string' },
      roles: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help === true) {
    console.log(OC3_TREE.renderUsage(positionals));
    return 0;
  }
  const match = OC3_TREE.findCommand(positionals);
  if (match === undefined) {
    const last = positionals.at(-1);
    const prefix = positionals.slice(0, -1);
    if (last === 'help' && (prefix.length === 0 || OC3_TREE.isNamespace(prefix))) {
      console.log(OC3_TREE.renderUsage(prefix));
      return 0;
    }
    if (last === 'list' && (prefix.length === 0 || OC3_TREE.isNamespace(prefix))) {
      console.log(OC3_TREE.childrenOf(prefix).join('\n'));
      return 0;
    }
    if (positionals.length > 0 && OC3_TREE.isNamespace(positionals))
      throw new UsageError(
        `${positionals.join(' ')} — уровень, а не команда: ${OC3_TREE.childrenOf(positionals).join(' | ')}`,
      );
    throw new UsageError(`неизвестная команда: ${positionals.join(' ') || '<пусто>'}`);
  }
  const args: CommandArgs = {
    root: values.root !== undefined ? path.resolve(values.root) : path.resolve('.'),
    now: new Date(),
    params: match.params,
  };
  if (values.roles !== undefined) args.params = { ...args.params, roles: values.roles };
  if (values.file !== undefined) args.file = values.file;
  if (values.ticket !== undefined) args.ticket = values.ticket;
  if (values.out !== undefined) args.out = values.out;
  if (values.html !== undefined) args.html = values.html;
  return match.command.run(args);
}

export async function main(argv: string[]): Promise<number> {
  try {
    return await run(argv);
  } catch (error) {
    console.error(`ERROR: ${errorMessage(error)}`);
    if (error instanceof InputError) return 2;
    if (error instanceof UsageError) {
      console.error(OC3_TREE.renderUsage());
      return 2;
    }
    return (errorCode(error) ?? '').startsWith('ERR_PARSE_ARGS') ? 2 : 1;
  }
}
