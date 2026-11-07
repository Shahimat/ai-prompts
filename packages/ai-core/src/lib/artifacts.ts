import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { isRecord } from '#shared/guards';

export const ARTIFACT_ROOTS = Object.freeze({
  run: '.oc3/reports',
  research: '.oc3/research',
  verdict: '.oc3/verdicts/runs',
  'docs-proof': '.oc3/reports/docs-batches',
  'knowledge-proof': '.oc3/reports/knowledge-batches',
  proposal: '.oc3/reports/docs-proposals',
  'expect-helper': '.oc3/reports/expect',
  'expect-cache': '.oc3/verdicts/expect',
  bridge: '.oc3/sessions/plan-review',
  archive: '.oc3/reports/artifact-history',
  lock: '.oc3/locks',
  submit: '.oc3/submit',
  session: '.oc3/sessions',
  inbox: '.oc3/inbox/knowledge',
  projection: '.oc3/bundles/pending',
  job: '.oc3/jobs',
  watch: '.oc3/watches',
  baseline: '.oc3/baseline',
  operator: '.oc3/operator',
  feedback: '.oc3/feedback',
} as const);
export type ArtifactKind = keyof typeof ARTIFACT_ROOTS;
function supportedKind(value: unknown): value is ArtifactKind {
  return typeof value === 'string' && Object.hasOwn(ARTIFACT_ROOTS, value);
}
function artifactRoot(value: unknown): string {
  if (!supportedKind(value)) throw new Error('ARTIFACT_KIND_INVALID');
  return ARTIFACT_ROOTS[value];
}
export const ARTIFACT_IGNORE_LINES = [
  '.oc3/reports/',
  '.oc3/research/',
  '.oc3/verdicts/runs/',
  '.oc3/locks/',
  '.oc3/submit/',
  '.oc3/sessions/',
  '.oc3/jobs/',
  '.oc3/watches/',
  '.oc3/baseline/',
  '.oc3/operator/',
];
export function artifactRetention(relative: string): 'local' | 'versioned' | 'source' {
  const file = normalizedProjectPath(relative);
  if (
    file.startsWith('.oc3/verdicts/expect/') ||
    file.startsWith('.oc3/goals/') ||
    file.startsWith('.oc3/inbox/')
  )
    return 'versioned';
  if (Object.values(ARTIFACT_ROOTS).some((root) => file.startsWith(`${root}/`))) return 'local';
  return 'source';
}
export interface ArtifactIdentity {
  kind: ArtifactKind;
  key: string;
  name?: string;
}
export interface ArtifactScope {
  root: string;
  worktree: string;
}
export interface MachineArtifactScope {
  kind: 'machine';
  home: string;
}
export function machineArtifactPath(scope: MachineArtifactScope, relative: string): string {
  if (
    !isRecord(scope) ||
    !Object.hasOwn(scope, 'kind') ||
    scope.kind !== 'machine' ||
    !Object.hasOwn(scope, 'home') ||
    typeof scope.home !== 'string'
  )
    throw new Error('ARTIFACT_SCOPE_MISMATCH');
  return confinedProjectPath(scope.home, relative);
}
export function normalizedProjectPath(value: string): string {
  if (typeof value !== 'string') throw new Error('ARTIFACT_PATH_INVALID');
  const file = value.replaceAll('\\', '/');
  if (
    file === '' ||
    file.includes('\0') ||
    file.startsWith('/') ||
    /^[A-Za-z]:/.test(file) ||
    file.split('/').some((part) => part === '..' || part === '')
  )
    throw new Error('ARTIFACT_PATH_INVALID');
  const parts = file.split('/').filter((part) => part !== '.');
  if (parts.length === 0) throw new Error('ARTIFACT_PATH_INVALID');
  return parts.join('/');
}
export function artifactKey(value: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(value) ||
    value === '.' ||
    value === '..'
  )
    throw new Error('ARTIFACT_ID_INVALID');
  return value;
}
export const entryKey = (entry: string): string =>
  createHash('sha256').update(normalizedProjectPath(entry)).digest('hex');
