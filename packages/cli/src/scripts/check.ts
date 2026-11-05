import type { ScriptDef } from '@shahimat/ai-core';

export const CHECK: ScriptDef = {
  path: ['check'],
  steps: [
    { command: ['changelog', 'lint'], enabledBy: 'changelog' },
    { command: ['tree', 'check'] },
    { command: ['context', 'check'], enabledBy: 'context' },
    { command: ['adapters', 'check'], enabledBy: 'adapters' },
    { command: ['secrets', 'scan'], enabledBy: 'secrets' },
  ],
};
