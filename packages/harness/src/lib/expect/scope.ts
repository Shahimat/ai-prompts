export const STEP_STATUSES = ['todo', 'active', 'done'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export interface StepScope {
  id: string;
}

export interface NodeScope {
  machine: string;
  node: string;
}

export interface Scope {
  step?: StepScope;
  node?: NodeScope;
}

const registry = new Map<string, Scope>();

export function registerScope(suite: string, scope: Scope): void {
  registry.set(suite, { ...registry.get(suite), ...scope });
}

interface SuiteLike {
  name: string;
  suite?: SuiteLike | undefined;
}

export function scopeOf(task: { suite?: SuiteLike | undefined }): Scope {
  const chain: string[] = [];
  for (let s = task.suite; s !== undefined; s = s.suite) chain.unshift(s.name);
  let scope: Scope = {};
  for (const name of chain) scope = { ...scope, ...registry.get(name) };
  return scope;
}

const EXPECT_FRAME = /(?:file:\/\/)?((?:[A-Za-z]:)?[^\s()]*?\.expect\.ts)(?::\d+)*/;

export function callerModule(): string | undefined {
  for (const line of (new Error().stack ?? '').split('\n').slice(1)) {
    const found = EXPECT_FRAME.exec(line)?.[1];
    if (found !== undefined) return decodeURIComponent(found.replace(/^\/([A-Za-z]:)/, '$1'));
  }
  return undefined;
}

export interface Origin {
  source?: string;
  pattern?: string;
}

let current: Origin = {};

export function originNow(): Origin {
  const origin: Origin = { ...current };
  const source = current.source ?? callerModule();
  if (source !== undefined) origin.source = source;
  return origin;
}

export const sourceNow = (): string | undefined => originNow().source;

const slashes = (p: string): string => p.replace(/\\/g, '/');
const LIB_DIR = slashes(import.meta.dirname);
const FRAME_FILE = /((?:file:\/\/)?(?:\/?[A-Za-z]:)?[\\/][^\s():]+\.[cm]?[jt]s)(?::\d+)+/;

export function definingModule(): string | undefined {
  for (const line of (new Error().stack ?? '').split('\n').slice(1)) {
    const raw = FRAME_FILE.exec(line)?.[1];
    if (raw === undefined) continue;
    const file = decodeURIComponent(raw.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'));
    if (slashes(file).startsWith(LIB_DIR) || file.includes('node_modules')) continue;
    return file;
  }
  return undefined;
}

export function withOrigin(origin: Origin, body: () => void): void {
  const saved = current;
  current = origin;
  try {
    body();
  } finally {
    current = saved;
  }
}

export const SERVICE_PREFIX = '__';

export const isServiceTitle = (title: string): boolean => title.startsWith(SERVICE_PREFIX);
