import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AdapterName } from '#shared/config';
import type { Diagnostic } from '#shared/diagnostics';
import { errorCode } from '#shared/guards';
import { claudeMemory, CODEX_CONFIG, codexMemory } from './memory.ts';
import {
  claudeAgent,
  claudeMd,
  codexAgent,
  GENERATED_MARK,
  SKILL_MARKER_FILE,
  skillMarker,
} from './render.ts';
import { AGENTS_MD, readSources } from './source.ts';

const CLAUDE_MD = 'CLAUDE.md';
const CLAUDE_SKILLS = '.claude/skills';
const CLAUDE_AGENTS = '.claude/agents';
const CODEX_AGENTS = '.codex/agents';

interface FileUnit {
  kind: 'file';
  path: string;
  content: Buffer;
}

interface DirUnit {
  kind: 'dir';
  path: string;
  files: Map<string, Buffer>;
}

type Unit = FileUnit | DirUnit;

export interface Action {
  op: 'write' | 'delete';
  path: string;
  content?: Buffer;
}

export interface SyncResult {
  actions: Action[];
  diagnostics: Diagnostic[];
}

const text = (value: string): Buffer => Buffer.from(value, 'utf8');
const isOurs = (content: Buffer): boolean => content.includes(GENERATED_MARK);

async function readOrNull(abs: string): Promise<Buffer | null> {
  try {
    return await readFile(abs);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'EISDIR') return null;
    throw error;
  }
}

async function listFiles(abs: string): Promise<string[]> {
  try {
    const entries = await readdir(abs, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => path.relative(abs, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
      .sort();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
}

async function listNames(abs: string): Promise<string[]> {
  try {
    return (await readdir(abs)).sort();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
}

async function plan(
  root: string,
  adapters: readonly AdapterName[],
): Promise<{ units: Unit[]; diagnostics: Diagnostic[] }> {
  const sources = await readSources(root);
  const diagnostics = [...sources.diagnostics];
  const units: Unit[] = [];

  if (adapters.includes('claude-code')) {
    if (sources.hasAgentsMd) {
      units.push({ kind: 'file', path: CLAUDE_MD, content: text(claudeMd()) });
    } else {
      diagnostics.push({
        file: AGENTS_MD,
        message: 'файл не найден: CLAUDE.md не из чего генерировать',
      });
    }
    for (const skill of sources.skills) {
      const files = new Map(skill.files.map((f) => [f.rel, f.content]));
      files.set(SKILL_MARKER_FILE, text(skillMarker(skill.name)));
      units.push({ kind: 'dir', path: `${CLAUDE_SKILLS}/${skill.name}`, files });
    }
    for (const agent of sources.agents) {
      units.push({
        kind: 'file',
        path: `${CLAUDE_AGENTS}/${agent.name}.md`,
        content: text(claudeAgent(agent)),
      });
    }
  }
  if (adapters.includes('codex')) {
    for (const agent of sources.agents) {
      units.push({
        kind: 'file',
        path: `${CODEX_AGENTS}/${agent.name}.toml`,
        content: text(codexAgent(agent)),
      });
    }
  }
  return { units, diagnostics };
}

const conflict = (file: string): Diagnostic => ({
  file,
  message:
    'существует и написан не harness — не трогаю; перенеси содержимое в источник (.agents/, AGENTS.md) и удали файл',
});

async function staleActions(root: string, planned: Set<string>): Promise<Action[]> {
  const actions: Action[] = [];
  const consider = async (rel: string): Promise<void> => {
    if (planned.has(rel)) return;
    const content = await readOrNull(path.join(root, rel));
    if (content !== null && isOurs(content)) actions.push({ op: 'delete', path: rel });
  };
  await consider(CLAUDE_MD);
  await consider(CODEX_CONFIG);
  for (const name of await listNames(path.join(root, CLAUDE_AGENTS))) {
    if (name.endsWith('.md')) await consider(`${CLAUDE_AGENTS}/${name}`);
  }
  for (const name of await listNames(path.join(root, CODEX_AGENTS))) {
    if (name.endsWith('.toml')) await consider(`${CODEX_AGENTS}/${name}`);
  }
  for (const name of await listNames(path.join(root, CLAUDE_SKILLS))) {
    const dir = `${CLAUDE_SKILLS}/${name}`;
    if (planned.has(dir)) continue;
    const marker = await readOrNull(path.join(root, dir, SKILL_MARKER_FILE));
    if (marker !== null && isOurs(marker)) actions.push({ op: 'delete', path: dir });
  }
  return actions;
}

export async function computeSync(
  root: string,
  adapters: readonly AdapterName[],
): Promise<SyncResult> {
  const { units, diagnostics } = await plan(root, adapters);
  const actions: Action[] = [];

  for (const unit of units) {
    if (unit.kind === 'file') {
      const current = await readOrNull(path.join(root, unit.path));
      if (current === null) actions.push({ op: 'write', path: unit.path, content: unit.content });
      else if (!isOurs(current)) diagnostics.push(conflict(unit.path));
      else if (!current.equals(unit.content))
        actions.push({ op: 'write', path: unit.path, content: unit.content });
      continue;
    }
    const existing = await listFiles(path.join(root, unit.path));
    if (existing.length > 0) {
      const marker = await readOrNull(path.join(root, unit.path, SKILL_MARKER_FILE));
      if (marker === null || !isOurs(marker)) {
        diagnostics.push(conflict(unit.path));
        continue;
      }
    }
    for (const [rel, content] of unit.files) {
      const current = await readOrNull(path.join(root, unit.path, rel));
      if (current === null || !current.equals(content)) {
        actions.push({ op: 'write', path: `${unit.path}/${rel}`, content });
      }
    }
    for (const rel of existing) {
      if (!unit.files.has(rel)) actions.push({ op: 'delete', path: `${unit.path}/${rel}` });
    }
  }

  const planned = new Set(units.map((u) => u.path));
  for (const [adapter, apply] of [
    ['claude-code', claudeMemory],
    ['codex', codexMemory],
  ] as const) {
    if (!adapters.includes(adapter)) continue;
    const memory = await apply(root);
    actions.push(...memory.actions);
    diagnostics.push(...memory.diagnostics);
    if (adapter === 'codex') planned.add(CODEX_CONFIG);
  }

  actions.push(...(await staleActions(root, planned)));
  return { actions, diagnostics };
}

export async function applyActions(root: string, actions: Action[]): Promise<void> {
  for (const action of actions) {
    const abs = path.join(root, action.path);
    if (action.op === 'delete') {
      await rm(abs, { recursive: true, force: true });
      continue;
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, action.content ?? Buffer.alloc(0));
  }
}

export async function checkAdapters(
  root: string,
  adapters: readonly AdapterName[],
): Promise<Diagnostic[]> {
  const { actions, diagnostics } = await computeSync(root, adapters);
  for (const action of actions) {
    const what = action.op === 'write' ? 'отсутствует или устарел' : 'лишний';
    diagnostics.push({ file: action.path, message: `${what}: запусти ai-core adapters sync` });
  }
  return diagnostics;
}
