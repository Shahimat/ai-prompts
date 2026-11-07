import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AdapterName } from '#shared/config';
import type { Diagnostic } from '#shared/diagnostics';
import { errorCode } from '#shared/guards';
import { loadModelManifest, resolveManifestModel } from '#lib/project-models';
import { legacyModelOverrides } from '#lib/legacy-models';
import { PROJECT_PATH } from '#shared/layout';
import { WARNING_PREFIX } from '#shared/report';
import { CODEX_CONFIG, codexMemory, OPENCODE_CONFIG, opencodeMemory } from './memory.ts';
import { codexAgent, GENERATED_MARK } from './render.ts';
import { opencodeAgent } from './opencode.ts';
import { readSources } from './source.ts';

const CODEX_AGENTS = '.codex/agents';
const OPENCODE_AGENTS = '.opencode/agents';

interface FileUnit {
  path: string;
  content: Buffer;
}

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
): Promise<{ units: FileUnit[]; diagnostics: Diagnostic[] }> {
  const sources = await readSources(root);
  const manifest = await loadModelManifest(root);
  const diagnostics = [...sources.diagnostics];
  if (manifest !== null) {
    const stale = Object.keys(await legacyModelOverrides(root));
    if (stale.length > 0)
      diagnostics.push({
        file: PROJECT_PATH,
        message: `${WARNING_PREFIX} manifest активен: legacy roles.models игнорируются; удалить через librarian: ${stale.sort().join(', ')}`,
      });
  }
  const units: FileUnit[] = [];

  if (adapters.includes('codex')) {
    for (const agent of sources.agents) {
      units.push({
        path: `${CODEX_AGENTS}/${agent.name}.toml`,
        content: text(codexAgent(agent)),
      });
    }
  }
  if (adapters.includes('opencode') || manifest !== null) {
    for (const agent of sources.agents) {
      units.push({
        path: `${OPENCODE_AGENTS}/${agent.name}.md`,
        content: text(
          opencodeAgent(
            manifest === null
              ? agent
              : { ...agent, model: resolveManifestModel(manifest, agent.name).model },
          ),
        ),
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
  await consider(CODEX_CONFIG);
  for (const name of await listNames(path.join(root, CODEX_AGENTS))) {
    if (name.endsWith('.toml')) await consider(`${CODEX_AGENTS}/${name}`);
  }
  for (const name of await listNames(path.join(root, OPENCODE_AGENTS))) {
    if (name.endsWith('.md')) await consider(`${OPENCODE_AGENTS}/${name}`);
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
    const current = await readOrNull(path.join(root, unit.path));
    if (current === null) actions.push({ op: 'write', path: unit.path, content: unit.content });
    else if (!isOurs(current)) diagnostics.push(conflict(unit.path));
    else if (!current.equals(unit.content))
      actions.push({ op: 'write', path: unit.path, content: unit.content });
  }

  const planned = new Set(units.map((u) => u.path));
  if (adapters.includes('codex')) {
    const memory = await codexMemory(root);
    actions.push(...memory.actions);
    diagnostics.push(...memory.diagnostics);
    planned.add(CODEX_CONFIG);
  }

  const opencode = await opencodeMemory(root);
  actions.push(...opencode.actions);
  diagnostics.push(...opencode.diagnostics);
  planned.add(OPENCODE_CONFIG);

  if ((await loadModelManifest(root)) === null)
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
    diagnostics.push({ file: action.path, message: `${what}: запусти ai adapters sync` });
  }
  return diagnostics;
}
