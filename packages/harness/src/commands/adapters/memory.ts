// expect:memory-off
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Diagnostic } from '#shared/diagnostics';
import { errorCode, errorMessage, isRecord } from '#shared/guards';
import { GENERATED_MARK } from './render.ts';
import type { Action } from './sync.ts';

export const CLAUDE_SETTINGS = '.claude/settings.json';
export const CODEX_CONFIG = '.codex/config.toml';

const CODEX_MEMORY_KEYS = [
  'features.memories',
  'memories.use_memories',
  'memories.generate_memories',
] as const;

export function codexConfig(): string {
  return [
    `# ${GENERATED_MARK} — do not edit; memory агента запрещена контрактом`,
    '[features]',
    'memories = false',
    '',
    '[memories]',
    'use_memories = false',
    'generate_memories = false',
    '',
  ].join('\n');
}

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

export async function claudeMemory(
  root: string,
): Promise<{ actions: Action[]; diagnostics: Diagnostic[] }> {
  const current = await readOrNull(path.join(root, CLAUDE_SETTINGS));
  const write = (data: Record<string, unknown>): Action => ({
    op: 'write',
    path: CLAUDE_SETTINGS,
    content: Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8'),
  });
  if (current === null) return { actions: [write({ autoMemoryEnabled: false })], diagnostics: [] };

  let data: unknown;
  try {
    data = JSON.parse(current);
  } catch (error) {
    return {
      actions: [],
      diagnostics: [{ file: CLAUDE_SETTINGS, message: `невалидный JSON: ${errorMessage(error)}` }],
    };
  }
  if (!isRecord(data)) {
    return {
      actions: [],
      diagnostics: [{ file: CLAUDE_SETTINGS, message: 'корень должен быть объектом' }],
    };
  }
  if (data['autoMemoryEnabled'] === false) return { actions: [], diagnostics: [] };
  return { actions: [write({ ...data, autoMemoryEnabled: false })], diagnostics: [] };
}

function scanToml(text: string): Map<string, string> {
  const values = new Map<string, string>();
  let table = '';
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[([^[\]]+)\]$/.exec(line);
    if (header !== null) {
      table = (header[1] ?? '').trim();
      continue;
    }
    const pair = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (pair === null) continue;
    const key = table === '' ? (pair[1] ?? '') : `${table}.${pair[1] ?? ''}`;
    values.set(key, (pair[2] ?? '').trim());
  }
  return values;
}

export async function codexMemory(
  root: string,
): Promise<{ actions: Action[]; diagnostics: Diagnostic[] }> {
  const current = await readOrNull(path.join(root, CODEX_CONFIG));
  const expected = codexConfig();
  if (current === null || current.includes(GENERATED_MARK)) {
    if (current === expected) return { actions: [], diagnostics: [] };
    return {
      actions: [{ op: 'write', path: CODEX_CONFIG, content: Buffer.from(expected, 'utf8') }],
      diagnostics: [],
    };
  }
  const values = scanToml(current);
  const missing = CODEX_MEMORY_KEYS.filter((key) => values.get(key) !== 'false');
  if (missing.length === 0) return { actions: [], diagnostics: [] };
  return {
    actions: [],
    diagnostics: [
      {
        file: CODEX_CONFIG,
        message: `написан вручную, memory не выключена: добавь ${missing.map((k) => `${k} = false`).join(', ')}`,
      },
    ],
  };
}
