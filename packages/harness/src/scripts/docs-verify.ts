import type { ScriptDef } from '../shared/node.ts';
import { CHECK } from './check.ts';

/** Состояние verify в docs-delta: производные файлы, сверка дельты и проверки. В CLI его нет. */
export const DOCS_VERIFY: ScriptDef = {
  path: ['docs', 'verify'],
  steps: [
    { command: ['context', 'index'], enabledBy: 'context-index' },
    { command: ['adapters', 'sync'], enabledBy: 'adapters' },
    { command: ['delta', 'check'] },
    ...CHECK.steps,
  ],
};
