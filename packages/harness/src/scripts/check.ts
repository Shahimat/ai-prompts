import type { ScriptDef } from '../shared/node.ts';

/** `harness check` — все проверки, включённые в context/harness.yml. */
export const CHECK: ScriptDef = {
  path: ['check'],
  steps: [
    { command: ['changelog', 'lint'], enabledBy: 'changelog' },
    { command: ['context', 'check'], enabledBy: 'context-index' },
    { command: ['adapters', 'check'], enabledBy: 'adapters' },
    { command: ['secrets', 'scan'], enabledBy: 'secrets' },
  ],
};
