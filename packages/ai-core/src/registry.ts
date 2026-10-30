import { runAdapters } from '#commands/adapters/index';
import { runChangelog } from '#commands/changelog/index';
import { runContext } from '#commands/context/index';
import { runDelta } from '#commands/delta/index';
import { runDocsGuard } from '#commands/docs/index';
import { runExpect } from '#commands/expect/index';
import { runOutdated } from '#commands/outdated/index';
import { runIndex } from '#commands/prompt-index/index';
import { runRoleCommand } from '#commands/role/index';
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
    options: '[--name <дельта>]',
    run: (args) => runDelta('check', args),
  },
  {
    path: ['delta', 'close'],
    kind: 'command',
    effect: 'mutation',
    options: '[--name <дельта>]',
    run: (args) => runDelta('close', args),
  },
  {
    path: ['docs', 'guard'],
    kind: 'command',
    effect: 'query',
    run: (args) => runDocsGuard(args),
  },
  { path: ['outdated'], kind: 'command', effect: 'query', run: (args) => runOutdated(args) },
  {
    path: ['role', 'run', '<name>'],
    kind: 'command',
    effect: 'mutation',
    options: '--file <задание> [--out <ответ>]',
    run: (args) => runRoleCommand('run', args),
  },
  {
    path: ['role', 'channel', '<message>'],
    kind: 'command',
    effect: 'mutation',
    options: '--out <файл>',
    run: (args) => runRoleCommand('channel', args),
  },
  {
    path: ['expect', 'init'],
    kind: 'command',
    effect: 'mutation',
    run: (args) => runExpect('init', args),
  },
  {
    path: ['expect', 'report', '<file>'],
    kind: 'command',
    effect: 'query',
    effects: { html: 'mutation' },
    options: '[--html <out>]',
    run: (args) => runExpect('report', args),
  },
  {
    path: ['expect', 'serve', '<file>'],
    kind: 'command',
    effect: 'query',
    options: '[--port <n>]',
    run: (args) => runExpect('serve', args),
  },
  {
    path: ['expect', 'lint', '<file>'],
    kind: 'command',
    effect: 'query',
    run: (args) => runExpect('lint', args),
  },
  {
    path: ['expect', 'judge', '<file>'],
    kind: 'command',
    effect: 'mutation',
    options: '[--apply | --run]',
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
