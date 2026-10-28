import type { ScriptDef } from '#shared/node';
import { CHECK } from './check.ts';

export const DOCS_VERIFY: ScriptDef = {
  path: ['docs', 'verify'],
  steps: [
    { command: ['context', 'index'], enabledBy: 'context-index' },
    { command: ['adapters', 'sync'], enabledBy: 'adapters' },
    { command: ['delta', 'check'] },
    ...CHECK.steps,
  ],
};
