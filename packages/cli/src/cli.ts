import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runShell } from './shell.ts';
import { fileURLToPath } from 'node:url';
import { setRuntime, type CommandTree } from '@shahimat/ai-core';
import { runScript } from './scripts/index.ts';
import { loadTree } from './tree.ts';
import type { CommandArgs } from '@shahimat/ai-core';
import { InputError, UsageError } from '@shahimat/ai-core';
import { errorCode, errorMessage } from '@shahimat/ai-core';

export function projectOf(start: string): string | undefined {
  const home = path.resolve(homedir());
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const claude = path.join(dir, '.claude');
    if (dir !== home && existsSync(claude) && statSync(claude).isDirectory()) return dir;
    if (path.dirname(dir) === dir) return undefined;
  }
}

export async function cliMain(
  tree: CommandTree,
  argv: string[],
  now: Date = new Date(),
): Promise<number> {
  const { childrenOf, findCommand, isNamespace, renderUsage } = tree;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      out: { type: 'string' },
      file: { type: 'string' },
      html: { type: 'string' },
      port: { type: 'string' },
      'raw-base': { type: 'string' },
      apply: { type: 'boolean' },
      run: { type: 'boolean' },
      home: { type: 'string' },
      name: { type: 'string' },
      request: { type: 'string' },
      all: { type: 'boolean' },
      every: { type: 'string' },
      until: { type: 'string' },
      job: { type: 'string' },
      timeout: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help === true) {
    console.log(renderUsage(positionals));
    return 0;
  }
  const match = findCommand(positionals);
  const root =
    values.root !== undefined
      ? path.resolve(values.root)
      : match?.command.kind === 'harness'
        ? (projectOf(process.cwd()) ?? process.cwd())
        : path.resolve('.');
  const args: CommandArgs = { root, now };
  if (values.out !== undefined) args.out = values.out;
  if (values.file !== undefined) args.file = values.file;
  if (values.html !== undefined) args.html = values.html;
  if (values.port !== undefined) args.port = values.port;
  if (values['raw-base'] !== undefined) args.rawBase = values['raw-base'];
  if (values.apply === true) args.apply = true;
  if (values.run === true) args.run = true;
  if (values.home !== undefined) args.home = values.home;
  if (values.name !== undefined) args.name = values.name;
  if (values.request !== undefined) args.request = values.request;
  if (values.all === true) args.all = true;
  if (values.every !== undefined) args.every = values.every;
  if (values.until !== undefined) args.until = values.until;
  if (values.job !== undefined) args.job = values.job;
  if (values.timeout !== undefined) args.timeout = values.timeout;

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

export function selfCommand(): string[] {
  const bin = fileURLToPath(import.meta.resolve('#bin'));
  return bin.endsWith('.ts')
    ? [process.execPath, '--conditions=source', bin]
    : [process.execPath, bin];
}

function rootOf(argv: readonly string[]): string {
  const i = argv.indexOf('--root');
  const given = i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith('--root='))?.slice(7);
  return given !== undefined ? path.resolve(given) : (projectOf(process.cwd()) ?? process.cwd());
}

export async function prepare(argv: readonly string[]): Promise<CommandTree> {
  const { tree, scripts } = await loadTree(rootOf(argv));
  setRuntime({
    self: selfCommand(),
    runScript: (scriptPath, args) => {
      const def = scripts.find((s) => s.path.join(' ') === scriptPath.join(' '));
      if (def === undefined) throw new UsageError(`нет скрипта ${scriptPath.join(' ')}`);
      return runScript(def, args);
    },
  });
  return tree;
}

export const main = async (argv: string[], now: Date = new Date()): Promise<number> =>
  cliMain(await prepare(argv), argv, now);

export async function runCli(tree: CommandTree, argv: string[]): Promise<number> {
  const again = (words: string[]): Promise<number> => runCli(tree, words);
  if (argv.length === 0 && process.stdin.isTTY && process.stdout.isTTY)
    return runShell(again, tree);
  try {
    return await cliMain(tree, argv);
  } catch (error) {
    console.error(`ERROR: ${errorMessage(error)}`);
    if (error instanceof InputError) return 2;
    if (error instanceof UsageError) {
      console.error(tree.renderUsage());
      return 2;
    }
    return (errorCode(error) ?? '').startsWith('ERR_PARSE_ARGS') ? 2 : 1;
  }
}

export async function run(argv: string[]): Promise<number> {
  let tree: CommandTree;
  try {
    tree = await prepare(argv);
  } catch (error) {
    console.error(`ERROR: ${errorMessage(error)}`);
    return 2;
  }
  return runCli(tree, argv);
}
