import type { Command } from '#shared/node';

export type { Command } from '#shared/node';

const isParam = (segment: string): boolean => segment.startsWith('<') && segment.endsWith('>');

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

export interface CommandTree {
  bin: string;
  commands: readonly Command[];
  findCommand: (positionals: readonly string[]) => Match | undefined;
  commandsUnder: (words: readonly string[]) => Command[];
  isNamespace: (words: readonly string[]) => boolean;
  childrenOf: (words: readonly string[]) => string[];
  renderUsage: (words?: readonly string[]) => string;
}

export function commandTree(bin: string, commands: readonly Command[]): CommandTree {
  const findCommand = (positionals: readonly string[]): Match | undefined => {
    const matches = commands.flatMap((command) => {
      if (command.path.length !== positionals.length) return [];
      const params = matchPrefix(command.path, positionals);
      return params === null ? [] : [{ command, params }];
    });
    matches.sort((a, b) => Object.keys(a.params).length - Object.keys(b.params).length);
    return matches[0];
  };
  const commandsUnder = (words: readonly string[]): Command[] =>
    commands.filter((c) => c.path.length > words.length && matchPrefix(c.path, words) !== null);
  const usageLine = (c: Command): string => {
    const parts = [bin, ...c.path, c.options, '[--root <dir>]'].filter(
      (p): p is string => p !== undefined && p !== '',
    );
    return `  ${parts.join(' ')}`;
  };
  return {
    bin,
    commands,
    findCommand,
    commandsUnder,
    isNamespace: (words) => commandsUnder(words).length > 0,
    childrenOf: (words) => [
      ...new Set(commandsUnder(words).map((c) => c.path[words.length] ?? '')),
    ],
    renderUsage: (words = []) =>
      [
        'Использование:',
        ...(words.length === 0 ? commands : commandsUnder(words)).map(usageLine),
        '',
        `list и help работают на каждом уровне: ${bin} list, ${bin} <уровень> help.`,
        'Без аргументов в терминале — оболочка с переходом по уровням и `..`.',
        'Коды выхода: 0 — ok, 1 — найдены нарушения, 2 — ошибка вызова или конфигурации.',
      ].join('\n'),
  };
}
