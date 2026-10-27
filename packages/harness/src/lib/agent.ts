import path from 'node:path';
import { errorMessage } from '#shared/guards';
import { normalizeEol, parseFrontmatter } from '#shared/frontmatter';
import { isProtocolMessage, type ProtocolMessage } from './protocol.ts';

export const ROLE_MODELS = ['opus', 'sonnet', 'haiku'] as const;
export type RoleModel = (typeof ROLE_MODELS)[number];

export interface AgentDef {
  name: string;
  source: string;
  description: string;
  skills: string[];
  tools: string[];
  model?: RoleModel;
  output?: ProtocolMessage;
  instructions: string;
}

const AGENT_KEYS = ['name', 'description', 'skills', 'tools', 'model', 'output'];

const isRoleModel = (v: unknown): v is RoleModel => ROLE_MODELS.some((m) => m === v);

function stringList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((v): v is string => typeof v === 'string' && v !== ''))
    return null;
  return value;
}

export function parseAgent(
  file: string,
  text: string,
  report: (message: string) => void,
): AgentDef | null {
  let fm;
  try {
    fm = parseFrontmatter(text);
  } catch (error) {
    report(`невалидный frontmatter: ${errorMessage(error).split('\n')[0]}`);
    return null;
  }
  if (fm === null) {
    report('нет frontmatter (--- name, description ---)');
    return null;
  }
  const extra = Object.keys(fm).filter((k) => !AGENT_KEYS.includes(k));
  if (extra.length > 0) report(`неизвестные поля frontmatter: ${extra.join(', ')}`);

  const expected = path.posix.basename(file, '.md');
  const { name, description, model, output } = fm;
  if (name !== expected) report(`name «${String(name)}» не совпадает с именем файла «${expected}»`);
  if (typeof description !== 'string' || description.trim() === '') report('нет поля description');
  const skills = stringList(fm['skills']);
  if (skills === null) report('skills должно быть списком строк');
  const tools = stringList(fm['tools']);
  if (tools === null) report('tools должно быть списком строк');
  const badModel = model !== undefined && !isRoleModel(model);
  if (badModel) report(`model — одно из ${ROLE_MODELS.join(', ')}`);
  const badOutput = output !== undefined && !isProtocolMessage(output);
  if (badOutput) report(`output — сообщение протокола: result, verdict или question`);

  const body = normalizeEol(text).split('\n');
  const end = body.indexOf('---', 1);
  const instructions = body
    .slice(end + 1)
    .join('\n')
    .trim();
  if (instructions === '') report('пустое тело: инструкции субагента');

  if (name !== expected || typeof description !== 'string' || skills === null || tools === null)
    return null;
  if (description.trim() === '' || instructions === '' || badModel || badOutput) return null;
  const agent: AgentDef = {
    name: expected,
    source: file,
    description: description.trim(),
    skills,
    tools,
    instructions,
  };
  if (isRoleModel(model)) agent.model = model;
  if (isProtocolMessage(output)) agent.output = output;
  return agent;
}
