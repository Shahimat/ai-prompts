import { runAdapters } from './adapters.ts';
import { runChangelog } from './changelog.ts';
import { runCheck } from './check.ts';
import { runContext } from './context.ts';
import { runDelta } from './delta.ts';
import { runExpect } from './expect.ts';
import { runOutdated } from './outdated.ts';
import { runIndex } from './prompt-index.ts';
import type { CommandArgs } from './types.ts';

export interface Command {
  /** Путь команды из позиционных аргументов: `['expect', 'judge']`. */
  path: readonly string[];
  /** Опции для справки, кроме общей `--root`. */
  options?: string;
  run: (args: CommandArgs) => Promise<number>;
}

/** Дерево команд CLI: из него строятся разбор аргументов и справка. */
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
  { path: ['index', 'build'], options: '--raw-base <url> [--out <file>]', run: (args) => runIndex('build', args) },
  { path: ['index', 'check'], options: '--raw-base <url>', run: (args) => runIndex('check', args) },
];

/** Команда, путь которой — префикс позиционных аргументов. */
export function findCommand(positionals: readonly string[]): Command | undefined {
  return COMMANDS.find((c) => c.path.every((part, i) => positionals[i] === part));
}

export function renderUsage(): string {
  const lines = COMMANDS.map((c) => `  harness ${[...c.path, c.options, '[--root <dir>]'].filter(Boolean).join(' ')}`);
  return [
    'Использование:',
    ...lines,
    '',
    'Коды выхода: 0 — ok, 1 — найдены нарушения, 2 — ошибка вызова или конфигурации.',
  ].join('\n');
}
