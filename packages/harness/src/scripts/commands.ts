import { runAdapters } from '#commands/adapters/index';
import { runChangelog } from '#commands/changelog/index';
import { runContext } from '#commands/context/index';
import { runDelta } from '#commands/delta/index';
import { runExpect } from '#commands/expect/index';
import { runOutdated } from '#commands/outdated/index';
import { runIndex } from '#commands/prompt-index/index';
import { runSecretsScan } from '#commands/secrets/index';
import type { CommandNode } from '#shared/node';

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
    effects: { html: 'mutation' },
    options: '[--html <out>] [--file <path>]',
    run: (args) => runExpect('report', args),
  },
  {
    path: ['expect', 'serve'],
    kind: 'command',
    effect: 'query',
    options: '[--file <path>] [--port <n>]',
    run: (args) => runExpect('serve', args),
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
