// Критерии ревью плана (criteria.yaml), замечания и вердикт. Уровень
// замечания задаёт критерий, а не модель; вердикт считает скрипт.

import { parse } from 'yaml';
import { UsageError } from '../../../shared/diagnostics.ts';
import { errorMessage, isOneOf, isRecord } from '../../../shared/guards.ts';
import { schemaErrors } from '../../../shared/schema.ts';

export const LEVELS = ['crit', 'warn', 'info'] as const;
export type Level = (typeof LEVELS)[number];
export const STAGES = ['1a', '1b', '2'] as const;
export type Stage = (typeof STAGES)[number];
/** Стадии, которые ведут модели. */
export const MODEL_STAGES = ['1b', '2'] as const;
export type ModelStage = (typeof MODEL_STAGES)[number];

export interface Criterion {
  id: string;
  stage: Stage;
  level: Level;
  text: string;
}

export interface Finding {
  criterion: string;
  level: Level;
  stage: Stage;
  /** ID пункта (`T1`) или `plan` — замечание ко всему плану. */
  item: string;
  text: string;
}

export interface Budget {
  crit: number;
  warn: number;
}

/** Копия expectations/schemas/plan-criteria.schema.json; совпадение проверяют ожидания. */
export const CRITERIA_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'criteria.yaml процесса plan-review',
  type: 'object',
  additionalProperties: false,
  required: ['criteria'],
  properties: {
    criteria: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'stage', 'level', 'text'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9-]+$' },
          stage: { enum: ['1a', '1b', '2'] },
          level: { enum: ['crit', 'warn', 'info'] },
          text: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
  },
} as const;

export function parseCriteria(text: string, where: string): Criterion[] {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new UsageError(`${where}: невалидный YAML: ${errorMessage(error).split('\n')[0]}`);
  }
  const errors = schemaErrors(CRITERIA_SCHEMA, data, where);
  if (errors.length > 0) throw new UsageError(errors.join('\n'));
  if (!isRecord(data) || !Array.isArray(data['criteria']))
    throw new UsageError(`${where}: нет criteria`);
  const criteria: Criterion[] = [];
  for (const c of data['criteria']) {
    if (!isRecord(c)) continue;
    const { id, stage, level, text: body } = c;
    if (
      typeof id === 'string' &&
      typeof body === 'string' &&
      isOneOf(STAGES, stage) &&
      isOneOf(LEVELS, level)
    )
      criteria.push({ id, stage, level, text: body });
  }
  const seen = new Set<string>();
  const dup = criteria.find((c) => seen.size === seen.add(c.id).size);
  if (dup !== undefined) throw new UsageError(`${where}: повтор id критерия ${dup.id}`);
  return criteria;
}

/** JSON Schema ответа ревьюера стадии: критерий — только из этой стадии. */
export function findingsSchema(criteria: Criterion[], stage: ModelStage): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterion', 'item', 'text'],
          properties: {
            criterion: { enum: criteria.filter((c) => c.stage === stage).map((c) => c.id) },
            item: { type: 'string', pattern: '^([TS][0-9]+|plan)$' },
            text: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  };
}

/**
 * Ответ модели → замечания с уровнем из критерия. Ответ вне схемы
 * отклоняется ошибкой: модель не может ни понизить уровень, ни
 * сослаться на чужой критерий.
 */
export function acceptFindings(
  answer: unknown,
  criteria: Criterion[],
  stage: ModelStage,
): Finding[] {
  const errors = schemaErrors(findingsSchema(criteria, stage), answer, `ответ стадии ${stage}`);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  if (!isRecord(answer) || !Array.isArray(answer['findings'])) return [];
  const result: Finding[] = [];
  for (const f of answer['findings']) {
    if (!isRecord(f)) continue;
    const { criterion, item, text } = f;
    const c = criteria.find((x) => x.id === criterion && x.stage === stage);
    if (c === undefined || typeof item !== 'string' || typeof text !== 'string') continue;
    result.push({ criterion: c.id, level: c.level, stage, item, text });
  }
  return result;
}

export interface StageVerdict {
  stage: Stage;
  crit: number;
  warn: number;
  info: number;
  pass: boolean;
}

/**
 * Вердикт по стадиям: любой crit останавливает; warn — когда в одной
 * стадии их больше бюджета; info не останавливает никогда. Бюджеты
 * стадий не суммируются. `ran` — стадии, которые прогонялись: стадия
 * без замечаний тоже попадает в вердикт.
 */
export function verdict(
  findings: Finding[],
  budget: Budget,
  ran: readonly Stage[] = [],
): StageVerdict[] {
  const stages = new Set<Stage>([...ran, ...findings.map((f) => f.stage)]);
  return STAGES.filter((s) => stages.has(s)).map((stage) => {
    const own = findings.filter((f) => f.stage === stage);
    const count = (level: Level) => own.filter((f) => f.level === level).length;
    const crit = count('crit');
    const warn = count('warn');
    return {
      stage,
      crit,
      warn,
      info: count('info'),
      pass: crit <= budget.crit && warn <= budget.warn,
    };
  });
}

export const passes = (verdicts: StageVerdict[]): boolean => verdicts.every((v) => v.pass);
