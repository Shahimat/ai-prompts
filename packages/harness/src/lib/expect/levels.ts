import { expect, it } from 'vitest';

export const LEVELS = ['crit', 'warn', 'info'] as const;
export type Level = (typeof LEVELS)[number];

export interface Budget {
  crit: number;
  warn: number;
}

export const BUDGET_TITLE = '__budget__';

export const NEAR_LIMIT = 0.9;

declare module 'vitest' {
  interface TaskMeta {
    level?: Level;
    notes?: string[];
    budget?: Budget;
  }
}

let notes: string[] = [];

type Body = () => unknown;

function levelled(level: Level, title: string, fn: Body): void {
  it(title, async (ctx) => {
    const meta = ctx.task.meta;
    meta.level = level;
    notes = [];
    try {
      await fn();
    } finally {
      meta.notes = notes;
      notes = [];
    }
  });
}

export const crit = (title: string, fn: Body): void => levelled('crit', title, fn);

export const warn = (title: string, fn: Body): void => levelled('warn', title, fn);

export function note(text: string): void {
  notes.push(text);
}

export function budget(value: Budget): void {
  it(BUDGET_TITLE, (ctx) => {
    ctx.task.meta.budget = value;
  });
}

export function expectAtMost(value: number, limit: number, label: string): void {
  if (value > limit * NEAR_LIMIT && value <= limit)
    note(`${label}: ${value} из ${limit} — ${Math.round((value / limit) * 100)}% порога`);
  expect(value, label).toBeLessThanOrEqual(limit);
}
