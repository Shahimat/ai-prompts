import { stringify } from 'yaml';
import { SUBMIT_TOOL } from '#lib/protocol';
import type { AgentDef } from './source.ts';
import { GENERATED_MARK } from './render.ts';

export function opencodeAgent(agent: AgentDef): string {
  const fields: Record<string, unknown> = { description: agent.description, mode: 'subagent' };
  const tools: Record<string, boolean> = { [SUBMIT_TOOL]: true };
  for (const tool of agent.tools) tools[tool.toLowerCase()] = true;
  fields['tools'] = tools;
  if (agent.model !== undefined) fields['model'] = agent.model;
  const yaml = stringify(fields, { lineWidth: 0 });
  const preface =
    agent.skills.length > 0 ? `Перед работой загрузи skills: ${agent.skills.join(', ')}.\n\n` : '';
  return `---\n# ${GENERATED_MARK} from ${agent.source} — do not edit\n${yaml}---\n\n${preface}${agent.instructions}\n`;
}
