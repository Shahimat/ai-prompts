import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Diagnostic } from '#shared/diagnostics';
import { parseAgent, type AgentDef } from '#lib/agent';
import { errorCode } from '#shared/guards';

export type { AgentDef } from '#lib/agent';

export const AGENTS_MD = 'AGENTS.md';
export const SKILLS_DIR = '.agents/skills';
export const AGENTS_DIR = '.agents/agents';

export interface SkillFile {
  rel: string;
  content: Buffer;
}

export interface Skill {
  name: string;
  files: SkillFile[];
}

export interface Sources {
  hasAgentsMd: boolean;
  skills: Skill[];
  agents: AgentDef[];
  diagnostics: Diagnostic[];
}

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
