import type { ScriptDef } from '@shahimat/ai-core';

export const CHECK: ScriptDef = {
  path: ['check'],
  steps: [
    { command: ['changelog', 'lint'], enabledBy: 'changelog' },
    { command: ['context', 'check'], enabledBy: 'context-index' },
    { command: ['adapters', 'check'], enabledBy: 'adapters' },
    { command: ['secrets', 'scan'], enabledBy: 'secrets' },
  ],
};
