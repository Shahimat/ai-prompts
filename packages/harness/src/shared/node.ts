import type { CommandArgs } from './args.ts';
import type { KNOWN_CHECKS } from './config.ts';

export type Effect = 'query' | 'mutation';

export interface ScriptStep {
  command: readonly string[];
  enabledBy?: (typeof KNOWN_CHECKS)[number];
}

export interface ScriptDef {
  path: readonly string[];
  steps: readonly ScriptStep[];
}

interface NodeBase {
  path: readonly string[];
  options?: string;
  run: (args: CommandArgs) => Promise<number>;
}

export interface CommandNode extends NodeBase {
  kind: 'command' | 'harness';
  effect: Effect;
  effects?: Partial<Record<keyof CommandArgs, Effect>>;
}

export interface ScriptNode extends NodeBase {
  kind: 'script';
  steps: readonly ScriptStep[];
}

export type Command = CommandNode | ScriptNode;
