export const STEP_STATUSES = ['todo', 'active', 'done'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export interface StepScope {
  id: string;
  status: StepStatus;
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

export const SERVICE_PREFIX = '__';

export const isServiceTitle = (title: string): boolean => title.startsWith(SERVICE_PREFIX);
