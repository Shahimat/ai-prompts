// Реестр команд: узлы CLI вида command. Скрипты исполняются по нему,
// дерево CLI собирается из него, скриптов и операций harness.

import { runAdapters } from '../commands/adapters/index.ts';
import { runChangelog } from '../commands/changelog/index.ts';
import { runContext } from '../commands/context/index.ts';
import { runDelta } from '../commands/delta/index.ts';
import { runExpect } from '../commands/expect/index.ts';
import { runOutdated } from '../commands/outdated/index.ts';
import { runIndex } from '../commands/prompt-index/index.ts';
import { runSecretsScan } from '../commands/secrets/index.ts';
import type { CommandNode } from '../shared/node.ts';

export const COMMAND_NODES: readonly CommandNode[] = [
  {
    path: ['adapters', 'sync'],
    kind: 'command',
    effect: 'mutation',
    run: (args) => runAdapters('sync', args),
  },
  {
    path: ['adapters', 'check'],
    kind: 'command',
    effect: 'query',
    run: (args) => runAdapters('check', args),
  },
  {
    path: ['changelog', 'lint'],
    kind: 'command',
    effect: 'query',
    run: (args) => runChangelog('lint', args),
  },
  {
    path: ['context', 'index'],
    kind: 'command',
    effect: 'mutation',
    run: (args) => runContext('index', args),
  },
  {
    path: ['context', 'check'],
    kind: 'command',
    effect: 'query',
    run: (args) => runContext('check', args),
  },
  {
    path: ['delta', 'check'],
    kind: 'command',
    effect: 'query',
    run: (args) => runDelta('check', args),
  },
  {
    path: ['delta', 'close'],
    kind: 'command',
    effect: 'mutation',
    run: (args) => runDelta('close', args),
  },
  { path: ['outdated'], kind: 'command', effect: 'query', run: (args) => runOutdated(args) },
  {
    path: ['expect', 'init'],
    kind: 'command',
    effect: 'mutation',
    run: (args) => runExpect('init', args),
  },
  {
    path: ['expect', 'report'],
    kind: 'command',
    effect: 'query',
    run: (args) => runExpect('report', args),
  },
  {
    path: ['expect', 'lint'],
    kind: 'command',
    effect: 'query',
    run: (args) => runExpect('lint', args),
  },
  {
    path: ['expect', 'judge'],
    kind: 'command',
    effect: 'mutation',
    options: '[--apply]',
    run: (args) => runExpect('judge', args),
  },
  {
    path: ['index', 'build'],
    kind: 'command',
    effect: 'mutation',
    options: '--raw-base <url> [--out <file>]',
    run: (args) => runIndex('build', args),
  },
  {
    path: ['index', 'check'],
    kind: 'command',
    effect: 'query',
    options: '--raw-base <url>',
    run: (args) => runIndex('check', args),
  },
  {
    path: ['secrets', 'scan'],
    kind: 'command',
    effect: 'query',
    options: '[--file <path>]',
    run: runSecretsScan,
  },
];
