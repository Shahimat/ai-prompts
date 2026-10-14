import { describe as vitestDescribe, expect, it } from 'vitest';
import {
  originNow,
  scopeOf,
  sourceNow,
  withOrigin,
  type NodeScope,
  type StepStatus,
} from './scope.ts';

export const LEVELS = ['crit', 'warn', 'info'] as const;
export type Level = (typeof LEVELS)[number];

export interface Budget {
  crit: number;
  warn: number;
}

export const BUDGET_TITLE = '__budget__';

export const NEAR_LIMIT = 0.9;

export interface StepDef {
  id: string;
  title: string;
  status: StepStatus;
  after: string[];
  why?: string;
}

export interface MachineMeta {
  name: string;
  def: unknown;
}

declare module 'vitest' {
  interface TaskMeta {
    level?: Level;
    notes?: string[];
    budget?: Budget;
    planned?: boolean;
    step?: string;
    stepStatus?: StepStatus;
    node?: NodeScope;
    stepDef?: StepDef;
    machine?: MachineMeta;
    source?: string;
    pattern?: string;
  }
}

let notes: string[] = [];

type Body = () => unknown;

function levelled(level: Level, title: string, fn: Body | undefined): void {
  const origin = originNow();
  it(title, async (ctx) => {
    const scope = scopeOf(ctx.task);
    const meta = ctx.task.meta;
    meta.level = level;
    if (origin.source !== undefined) meta.source = origin.source;
    if (origin.pattern !== undefined) meta.pattern = origin.pattern;
    if (scope.step !== undefined) {
      meta.step = scope.step.id;
      meta.stepStatus = scope.step.status;
    }
    if (scope.node !== undefined) meta.node = scope.node;
    if (fn === undefined || scope.step?.status === 'todo') {
      meta.planned = true;
      ctx.skip();
      return;
    }
    notes = [];
    try {
      await fn();
    } finally {
      meta.notes = notes;
      notes = [];
    }
  });
}

interface LevelFn {
  (title: string, fn: Body): void;
  todo: (title: string) => void;
}

const levelFn = (level: Level): LevelFn =>
  Object.assign((title: string, fn: Body) => levelled(level, title, fn), {
    todo: (title: string) => levelled(level, title, undefined),
  });

export const crit: LevelFn = levelFn('crit');

export const warn: LevelFn = levelFn('warn');

export function describe(title: string, body: () => void): void {
  const origin = originNow();
  vitestDescribe(title, () => {
    withOrigin(origin, body);
  });
}

export function pattern<P>(key: string, apply: (params: P) => void): (params: P) => void {
  return (params) => {
    withOrigin({ ...originNow(), pattern: key }, () => {
      apply(params);
    });
  };
}

export function note(text: string): void {
  notes.push(text);
}

export function budget(value: Budget): void {
  const source = sourceNow();
  it(BUDGET_TITLE, (ctx) => {
    ctx.task.meta.budget = value;
    if (source !== undefined) ctx.task.meta.source = source;
  });
}

export function expectAtMost(value: number, limit: number, label: string): void {
  if (value > limit * NEAR_LIMIT && value <= limit)
    note(`${label}: ${value} из ${limit} — ${Math.round((value / limit) * 100)}% порога`);
  expect(value, label).toBeLessThanOrEqual(limit);
}
