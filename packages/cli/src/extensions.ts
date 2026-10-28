import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  errorCode,
  errorMessage,
  isRecord,
  isStringArray,
  UsageError,
  type CommandNode,
  type ScriptDef,
  type ScriptStep,
} from '@shahimat/ai-core';
import { parse } from 'yaml';

export const EXTENSION_DIRS = {
  commands: '.agents/commands',
  scripts: '.agents/scripts',
  harnesses: '.agents/harnesses',
} as const;

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
}

function asCommand(value: unknown, where: string): CommandNode {
  if (
    !isRecord(value) ||
    !isStringArray(value['path']) ||
    value['path'].length === 0 ||
    (value['effect'] !== 'query' && value['effect'] !== 'mutation') ||
    typeof value['run'] !== 'function'
  )
    throw new UsageError(
      `${where}: export default { path: string[], effect: query | mutation, run }`,
    );
  const run = value['run'];
  const node: CommandNode = {
    path: value['path'],
    kind: 'command',
    effect: value['effect'],
    run: async (args) => {
      const code: unknown = await Reflect.apply(run, undefined, [args]);
      return typeof code === 'number' ? code : 0;
    },
  };
  if (typeof value['options'] === 'string') node.options = value['options'];
  return node;
}

export async function projectCommands(root: string): Promise<CommandNode[]> {
  const dir = path.join(root, EXTENSION_DIRS.commands);
  const out: CommandNode[] = [];
  for (const name of (await listDir(dir)).filter((n) => /\.(ts|js|mjs)$/.test(n))) {
    const where = `${EXTENSION_DIRS.commands}/${name}`;
    let mod: unknown;
    try {
      mod = await import(pathToFileURL(path.join(dir, name)).href);
    } catch (error) {
      throw new UsageError(`${where}: ${errorMessage(error).split('\n')[0] ?? ''}`);
    }
    out.push(asCommand(isRecord(mod) ? mod['default'] : undefined, where));
  }
  return out;
}

function asStep(value: unknown, where: string): ScriptStep {
  if (!isRecord(value) || !isStringArray(value['command']))
    throw new UsageError(`${where}: шаг — { command: string[] }`);
  return { command: value['command'] };
}

export async function projectScripts(root: string): Promise<ScriptDef[]> {
  const dir = path.join(root, EXTENSION_DIRS.scripts);
  const out: ScriptDef[] = [];
  for (const name of (await listDir(dir)).filter((n) => n.endsWith('.yml'))) {
    const where = `${EXTENSION_DIRS.scripts}/${name}`;
    const data: unknown = parse(await readFile(path.join(dir, name), 'utf8'));
    if (!isRecord(data) || !isStringArray(data['path']) || !Array.isArray(data['steps']))
      throw new UsageError(`${where}: скрипт — { path: string[], steps: [{ command: string[] }] }`);
    out.push({
      path: data['path'],
      steps: data['steps'].map((s, i) => asStep(s, `${where}: steps[${i}]`)),
    });
  }
  return out;
}

export interface HarnessApi {
  nodes: readonly CommandNode[];
  project: (dir: string) => CommandNode[];
}

export async function loadHarness(): Promise<HarnessApi | undefined> {
  let mod: unknown;
  try {
    mod = await import('@shahimat/harness');
  } catch (error) {
    if (errorCode(error) === 'ERR_MODULE_NOT_FOUND') return undefined;
    throw error;
  }
  if (!isRecord(mod)) return undefined;
  const { HARNESS_NODES, harnessNodes, projectHarnessModule } = mod;
  if (
    !Array.isArray(HARNESS_NODES) ||
    typeof harnessNodes !== 'function' ||
    typeof projectHarnessModule !== 'function'
  )
    throw new UsageError('@shahimat/harness: несовместимая версия — нет HARNESS_NODES');
  const nodes: CommandNode[] = HARNESS_NODES.filter(isCommandNode);
  return {
    nodes,
    project: (dir) => {
      const module: unknown = Reflect.apply(projectHarnessModule, undefined, [dir]);
      const list: unknown = Reflect.apply(harnessNodes, undefined, [module]);
      return Array.isArray(list) ? list.filter(isCommandNode) : [];
    },
  };
}

function isCommandNode(v: unknown): v is CommandNode {
  return (
    isRecord(v) &&
    isStringArray(v['path']) &&
    (v['kind'] === 'command' || v['kind'] === 'harness') &&
    typeof v['run'] === 'function'
  );
}

export async function projectHarnesses(
  root: string,
  harness: HarnessApi | undefined,
): Promise<CommandNode[]> {
  const dir = path.join(root, EXTENSION_DIRS.harnesses);
  const names = (await listDir(dir)).filter((n) => existsSync(path.join(dir, n, 'harness.yaml')));
  if (names.length === 0) return [];
  if (harness === undefined)
    throw new UsageError(
      `${EXTENSION_DIRS.harnesses}: свои автоматы есть, а пакета @shahimat/harness нет — подключи модуль harness`,
    );
  return names.flatMap((n) => harness.project(path.join(dir, n)));
}
