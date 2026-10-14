import { HARNESS_NODES } from './harnesses/index.ts';
import { CHECK, COMMAND_NODES, REFRESH, runScript } from './scripts/index.ts';
import type { Command, ScriptDef } from './shared/node.ts';

export type { Command } from './shared/node.ts';

const script = (def: ScriptDef): Command => ({
  path: def.path,
  kind: 'script',
  steps: def.steps,
  run: (args) => runScript(def, args),
});

/** Дерево команд CLI: из него строятся разбор аргументов, справка и оболочка. */
export const COMMANDS: readonly Command[] = [
  script(CHECK),
  script(REFRESH),
  ...COMMAND_NODES,
  // harness: команды под именем harness
  ...HARNESS_NODES,
];

const isParam = (segment: string): boolean => segment.startsWith('<') && segment.endsWith('>');

/** Параметры, если путь команды совпадает с префиксом слов; иначе null. */
function matchPrefix(
  path: readonly string[],
  words: readonly string[],
): Record<string, string> | null {
  if (words.length > path.length) return null;
  const params: Record<string, string> = {};
  for (const [i, word] of words.entries()) {
    const segment = path[i] ?? '';
    if (isParam(segment)) params[segment.slice(1, -1)] = word;
    else if (segment !== word) return null;
  }
  return params;
}

export interface Match {
  command: Command;
  params: Record<string, string>;
}

/** Команда, путь которой совпадает со словами целиком; литералы важнее параметров. */
export function findCommand(positionals: readonly string[]): Match | undefined {
  const matches = COMMANDS.flatMap((command) => {
    if (command.path.length !== positionals.length) return [];
    const params = matchPrefix(command.path, positionals);
    return params === null ? [] : [{ command, params }];
  });
  matches.sort((a, b) => Object.keys(a.params).length - Object.keys(b.params).length);
  return matches[0];
}

/** Команды под пространством имён `words` (`[]` — корень). */
export function commandsUnder(words: readonly string[]): Command[] {
  return COMMANDS.filter(
    (c) => c.path.length > words.length && matchPrefix(c.path, words) !== null,
  );
}

/** Пространство имён: слова — строгий префикс хотя бы одной команды. */
export const isNamespace = (words: readonly string[]): boolean => commandsUnder(words).length > 0;

/** Следующие сегменты под пространством имён: для `list`. */
export function childrenOf(words: readonly string[]): string[] {
  return [...new Set(commandsUnder(words).map((c) => c.path[words.length] ?? ''))];
}

function usageLine(c: Command): string {
  const parts = ['harness', ...c.path, c.options, '[--root <dir>]'].filter(
    (p): p is string => p !== undefined && p !== '',
  );
  return `  ${parts.join(' ')}`;
}

/** Справка: все команды или команды под пространством имён. */
export function renderUsage(words: readonly string[] = []): string {
  const list = words.length === 0 ? COMMANDS : commandsUnder(words);
  return [
    'Использование:',
    ...list.map(usageLine),
    '',
    'list и help работают на каждом уровне: harness plan list, harness session <сессия> help.',
    'Без аргументов в терминале — оболочка с переходом по уровням и `..`.',
    'Коды выхода: 0 — ok, 1 — найдены нарушения, 2 — ошибка вызова или конфигурации.',
  ].join('\n');
}
