import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { KNOWN_ADAPTERS, type AdapterName } from './adapters/sync.ts';
import { UsageError } from './diagnostics.ts';

export const CONFIG_PATH = 'context/harness.yml';

export interface ChangelogOptions {
  maxLine: number;
  tags: string[];
}

export const DEFAULT_CHANGELOG: ChangelogOptions = {
  maxLine: 120,
  tags: ['arch', 'stack', 'dep', 'milestone'],
};

export interface HarnessConfig {
  version?: string;
  adapters: AdapterName[];
  /** Включённые проверки; ключ отсутствует — проверка выключена. */
  checks: {
    changelog?: ChangelogOptions;
    'context-index'?: Record<string, never>;
    adapters?: Record<string, never>;
  };
}

const TOP_LEVEL_KEYS = ['version', 'adapters', 'checks', 'worktrees', 'rules'];
export const KNOWN_CHECKS = ['changelog', 'context-index', 'adapters'] as const;

function fail(message: string): never {
  throw new UsageError(`${CONFIG_PATH}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKeys(obj: Record<string, unknown>, known: readonly string[], where: string): void {
  const extra = Object.keys(obj).filter((k) => !known.includes(k));
  if (extra.length > 0) fail(`неизвестные ключи в ${where}: ${extra.join(', ')}`);
}

function stringList(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || !value.every((v): v is string => typeof v === 'string' && v !== '')) {
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
  const tags = value['tags'] === undefined ? DEFAULT_CHANGELOG.tags : stringList(value['tags'], 'checks.changelog.tags');
  if (tags.length === 0) fail('checks.changelog.tags не может быть пустым');
  return { maxLine, tags: [...tags] };
}

export function parseConfig(text: string): HarnessConfig {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    fail(`невалидный YAML: ${(error as Error).message.split('\n')[0]}`);
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
    const unknown = adapters.filter((a) => !(KNOWN_ADAPTERS as readonly string[]).includes(a));
    if (unknown.length > 0) fail(`неизвестные adapters: ${unknown.join(', ')} (есть: ${KNOWN_ADAPTERS.join(', ')})`);
    config.adapters = adapters as AdapterName[];
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
  return config;
}

/** Читает `context/harness.yml`; нет файла — `null`. */
export async function loadConfig(root: string): Promise<HarnessConfig | null> {
  let text: string;
  try {
    text = await readFile(path.join(root, CONFIG_PATH), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return parseConfig(text);
}
