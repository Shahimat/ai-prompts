import { expect, it } from 'vitest';

/** Уровень ожидания: crit и warn считаются в бюджет файла, info — никогда. */
export type Level = 'crit' | 'warn' | 'info';

export interface Budget {
  crit: number;
  warn: number;
}

/** Заголовок служебного теста с бюджетом файла; в отчёт не попадает. */
export const BUDGET_TITLE = '__budget__';

/** Доля порога, после которой формальная метрика оставляет info. */
export const NEAR_LIMIT = 0.9;

let notes: string[] = [];

type Body = () => unknown;

function levelled(level: Level, title: string, fn: Body): void {
  it(title, async (ctx) => {
    const meta = ctx.task.meta as Record<string, unknown>;
    meta['level'] = level;
    notes = [];
    try {
      await fn();
    } finally {
      meta['notes'] = notes;
      notes = [];
    }
  });
}

/** Ожидание уровня crit: формальная метрика, нарушение блокирует при бюджете 0. */
export const crit = (title: string, fn: Body): void => levelled('crit', title, fn);

/** Ожидание уровня warn: как правило — проверка судьёй. */
export const warn = (title: string, fn: Body): void => levelled('warn', title, fn);

/** Пояснение для исполнителя в отчёте (уровень info, не блокирует). */
export function note(text: string): void {
  notes.push(text);
}

/** Бюджет файла: сколько нарушений crit и warn допустимо. По умолчанию 0 / 0. */
export function budget(value: Budget): void {
  it(BUDGET_TITLE, (ctx) => {
    (ctx.task.meta as Record<string, unknown>)['budget'] = value;
  });
}

/**
 * Числовой порог: больше `limit` — нарушение; больше 90% порога —
 * info «близко к порогу».
 */
export function expectAtMost(value: number, limit: number, label: string): void {
  if (value > limit * NEAR_LIMIT && value <= limit)
    note(`${label}: ${value} из ${limit} — ${Math.round((value / limit) * 100)}% порога`);
  expect(value, label).toBeLessThanOrEqual(limit);
}
