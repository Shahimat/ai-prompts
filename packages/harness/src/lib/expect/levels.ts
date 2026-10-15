import { describe as vitestDescribe, expect, it } from 'vitest';
import {
  definingModule,
  originNow,
  scopeOf,
  sourceNow,
  withOrigin,
  type NodeScope,
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
  after: string[];
  why?: string;
}

export interface PlanDecl {
  name: string;
}

export const DOC_KINDS = ['title', 'subtitle', 'text', 'stats', 'questions', 'remarks'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export interface Answer {
  text: string;
  recommended?: boolean;
  comment?: string;
}

export interface Question {
  text: string;
  answers: readonly Answer[];
}

export interface DocBlock {
  kind: DocKind;
  text: string;
  questions?: Question[];
}

export const DOC_TITLE = '__doc__';

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
    wip?: boolean;
    defined?: string;
    node?: NodeScope;
    stepDef?: StepDef;
    machine?: MachineMeta;
    source?: string;
    pattern?: string;
    planDecl?: PlanDecl;
    doc?: DocBlock;
  }
}

let notes: string[] = [];

type Body = () => unknown;

type Stub = 'todo' | 'wip' | undefined;

function levelled(level: Level, title: string, fn: Body | undefined, stub: Stub): void {
  const origin = originNow();
  const defined = definingModule();
  it(title, async (ctx) => {
    const scope = scopeOf(ctx.task);
    const meta = ctx.task.meta;
    meta.level = level;
    if (origin.source !== undefined) meta.source = origin.source;
    if (origin.pattern !== undefined) meta.pattern = origin.pattern;
    if (defined !== undefined) meta.defined = defined;
    if (stub === 'wip') meta.wip = true;
    if (scope.step !== undefined) meta.step = scope.step.id;
    if (scope.node !== undefined) meta.node = scope.node;
    if (fn === undefined) {
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
  wip: (title: string, fn?: Body) => void;
}

const levelFn = (level: Level): LevelFn =>
  Object.assign((title: string, fn: Body) => levelled(level, title, fn, undefined), {
    todo: (title: string) => levelled(level, title, undefined, 'todo'),
    wip: (title: string, fn?: Body) => levelled(level, title, fn, 'wip'),
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

function docBlock(kind: DocKind, text: string, questions?: readonly Question[]): void {
  const source = sourceNow();
  it(DOC_TITLE, (ctx) => {
    ctx.task.meta.level = 'info';
    ctx.task.meta.doc =
      questions === undefined
        ? { kind, text }
        : {
            kind,
            text,
            questions: questions.map((q) => ({
              text: q.text,
              answers: q.answers.map((a) => ({ ...a })),
            })),
          };
    if (source !== undefined) ctx.task.meta.source = source;
  });
}

export const info = {
  title: (text: string): void => docBlock('title', text),
  subtitle: (text: string): void => docBlock('subtitle', text),
  text: (text: string): void => docBlock('text', text),
  stats: (level: 'crit' | 'warn'): void => docBlock('stats', level),
  questions: (list: readonly Question[]): void => docBlock('questions', '', list),
  remarks: (): void => docBlock('remarks', ''),
};

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
