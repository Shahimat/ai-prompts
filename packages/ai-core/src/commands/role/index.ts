import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serveChannel } from '#lib/mcp';
import { isProtocolMessage } from '#lib/protocol';
import { askRole } from '#lib/role';
import type { CommandArgs } from '#shared/args';
import { UsageError } from '#shared/diagnostics';

async function run(args: CommandArgs): Promise<number> {
  const name = args.params?.['name'];
  if (name === undefined) throw new UsageError('role run <name>: нет имени роли');
  if (args.file === undefined) throw new UsageError('role run: нужен --file <задание>');
  const out = args.out === undefined ? undefined : path.resolve(args.root, args.out);
  if (out !== undefined && existsSync(out))
    throw new UsageError(`${args.out} уже есть — укажи новый файл ответа`);
  const task = await readFile(path.resolve(args.root, args.file), 'utf8');
  const { data, costUsd } = await askRole(args.root, name, task);
  const json = `${JSON.stringify(data, null, 2)}\n`;
  if (out === undefined) process.stdout.write(json);
  else await writeFile(out, json, 'utf8');
  if (costUsd !== undefined) console.error(`role ${name}: $${costUsd.toFixed(4)}`);
  return 0;
}

async function channel(args: CommandArgs): Promise<number> {
  const message = args.params?.['message'];
  if (!isProtocolMessage(message))
    throw new UsageError('role channel <message>: result, verdict или question');
  if (args.out === undefined) throw new UsageError('role channel: нужен --out <файл>');
  await serveChannel({
    message,
    out: path.resolve(args.root, args.out),
    input: process.stdin,
    output: process.stdout,
  });
  return 0;
}

export function runRoleCommand(mode: 'run' | 'channel', args: CommandArgs): Promise<number> {
  return mode === 'run' ? run(args) : channel(args);
}
