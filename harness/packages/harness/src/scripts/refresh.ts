import type { ScriptDef } from '../shared/node.ts';
import { CHECK } from './check.ts';

/** `harness refresh` — пересобрать производные файлы и проверить проект. */
export const REFRESH: ScriptDef = {
  path: ['refresh'],
  steps: [
    { command: ['context', 'index'], enabledBy: 'context-index' },
    { command: ['adapters', 'sync'], enabledBy: 'adapters' },
    ...CHECK.steps,
  ],
};
