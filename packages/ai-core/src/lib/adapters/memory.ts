// expect:memory-off
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { Diagnostic } from '#shared/diagnostics';
import { errorCode, isRecord } from '#shared/guards';
import { loadModelManifest, modelRoleIds, resolveManifestModel } from '#lib/project-models';
import { GENERATED_MARK } from './render.ts';
import type { Action } from './sync.ts';

export const CODEX_CONFIG = '.codex/config.toml';
export const OPENCODE_CONFIG = '.opencode/opencode.jsonc';

const OPENCODE_CONFIGS = [
  'opencode.json',
  'opencode.jsonc',
  '.opencode/opencode.json',
  '.opencode/opencode.jsonc',
] as const;

const MEMORY_KEY = /"([^"]*memory[^"]*)"\s*:/i;

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

export function opencodeConfig(): string {
  return [
    `// ${GENERATED_MARK} — do not edit; memory агента запрещена контрактом`,
    '{',
    '  "$schema": "https://opencode.ai/config.json",',
    '  "permissions": [',
    '    { "action": "*memory*", "resource": "*", "effect": "deny" },',
    '    { "action": "edit", "resource": "~/.codex/**/memory/**", "effect": "deny" },',
    '    { "action": "edit", "resource": "~/.config/opencode/**/memory/**", "effect": "deny" }',
    '  ]',
    '}',
    '',
  ].join('\n');
}

async function opencodeConfigs(root: string): Promise<{ rel: string; text: string }[]> {
  const found: { rel: string; text: string }[] = [];
  for (const rel of OPENCODE_CONFIGS) {
    const text = await readOrNull(path.join(root, rel));
    if (text !== null) found.push({ rel, text });
  }
  return found;
}

export async function opencodeMemory(
  root: string,
): Promise<{ actions: Action[]; diagnostics: Diagnostic[] }> {
  const manifest = await loadModelManifest(root);
  const exists = await opencodeConfigs(root);
  if (exists.length === 0 && manifest === null) return { actions: [], diagnostics: [] };

  const diagnostics: Diagnostic[] = [];
  for (const { rel, text } of exists) {
    if (rel === OPENCODE_CONFIG && text.includes(GENERATED_MARK)) continue;
    const match = MEMORY_KEY.exec(text);
    if (match !== null) {
      diagnostics.push({
        file: rel,
        message: `memory-MCP/инструмент запрещён контрактом: ${match[1] ?? 'memory'}`,
      });
    }
  }

  const current = await readOrNull(path.join(root, OPENCODE_CONFIG));
  if (manifest !== null) {
    const decoded =
      current === null ? undefined : ts.parseConfigFileTextToJson(OPENCODE_CONFIG, current);
    const parsed: unknown = decoded === undefined ? {} : decoded.config;
    if (decoded?.error !== undefined)
      return {
        actions: [],
        diagnostics: [
          ...diagnostics,
          { file: OPENCODE_CONFIG, message: 'невалидный config JSONC' },
        ],
      };
    if (!isRecord(parsed))
      return {
        actions: [],
        diagnostics: [...diagnostics, { file: OPENCODE_CONFIG, message: 'невалидный config' }],
      };
    const config = { ...parsed };
    config['$schema'] ??= 'https://opencode.ai/config.json';
    config['model'] = manifest.default;
    const agents = isRecord(config['agents']) ? { ...config['agents'] } : {};
    for (const id of [
      ...new Set([...(await modelRoleIds(root, manifest)), ...Object.keys(agents)]),
    ].sort()) {
      const agent = agents[id];
      agents[id] = {
        ...(isRecord(agent) ? agent : {}),
        model: resolveManifestModel(manifest, id).model,
      };
    }
    config['agents'] = agents;
    const memory: unknown = ts.parseConfigFileTextToJson(OPENCODE_CONFIG, opencodeConfig()).config;
    const guards: unknown[] =
      isRecord(memory) && Array.isArray(memory['permissions']) ? memory['permissions'] : [];
    const permissions: unknown[] = Array.isArray(config['permissions'])
      ? config['permissions']
      : [];
    config['permissions'] = [
      ...permissions.filter(
        (p: unknown) => !guards.some((g: unknown) => JSON.stringify(g) === JSON.stringify(p)),
      ),
      ...guards,
    ];
    const expected = `// ${GENERATED_MARK} — do not edit\n${JSON.stringify(config, null, 2)}\n`;
    return {
      actions:
        current === expected
          ? []
          : [{ op: 'write', path: OPENCODE_CONFIG, content: Buffer.from(expected, 'utf8') }],
      diagnostics,
    };
  }
  const expected = opencodeConfig();
  if (current === null || current.includes(GENERATED_MARK)) {
    if (current === expected) return { actions: [], diagnostics };
    return {
      actions: [{ op: 'write', path: OPENCODE_CONFIG, content: Buffer.from(expected, 'utf8') }],
      diagnostics,
    };
  }
  if (current.includes('"*memory*"')) return { actions: [], diagnostics };
  return {
    actions: [],
    diagnostics: [
      ...diagnostics,
      {
        file: OPENCODE_CONFIG,
        message: `написан вручную, memory guard не стоит: добавь permissions с "*memory*" deny`,
      },
    ],
  };
}
