import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { UsageError } from './diagnostics.ts';
import { errorCode, errorMessage, isOneOf, isRecord } from './guards.ts';

export const CONFIG_PATH = 'context/harness.yml';

export interface ChangelogOptions {
  maxLine: number;
  tags: string[];
}

export const DEFAULT_CHANGELOG: ChangelogOptions = {
  maxLine: 120,
  tags: ['arch', 'stack', 'dep', 'milestone'],
};

export interface SecretsAllow {
  path: string;
  line?: number;
  reason: string;
}

export interface SecretsOptions {
  allow: SecretsAllow[];
}

export const KNOWN_ADAPTERS = ['claude-code', 'codex'] as const;
export type AdapterName = (typeof KNOWN_ADAPTERS)[number];

export interface HarnessConfig {
  version?: string;
  adapters: AdapterName[];
  checks: {
    changelog?: ChangelogOptions;
    'context-index'?: Record<string, never>;
    adapters?: Record<string, never>;
    secrets?: SecretsOptions;
  };
}

const TOP_LEVEL_KEYS = ['version', 'adapters', 'checks', 'worktrees', 'rules'];
export const KNOWN_CHECKS = ['changelog', 'context-index', 'adapters', 'secrets'] as const;

function fail(message: string): never {
  throw new UsageError(`${CONFIG_PATH}: ${message}`);
}

function unknownKeys(obj: Record<string, unknown>, known: readonly string[], where: string): void {
  const extra = Object.keys(obj).filter((k) => !known.includes(k));
  if (extra.length > 0) fail(`неизвестные ключи в ${where}: ${extra.join(', ')}`);
}

function stringList(value: unknown, where: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((v): v is string => typeof v === 'string' && v !== '')
  ) {
    fail(`${where} должно быть списком непустых строк`);
  }
  return value;
}

function parseChangelog(value: unknown): ChangelogOptions {
  if (value === null || value === undefined) return { ...DEFAULT_CHANGELOG };
  if (!isRecord(value)) fail('checks.changelog должно быть объектом');
  unknownKeys(value, ['max_line', 'tags'], 'checks.changelog');
  const maxLine = value['max_line'] ?? DEFAULT_CHANGELOG.maxLine;
  if (typeof maxLine !== 'number' || !Number.isInteger(maxLine) || maxLine <= 0) {
    fail('checks.changelog.max_line должно быть целым числом > 0');
  }
  const tags =
    value['tags'] === undefined
      ? DEFAULT_CHANGELOG.tags
      : stringList(value['tags'], 'checks.changelog.tags');
  if (tags.length === 0) fail('checks.changelog.tags не может быть пустым');
  return { maxLine, tags: [...tags] };
}

function parseSecretsAllow(value: unknown, i: number): SecretsAllow {
  const where = `checks.secrets.allow[${i}]`;
  if (!isRecord(value)) fail(`${where} должно быть объектом`);
  unknownKeys(value, ['path', 'line', 'reason'], where);
  const { path: file, line, reason } = value;
  if (typeof file !== 'string' || file === '') fail(`${where}.path должно быть непустой строкой`);
  if (typeof reason !== 'string' || reason.trim() === '')
    fail(`${where}.reason обязателен: почему это не секрет`);
  if (line === undefined) return { path: file, reason };
  if (typeof line !== 'number' || !Number.isInteger(line) || line <= 0)
    fail(`${where}.line должно быть целым числом > 0`);
  return { path: file, line, reason };
}

function parseSecrets(value: unknown): SecretsOptions | null {
  if (value === false) return null;
  if (value === null || value === undefined) return { allow: [] };
  if (!isRecord(value)) fail('checks.secrets должно быть объектом или false');
  unknownKeys(value, ['allow'], 'checks.secrets');
  const allow = value['allow'] ?? [];
  if (!Array.isArray(allow)) fail('checks.secrets.allow должно быть списком');
  return { allow: allow.map(parseSecretsAllow) };
}

export function parseConfig(text: string): HarnessConfig {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    fail(`невалидный YAML: ${errorMessage(error).split('\n')[0]}`);
  }
  if (data === null || data === undefined) data = {};
  if (!isRecord(data)) fail('корень должен быть объектом');
  unknownKeys(data, TOP_LEVEL_KEYS, 'корне');

  const config: HarnessConfig = { adapters: [], checks: {} };
  const version = data['version'];
  if (version !== undefined) {
    if (typeof version !== 'string' || version === '') fail('version должно быть строкой');
    config.version = version;
  }
  if (data['adapters'] !== undefined) {
    const adapters = stringList(data['adapters'], 'adapters');
    const known = adapters.filter((a): a is AdapterName => isOneOf(KNOWN_ADAPTERS, a));
    const unknown = adapters.filter((a) => !isOneOf(KNOWN_ADAPTERS, a));
    if (unknown.length > 0)
      fail(`неизвестные adapters: ${unknown.join(', ')} (есть: ${KNOWN_ADAPTERS.join(', ')})`);
    config.adapters = known;
  }

  const checks = data['checks'] ?? {};
  if (!isRecord(checks)) fail('checks должно быть объектом');
  unknownKeys(checks, KNOWN_CHECKS, 'checks');
  if ('changelog' in checks) config.checks.changelog = parseChangelog(checks['changelog']);
  for (const name of ['context-index', 'adapters'] as const) {
    if (!(name in checks)) continue;
    const options = checks[name] ?? {};
    if (!isRecord(options)) fail(`checks.${name} должно быть объектом`);
    unknownKeys(options, [], `checks.${name}`);
    config.checks[name] = {};
  }
  const secrets = parseSecrets(checks['secrets']);
  if (secrets !== null) config.checks.secrets = secrets;
  return config;
}

export async function loadConfig(root: string): Promise<HarnessConfig | null> {
  let text: string;
  try {
    text = await readFile(path.join(root, CONFIG_PATH), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  return parseConfig(text);
}
