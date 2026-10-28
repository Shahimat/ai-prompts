import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type { CommandArgs } from '#shared/args';
import { errorCode, isRecord } from '#shared/guards';
import { CONTEXT_INDEX_PATH, DELTA_DIR } from '#shared/layout';

export const DOCS_FILES = ['CHANGELOG.md', 'context/project.yml', CONTEXT_INDEX_PATH, 'CLAUDE.md'];
export const DOCS_DIRS = [
  'context/conventions/',
  'docs/',
  `${DELTA_DIR}/`,
  '.claude/skills/',
  '.claude/agents/',
  '.codex/agents/',
];
export const GUARDED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

export async function moduleLayers(root: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(path.join(root, 'context/modules'));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  const layers: string[] = [];
  for (const name of names.filter((n) => n.endsWith('.yml'))) {
    const data: unknown = parse(await readFile(path.join(root, 'context/modules', name), 'utf8'));
    const provides = isRecord(data) ? data['provides'] : undefined;
    const list = isRecord(provides) ? provides['layers'] : undefined;
    if (Array.isArray(list))
      for (const l of list) if (typeof l === 'string' && l !== '') layers.push(l);
  }
  return layers;
}

export function guardedReason(rel: string, layers: readonly string[]): string | undefined {
  if (DOCS_FILES.includes(rel)) return `${rel} — файл проектной документации`;
  const dir = [...DOCS_DIRS, ...layers.map((l) => (l.endsWith('/') ? l : `${l}/`))].find((d) =>
    rel.startsWith(d),
  );
  if (dir !== undefined) return `${rel} — слой ${dir}`;
  return layers.includes(rel) ? `${rel} — слой модуля` : undefined;
}

export interface GuardDecision {
  block: boolean;
  message?: string;
}

export async function guardDecision(root: string, input: unknown): Promise<GuardDecision> {
  if (!isRecord(input) || typeof input['tool_name'] !== 'string') return { block: false };
  if (!GUARDED_TOOLS.includes(input['tool_name'])) return { block: false };
  const tool = isRecord(input['tool_input']) ? input['tool_input'] : {};
  const file = tool['file_path'] ?? tool['notebook_path'];
  if (typeof file !== 'string' || file === '') return { block: false };
  const rel = path.relative(path.resolve(root), path.resolve(root, file)).split(path.sep).join('/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { block: false };
  const reason = guardedReason(rel, await moduleLayers(root));
  if (reason === undefined) return { block: false };
  return {
    block: true,
    message: `${reason}: в основной сессии документация только читается. Правки — намерениями: npx ai docs-delta start --name <имя> --file - (JSON по схеме intents на stdin); генерируемое — npx ai.`,
  };
}

async function stdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

export async function runDocsGuard(args: CommandArgs): Promise<number> {
  const text = await stdinText();
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return 0;
  }
  const decision = await guardDecision(args.root, input);
  if (!decision.block) return 0;
  console.error(decision.message);
  return 2;
}