export function artifactRelative(identity: ArtifactIdentity): string {
  if (
    !isRecord(identity) ||
    !Object.hasOwn(identity, 'kind') ||
    !Object.hasOwn(identity, 'key') ||
    ('name' in identity && !Object.hasOwn(identity, 'name'))
  )
    throw new Error('ARTIFACT_ID_INVALID');
  const base = `${artifactRoot(identity.kind)}/${artifactKey(identity.key)}`;
  return identity.name === undefined ? base : `${base}/${normalizedProjectPath(identity.name)}`;
}
export function confinedProjectPath(root: string, relative: string): string {
  if (typeof root !== 'string' || root.trim() === '') throw new Error('ARTIFACT_SCOPE_MISMATCH');
  const file = normalizedProjectPath(relative);
  let ancestor = path.resolve(root);
  const missing: string[] = [];
  for (;;) {
    try {
      if (lstatSync(ancestor).isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK');
      break;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
  const base = path.join(realpathSync(ancestor), ...missing);
  let current = base;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  return path.resolve(root, file);
}
export function artifactPath(
  root: string,
  identity: ArtifactIdentity,
  scope?: ArtifactScope,
): string {
  const relative = artifactRelative(identity);
  if (
    scope !== undefined &&
    (!isRecord(scope) ||
      !Object.hasOwn(scope, 'root') ||
      !Object.hasOwn(scope, 'worktree') ||
      typeof scope.root !== 'string' ||
      typeof scope.worktree !== 'string' ||
      realpathSync(scope.root) !== realpathSync(root) ||
      realpathSync(scope.worktree) !== realpathSync(root))
  )
    throw new Error('ARTIFACT_SCOPE_MISMATCH');
  return validateArtifactOutput(root, relative, identity.kind);
}
export function artifactDirectory(root: string, kind: ArtifactKind): string {
  const relative = artifactRoot(kind);
  if (!relative.startsWith('.oc3/')) throw new Error('ARTIFACT_NAMESPACE');
  return confinedProjectPath(root, relative);
}
export function validateArtifactOutput(
  root: string,
  relative: string,
  kind?: ArtifactKind,
): string {
  const roots = kind === undefined ? Object.values(ARTIFACT_ROOTS) : [artifactRoot(kind)];
  const file = normalizedProjectPath(relative);
  if (!file.startsWith('.oc3/')) throw new Error('ARTIFACT_NAMESPACE');
  if (!roots.some((dir) => file.startsWith(`${dir}/`))) throw new Error('ARTIFACT_NAMESPACE');
  return confinedProjectPath(root, file);
}
export function externalArtifactPath(relative: string): boolean {
  const file = normalizedProjectPath(relative);
  if (file.endsWith('.expect.ts') && !file.split('/').includes('baseline')) return false;
  if (file.startsWith('.ops/') || file.startsWith('.opencode/artifacts/')) return true;
  if (file.startsWith('.oc3/')) return false;
  return (
    file.split('/').some((part) => part === '.judge') ||
    /(?:^|\/)\.verdicts\.json$/.test(file) ||
    file.endsWith('.expect.json')
  );
}
export function assertArtifactNamespace(root: string, relative: string): void {
  const file = normalizedProjectPath(relative);
  if (externalArtifactPath(file)) throw new Error(`ARTIFACT_NAMESPACE: ${file}`);
  confinedProjectPath(root, file);
}
export const expectHelperDir = (entry: string): string =>
  artifactRelative({ kind: 'expect-helper', key: entryKey(entry) });
export function expectHelperPath(root: string, entry: string, relative: string): string {
  const file = normalizedProjectPath(relative);
  if (!file.startsWith(`${expectHelperDir(entry)}/`)) throw new Error('ARTIFACT_ENTRY_MISMATCH');
  return validateArtifactOutput(root, file, 'expect-helper');
}
export const expectCacheFile = (entry: string): string =>
  artifactRelative({ kind: 'expect-cache', key: entryKey(entry), name: 'verdicts.json' });
export const expectStateFile = (entry: string): string => {
  const file = normalizedProjectPath(entry);
  return file.startsWith('.oc3/goals/')
    ? file.replace(/\.expect\.ts$/, '.expect.json')
    : artifactRelative({ kind: 'expect-cache', key: entryKey(file), name: 'state.json' });
};
