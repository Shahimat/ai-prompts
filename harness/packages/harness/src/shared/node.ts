// Узел дерева CLI: команда, скрипт или операция harness.

import type { CommandArgs } from './args.ts';
import type { KNOWN_CHECKS } from './config.ts';

/** query — не меняет файлов, кроме кэша по содержимому вне git; mutation — пишет. */
export type Effect = 'query' | 'mutation';

/** Шаг скрипта: команда и, если задано, проверка конфига, которая её включает. */
export interface ScriptStep {
  command: readonly string[];
  enabledBy?: (typeof KNOWN_CHECKS)[number];
}

/** Скрипт — только данные: последовательность команд. */
export interface ScriptDef {
  path: readonly string[];
  steps: readonly ScriptStep[];
}

interface NodeBase {
  /**
   * Путь из позиционных аргументов: `['expect', 'judge']`. Сегмент
   * `<имя>` — параметр: совпадает с любым словом и попадает в `args.params`.
   */
  path: readonly string[];
  /** Опции для справки, кроме общей `--root`. */
  options?: string;
  run: (args: CommandArgs) => Promise<number>;
}

export interface CommandNode extends NodeBase {
  kind: 'command' | 'harness';
  effect: Effect;
  /** Опция, с которой эффект узла другой: `session <s> check --hook`. */
  effects?: Partial<Record<keyof CommandArgs, Effect>>;
}

/** Эффект скрипта не объявляется: он выводится из его шагов. */
export interface ScriptNode extends NodeBase {
  kind: 'script';
  steps: readonly ScriptStep[];
}

export type Command = CommandNode | ScriptNode;
