import type { ScriptDef } from '#shared/node';
import { CHECK } from './check.ts';

export const REFRESH: ScriptDef = {
  path: ['refresh'],
  steps: [
    { command: ['context', 'index'], enabledBy: 'context-index' },
    { command: ['adapters', 'sync'], enabledBy: 'adapters' },
    ...CHECK.steps,
  ],
};
