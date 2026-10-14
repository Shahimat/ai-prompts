import { runAdapters } from './adapters.ts';
import { runChangelog } from './changelog.ts';
import { runCheck } from './check.ts';
import { runContext } from './context.ts';
import { runDelta } from './delta.ts';
import { runExpect } from './expect.ts';
import { runOutdated } from './outdated.ts';
import {
  runPlanGraph,
  runPlanList,
  runPlanStart,
  runPlanValidate,
  runSessionCheck,
  runSessionClone,
  runSessionList,
  runSessionRead,
  runSessionRender,
  runSessionResume,
  runSessionRetry,
  runSessionStatus,
} from './plan.ts';
import { runIndex } from './prompt-index.ts';
import { runSecretsScan } from './secrets.ts';
import type { CommandArgs } from './types.ts';

export interface Command {
  /**
   * Путь команды из позиционных аргументов: `['expect', 'judge']`.
   * Сегмент `<имя>` — параметр: совпадает с любым словом и попадает
   * в `args.params`.
   */
  path: readonly string[];
  /** Опции для справки, кроме общей `--root`. */
  options?: string;
  run: (args: CommandArgs) => Promise<number>;
}

const HOME = '[--home <dir>]';

/** Дерево команд CLI: из него строятся разбор аргументов, справка и оболочка. */
export const COMMANDS: readonly Command[] = [
  { path: ['check'], run: runCheck },
  { path: ['adapters', 'sync'], run: (args) => runAdapters('sync', args) },
  { path: ['changelog', 'lint'], run: (args) => runChangelog('lint', args) },
  { path: ['context', 'index'], run: (args) => runContext('index', args) },
  { path: ['delta', 'check'], run: (args) => runDelta('check', args) },
  { path: ['delta', 'close'], run: (args) => runDelta('close', args) },
  { path: ['outdated'], run: (args) => runOutdated(args) },
  { path: ['expect', 'init'], run: (args) => runExpect('init', args) },
  { path: ['expect', 'report'], run: (args) => runExpect('report', args) },
  { path: ['expect', 'lint'], run: (args) => runExpect('lint', args) },
  { path: ['expect', 'judge'], options: '[--apply]', run: (args) => runExpect('judge', args) },
  {
    path: ['index', 'build'],
    options: '--raw-base <url> [--out <file>]',
    run: (args) => runIndex('build', args),
  },
  { path: ['index', 'check'], options: '--raw-base <url>', run: (args) => runIndex('check', args) },
  { path: ['secrets', 'scan'], options: '[--file <path>]', run: runSecretsScan },
  { path: ['plan', 'list'], options: HOME, run: runPlanList },
  {
    path: ['plan', '<harness>', 'start'],
    options: `[--name <название>] [--request <запрос>] ${HOME}`,
    run: runPlanStart,
  },
  { path: ['plan', '<harness>', 'validate'], options: HOME, run: runPlanValidate },
  { path: ['plan', '<harness>', 'graph'], options: HOME, run: runPlanGraph },
  { path: ['session', 'list'], options: HOME, run: runSessionList },
  { path: ['session', '<session>', 'status'], options: HOME, run: runSessionStatus },
  { path: ['session', '<session>', 'resume'], options: HOME, run: runSessionResume },
  { path: ['session', '<session>', 'retry'], options: HOME, run: runSessionRetry },
  { path: ['session', '<session>', 'check'], options: `[--hook] ${HOME}`, run: runSessionCheck },
  {
    path: ['session', '<session>', 'render'],
    options: `[--out <file>] ${HOME}`,
    run: runSessionRender,
  },
  { path: ['session', '<session>', 'read'], options: HOME, run: runSessionRead },
  {
    path: ['session', '<session>', 'clone', '*'],
    options: `[--out <dir>] ${HOME}`,
    run: (args) => runSessionClone('all', args),
  },
  {
    path: ['session', '<session>', 'clone', 'md'],
    options: `[--out <path>] ${HOME}`,
    run: (args) => runSessionClone('md', args),
  },
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
