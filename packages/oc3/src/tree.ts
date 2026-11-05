import {
  commandTree,
  runAdapters,
  runContext,
  runExpect,
  runGoals,
  runModels,
  runOperator,
  runRoles,
  runSkills,
  runTree,
  type CommandArgs,
  type CommandNode,
} from '@shahimat/ai-core';
import { runInit } from '#init';
import { runMigrate } from '#migrate';
import { runBriefing } from '#briefing';

export const BIN = 'oc3';

export const OC3_COMMANDS = {
  modelsList: (args: CommandArgs): Promise<number> => runModels('list', args),
  modelsSet: (args: CommandArgs): Promise<number> => runModels('set', args),
  modelsApply: (args: CommandArgs): Promise<number> => runModels('apply', args),
  briefingShow: (args: CommandArgs): Promise<number> => runBriefing('show', args),
  briefingSet: (args: CommandArgs): Promise<number> => runBriefing('set', args),
  goalsCheck: (args: CommandArgs): Promise<number> => runGoals('check', args),
  goalsStatus: (args: CommandArgs): Promise<number> => runGoals('status', args),
  operatorCheck: (args: CommandArgs): Promise<number> => runOperator('check', args),
  rolesCheck: (args: CommandArgs): Promise<number> => runRoles('check', args),
  skillsCheck: (args: CommandArgs): Promise<number> => runSkills('check', args),
  adaptersSync: (args: CommandArgs): Promise<number> => runAdapters('sync', args),
  adaptersCheck: (args: CommandArgs): Promise<number> => runAdapters('check', args),
  treeCheck: (args: CommandArgs): Promise<number> => runTree('check', args),
  contextCheck: (args: CommandArgs): Promise<number> => runContext('check', args),
  expectReport: (args: CommandArgs): Promise<number> => runExpect('report', args),
} as const;

const NODES: readonly CommandNode[] = [
  { path: ['models'], kind: 'command', effect: 'query', run: OC3_COMMANDS.modelsList },
  {
    path: ['models', 'set', '<role>', '<model>'],
    kind: 'command',
    effect: 'mutation',
    run: OC3_COMMANDS.modelsSet,
  },
  {
    path: ['models', 'apply'],
    kind: 'command',
    effect: 'mutation',
    run: OC3_COMMANDS.modelsApply,
  },
  { path: ['briefing'], kind: 'command', effect: 'query', run: OC3_COMMANDS.briefingShow },
  {
    path: ['briefing', 'set', '<mode>'],
    kind: 'command',
    effect: 'mutation',
    run: OC3_COMMANDS.briefingSet,
  },
  {
    path: ['briefing', 'set', '<mode>', '<routing>', '<research>', '<judge>', '<ticket_mode>'],
    kind: 'command',
    effect: 'mutation',
    run: OC3_COMMANDS.briefingSet,
  },
  {
    path: ['goals', 'check', '<file>'],
    kind: 'command',
    effect: 'query',
    options: '--ticket <key>',
    run: OC3_COMMANDS.goalsCheck,
  },
  { path: ['goals', 'status'], kind: 'command', effect: 'query', run: OC3_COMMANDS.goalsStatus },
  {
    path: ['goals', 'status', '<file>'],
    kind: 'command',
    effect: 'query',
    run: OC3_COMMANDS.goalsStatus,
  },
  {
    path: ['operator', 'state', 'check'],
    kind: 'command',
    effect: 'query',
    run: OC3_COMMANDS.operatorCheck,
  },
  { path: ['roles', 'check'], kind: 'command', effect: 'query', run: OC3_COMMANDS.rolesCheck },
  { path: ['skills', 'check'], kind: 'command', effect: 'query', run: OC3_COMMANDS.skillsCheck },
  {
    path: ['adapters', 'sync'],
    kind: 'command',
    effect: 'mutation',
    run: OC3_COMMANDS.adaptersSync,
  },
  {
    path: ['adapters', 'check'],
    kind: 'command',
    effect: 'query',
    run: OC3_COMMANDS.adaptersCheck,
  },
  {
    path: ['tree', 'check'],
    kind: 'command',
    effect: 'query',
    run: OC3_COMMANDS.treeCheck,
  },
  {
    path: ['context', 'check'],
    kind: 'command',
    effect: 'query',
    run: OC3_COMMANDS.contextCheck,
  },
  {
    path: ['expect', 'report', '<file>'],
    kind: 'command',
    effect: 'query',
    run: OC3_COMMANDS.expectReport,
  },
  {
    path: ['init'],
    kind: 'command',
    effect: 'mutation',
    options: '--roles <список>',
    run: runInit,
  },
  {
    path: ['migrate'],
    kind: 'command',
    effect: 'mutation',
    run: runMigrate,
  },
];

export const OC3_TREE = commandTree(BIN, NODES);
