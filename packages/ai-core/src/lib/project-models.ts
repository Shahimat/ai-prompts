import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROLE_MODEL_PATTERN } from '#lib/agent';
import { UsageError } from '#shared/diagnostics';
import { errorCode, isRecord } from '#shared/guards';

export const MODEL_MANIFEST = 'manifest.json';
export const MODEL_HELPERS: Readonly<Record<string, string>> = {
  'expect.judge': 'judge',
  'plan-review.planner': 'planner',
  'plan-review.judge': 'judge',
};
export const MODEL_ROLES = [
  'operator',
  'executor',
  'external-executor',
  'judge',
  'librarian',
  'researcher',
  'watch-request',
  'watch-triage',
  'build',
  'plan',
  'general',
  'explore',
  'compaction',
  'title',
  'summary',
  'planner',
];

export interface ModelManifest {
  version: 1;
  default: string;
  roles: Record<string, string>;
}

export interface ResolvedModel {
  model: string;
  origin: string;
}

export function validateModelManifest(value: unknown): ModelManifest {
  if (
    !isRecord(value) ||
    value['version'] !== 1 ||
    typeof value['default'] !== 'string' ||
    !ROLE_MODEL_PATTERN.test(value['default']) ||
    !isRecord(value['roles']) ||
    Object.keys(value).some((k) => !['version', 'default', 'roles'].includes(k))
  )
    throw new UsageError(
      `${MODEL_MANIFEST}: ожидается {version:1, default:provider/model[#variant], roles:{}}`,
    );
  const roles: Record<string, string> = {};
  for (const [id, model] of Object.entries(value['roles'])) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ||
      typeof model !== 'string' ||
      !ROLE_MODEL_PATTERN.test(model)
    )
      throw new UsageError(`${MODEL_MANIFEST}: невалидная модель роли ${id}`);
    roles[id] = model;
  }
  return { version: 1, default: value['default'], roles };
}

export async function loadModelManifest(root: string): Promise<ModelManifest | null> {
  let text: string;
  try {
    text = await readFile(path.join(root, MODEL_MANIFEST), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UsageError(`${MODEL_MANIFEST}: невалидный JSON`);
  }
  return validateModelManifest(value);
}

export function resolveManifestModel(
  manifest: ModelManifest,
  role: string,
  context = role,
): ResolvedModel {
  const exact = Object.hasOwn(manifest.roles, context) ? manifest.roles[context] : undefined;
  if (exact !== undefined) return { model: exact, origin: `${MODEL_MANIFEST}:roles.${context}` };
  const baseRole =
    (Object.hasOwn(MODEL_HELPERS, context) ? MODEL_HELPERS[context] : undefined) ??
    (Object.hasOwn(MODEL_HELPERS, role) ? MODEL_HELPERS[role] : undefined) ??
    role;
  const base = Object.hasOwn(manifest.roles, baseRole) ? manifest.roles[baseRole] : undefined;
  if (base !== undefined) return { model: base, origin: `${MODEL_MANIFEST}:roles.${baseRole}` };
  return { model: manifest.default, origin: `${MODEL_MANIFEST}:default` };
}

export async function resolveProjectModel(
  root: string,
  role: string,
  legacy: string,
  context = role,
): Promise<ResolvedModel> {
  const manifest = await loadModelManifest(root);
  return manifest === null
    ? { model: legacy, origin: 'legacy' }
    : resolveManifestModel(manifest, role, context);
}

export async function modelRoleIds(root: string, manifest: ModelManifest): Promise<string[]> {
  const ids = new Set([
    ...MODEL_ROLES,
    ...Object.keys(manifest.roles).filter((id) => !Object.hasOwn(MODEL_HELPERS, id)),
  ]);
  for (const dir of ['.agents/agents', 'agents', '.opencode/agents']) {
    let names: string[];
    try {
      names = await readdir(path.join(root, dir));
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      names = [];
    }
    for (const name of names) if (name.endsWith('.md')) ids.add(name.slice(0, -3));
  }
  return [...ids].sort();
}
