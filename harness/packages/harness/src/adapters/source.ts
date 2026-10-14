import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Diagnostic } from '../diagnostics.ts';
import { errorCode, errorMessage } from '../guards.ts';
import { normalizeEol, parseFrontmatter } from '../frontmatter.ts';

export const AGENTS_MD = 'AGENTS.md';
export const SKILLS_DIR = '.agents/skills';
export const AGENTS_DIR = '.agents/agents';

/** Файл skill: путь внутри каталога skill (через `/`) и содержимое. */
export interface SkillFile {
  rel: string;
  content: Buffer;
}

export interface Skill {
  name: string;
  files: SkillFile[];
}

/** Субагент из `.agents/agents/<name>.md`. */
export interface AgentDef {
  name: string;
  source: string;
  description: string;
  skills: string[];
  tools: string[];
  instructions: string;
}

export interface Sources {
  hasAgentsMd: boolean;
  skills: Skill[];
  agents: AgentDef[];
  diagnostics: Diagnostic[];
}

const AGENT_KEYS = ['name', 'description', 'skills', 'tools'];

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
}

async function readSkill(root: string, name: string): Promise<Skill> {
  const dir = path.join(root, SKILLS_DIR, name);
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files: SkillFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    files.push({
      rel: path.relative(dir, abs).split(path.sep).join('/'),
      content: await readFile(abs),
    });
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { name, files };
}

function stringList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((v): v is string => typeof v === 'string' && v !== ''))
    return null;
  return value;
}

function parseAgent(
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
  const { name, description } = fm;
  if (name !== expected) report(`name «${String(name)}» не совпадает с именем файла «${expected}»`);
  if (typeof description !== 'string' || description.trim() === '') report('нет поля description');
  const skills = stringList(fm['skills']);
  if (skills === null) report('skills должно быть списком строк');
  const tools = stringList(fm['tools']);
  if (tools === null) report('tools должно быть списком строк');

  const body = normalizeEol(text).split('\n');
  const end = body.indexOf('---', 1);
  const instructions = body
    .slice(end + 1)
    .join('\n')
    .trim();
  if (instructions === '') report('пустое тело: инструкции субагента');

  if (name !== expected || typeof description !== 'string' || skills === null || tools === null)
    return null;
  if (description.trim() === '' || instructions === '') return null;
  return {
    name: expected,
    source: file,
    description: description.trim(),
    skills,
    tools,
    instructions,
  };
}

/** Читает канонические источники адаптеров. */
export async function readSources(root: string): Promise<Sources> {
  const diagnostics: Diagnostic[] = [];
  const hasAgentsMd = await access(path.join(root, AGENTS_MD)).then(
    () => true,
    () => false,
  );

  const skills: Skill[] = [];
  for (const name of await listDir(path.join(root, SKILLS_DIR))) {
    const skill = await readSkill(root, name).catch((error: unknown) => {
      if (errorCode(error) === 'ENOTDIR') return null;
      throw error;
    });
    if (skill === null) continue;
    if (!skill.files.some((f) => f.rel === 'SKILL.md')) {
      diagnostics.push({
        file: `${SKILLS_DIR}/${name}`,
        message: 'нет SKILL.md — не skill, пропущен',
      });
      continue;
    }
    skills.push(skill);
  }

  const agents: AgentDef[] = [];
  for (const entry of await listDir(path.join(root, AGENTS_DIR))) {
    if (!entry.endsWith('.md')) continue;
    const file = `${AGENTS_DIR}/${entry}`;
    const report = (message: string): void => {
      diagnostics.push({ file, message });
    };
    const agent = parseAgent(file, await readFile(path.join(root, file), 'utf8'), report);
    if (agent === null) continue;
    for (const skill of agent.skills) {
      if (!skills.some((s) => s.name === skill))
        report(`skill «${skill}» не найден в ${SKILLS_DIR}`);
    }
    agents.push(agent);
  }
  return { hasAgentsMd, skills, agents, diagnostics };
}
