import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  AUTONOMY_PATH,
  OPS_PATH,
  artifactPath,
  artifactDirectory,
  artifactKey,
  machineArtifactPath,
  normalizedProjectPath,
  validateArtifactOutput,
} from '@shahimat/ai-core';

export const OPS_VERSION = 1;
export const PROJECT_OPS = '.oc3';
export const OPS_CONFIG = OPS_PATH;
export const AUTONOMY_FILE = AUTONOMY_PATH;
export const PROJECT_PROVIDERS = '.agents/providers';

const segments = (rel: string[]): string => {
  for (const part of rel) normalizedProjectPath(part);
  return rel.join('/');
};
export const machineDir = (home: string): string =>
  machineArtifactPath({ kind: 'machine', home }, 'ops');
export const machineFile = (home: string, ...rel: string[]): string =>
  machineArtifactPath({ kind: 'machine', home }, rel.length === 0 ? 'ops' : `ops/${segments(rel)}`);
export const machineProviders = (home: string): string =>
  machineArtifactPath({ kind: 'machine', home }, 'providers');

export function projectFile(root: string, ...rel: string[]): string {
  const file = segments(rel);
  const [area, key, ...leaf] = rel;
  if (area === 'jobs') {
    if (key === undefined) return artifactDirectory(root, 'job');
    return leaf.length === 0 ? jobDir(root, key) : jobFileAt(root, key, segments(leaf));
  }
  if (area === 'suggest')
    return artifactPath(root, {
      kind: 'run',
      key: 'watch-suggestions',
      name: segments(rel.slice(1)),
    });
  return validateArtifactOutput(root, `${PROJECT_OPS}/${file}`);
}

export const jobDir = (root: string, short: string): string =>
  artifactPath(root, { kind: 'job', key: artifactKey(short) });
export const jobFileAt = (root: string, short: string, leaf: string): string =>
  artifactPath(root, { kind: 'job', key: artifactKey(short), name: normalizedProjectPath(leaf) });
export const watchesDir = (root: string): string => artifactDirectory(root, 'watch');
export const watchFile = (root: string, id: string): string =>
  artifactPath(root, { kind: 'watch', key: `${artifactKey(id)}.yml` });

export const posixRelative = (from: string, to: string): string =>
  path.relative(from, to).split(path.sep).join('/');

export const projectKey = (root: string): string =>
  createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);

export const hashOf = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 32);
