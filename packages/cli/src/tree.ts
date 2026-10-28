import {
  COMMAND_NODES,
  commandTree,
  UsageError,
  type Command,
  type CommandTree,
  type ScriptDef,
} from '@shahimat/ai-core';
import { loadHarness, projectCommands, projectHarnesses, projectScripts } from './extensions.ts';
import { CHECK, DOCS_VERIFY, REFRESH, runScript } from './scripts/index.ts';

export const BIN = 'ai';
export const SCRIPTS: readonly ScriptDef[] = [CHECK, REFRESH, DOCS_VERIFY];
const CLI_SCRIPTS: readonly ScriptDef[] = [CHECK, REFRESH];

export const scriptCommand = (def: ScriptDef): Command => ({
  path: def.path,
  kind: 'script',
  steps: def.steps,
  run: (args) => runScript(def, args),
});

export const BUILTIN: readonly Command[] = [...CLI_SCRIPTS.map(scriptCommand), ...COMMAND_NODES];

export const BUILTIN_TREE: CommandTree = commandTree(BIN, BUILTIN);

function noClashes(builtin: readonly Command[], own: readonly Command[]): void {
  const key = (c: Command): string => c.path.join(' ');
  const taken = new Set(builtin.map(key));
  const seen = new Set<string>();
  for (const c of own) {
    if (taken.has(key(c)))
      throw new UsageError(`${key(c)}: имя занято встроенной командой — переименуй расширение`);
    if (seen.has(key(c))) throw new UsageError(`${key(c)}: два расширения с одним именем`);
    seen.add(key(c));
  }
}

export interface LoadedTree {
  tree: CommandTree;
  scripts: readonly ScriptDef[];
}

export async function loadTree(root: string): Promise<LoadedTree> {
  const harness = await loadHarness();
  const builtin = [...BUILTIN, ...(harness?.nodes ?? [])];
  const scripts = await projectScripts(root);
  const own: Command[] = [
    ...scripts.map(scriptCommand),
    ...(await projectCommands(root)),
    ...(await projectHarnesses(root, harness)),
  ];
  noClashes(builtin, own);
  return { tree: commandTree(BIN, [...builtin, ...own]), scripts: [...SCRIPTS, ...scripts] };
}
