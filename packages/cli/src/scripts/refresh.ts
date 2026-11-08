import type { ScriptDef } from '@shahimat/ai-core';
import { CHECK } from './check.ts';

export const REFRESH: ScriptDef = {
  path: ['refresh'],
  steps: [
    { command: ['adapters', 'sync'], enabledBy: 'adapters' },
    { command: ['memory', 'build'] },
    ...CHECK.steps,
  ],
};
