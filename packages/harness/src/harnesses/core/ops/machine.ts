import path from 'node:path';
import { isRecord, isStringArray, UsageError } from '@shahimat/ai-core';
import { readJson, readYaml, writeJson, writeYaml } from './files.ts';
import { hashOf, machineFile, OPS_VERSION } from './paths.ts';

export const TICK_UNIT = 'dev.shahimat.ai-ops-tick';
export const TICK_SECONDS = 60;

export interface OpsRegistry {
  v: number;
  projects: string[];
  dispatcher?: string[];
}

const registryFile = (home: string): string => machineFile(home, 'projects.yml');

export async function loadRegistry(home: string): Promise<OpsRegistry> {
  const data = await readYaml(registryFile(home), 'ops/projects.yml');
  const registry: OpsRegistry = { v: OPS_VERSION, projects: [] };
  if (!isRecord(data)) return registry;
  if (isStringArray(data['projects'])) registry.projects = data['projects'];
  if (isStringArray(data['dispatcher'])) registry.dispatcher = data['dispatcher'];
  return registry;
}

export const saveRegistry = (home: string, registry: OpsRegistry): Promise<void> =>
  writeYaml(registryFile(home), registry);

export async function register(
  home: string,
  root: string,
  dispatcher: string[],
): Promise<OpsRegistry> {
  const registry = await loadRegistry(home);
  const abs = path.resolve(root);
  if (!registry.projects.includes(abs)) registry.projects.push(abs);
  registry.dispatcher ??= dispatcher;
  await saveRegistry(home, registry);
  return registry;
}

export async function unregister(home: string, root: string): Promise<OpsRegistry> {
  const registry = await loadRegistry(home);
  registry.projects = registry.projects.filter((p) => p !== path.resolve(root));
  if (registry.projects.length === 0) delete registry.dispatcher;
  await saveRegistry(home, registry);
  return registry;
}

const cacheFile = (home: string, key: string): string =>
  machineFile(home, 'cache', `${hashOf(key)}.json`);

export async function cached(
  home: string,
  key: string,
  maxAgeMs: number,
  now: Date,
  fetch: () => Promise<unknown>,
): Promise<{ value: unknown; fresh: boolean }> {
  const file = cacheFile(home, key);
  const hit = await readJson(file, 'ops/cache');
  if (isRecord(hit) && hit['key'] === key && typeof hit['at'] === 'string') {
    const age = now.getTime() - Date.parse(hit['at']);
    if (age >= 0 && age < maxAgeMs) return { value: hit['value'], fresh: false };
  }
  const value = await fetch();
  await writeJson(file, { v: OPS_VERSION, key, at: now.toISOString(), value });
  return { value, fresh: true };
}

export interface Limits {
  jobs: number;
  opus: number;
  watchers: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = { jobs: 4, opus: 2, watchers: 1 };

export async function loadLimits(home: string): Promise<Limits> {
  const data = await readYaml(machineFile(home, 'limits.yml'), 'ops/limits.yml');
  const limits: Limits = { ...DEFAULT_LIMITS };
  if (data === undefined || data === null) return limits;
  if (!isRecord(data))
    throw new UsageError('ops/limits.yml: корень — объект { jobs, opus, watchers }');
  for (const key of ['jobs', 'opus', 'watchers'] as const) {
    const v = data[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1)
      throw new UsageError(`ops/limits.yml/${key}: целое ≥ 1`);
    limits[key] = v;
  }
  return limits;
}
