// expect:fsm-drive
// Автомат процесса: топология и параметры — в harness.yaml, действия и
// guards — имена из реестра. YAML не содержит выражений: переход
// выбирается по событию действия, затем по guard и лимиту счётчика.

import { parse } from 'yaml';
import { errorMessage, isOneOf, isRecord } from '../../../shared/guards.ts';
import { schemaErrors } from '../../../shared/schema.ts';
import { FSM_SCHEMA } from './schema.ts';

export const ACTORS = ['script', 'model', 'user'] as const;
export type Actor = (typeof ACTORS)[number];

export interface Transition {
  to: string;
  /** Счётчик из `limits`: переход берётся, пока счётчик меньше лимита, и увеличивает его. */
  count?: string;
  /** Счётчики, которые обнуляет переход. */
  reset: string[];
  guard?: string;
}

export interface StateDef {
  name: string;
  actor: Actor;
  action?: string;
  final: boolean;
  /** Событие действия → варианты перехода по порядку. */
  on: Record<string, Transition[]>;
}

export interface MachineDef {
  harness: string;
  initial: string;
  limits: Record<string, number>;
  review: { mode: 'collect' | 'sequential'; budget: { crit: number; warn: number } };
  models: { planner: string; '1b': string; '2': string };
  states: StateDef[];
}

export const DEFAULT_REVIEW: MachineDef['review'] = {
  mode: 'collect',
  budget: { crit: 0, warn: 3 },
};
export const DEFAULT_MODELS: MachineDef['models'] = { planner: 'opus', '1b': 'haiku', '2': 'opus' };

export type ActionResult = { event: string } | { pause: string };

export interface ActionDef<C> {
  /** События, которые действие может вернуть: по ним проверяется полнота `on`. */
  events: readonly string[];
  run: (ctx: C) => Promise<ActionResult>;
}

export type Guard<C> = (ctx: C) => boolean | Promise<boolean>;

export interface Registry<C> {
  actions: Map<string, ActionDef<C>>;
  guards: Map<string, Guard<C>>;
}

function transitionsOf(value: unknown): Transition[] {
  const list: unknown[] = Array.isArray(value) ? value : [value];
  return list.flatMap((t): Transition[] => {
    if (typeof t === 'string') return [{ to: t, reset: [] }];
    if (!isRecord(t) || typeof t['to'] !== 'string') return [];
    const result: Transition = { to: t['to'], reset: [] };
    if (typeof t['count'] === 'string') result.count = t['count'];
    if (typeof t['guard'] === 'string') result.guard = t['guard'];
    const reset = t['reset'];
    if (Array.isArray(reset)) result.reset = reset.filter((r) => typeof r === 'string');
    return [result];
  });
}

export interface ParseResult {
  def?: MachineDef;
  /** Ошибки формы с путём до поля. */
  errors: string[];
}

export function parseMachine(text: string, where: string): ParseResult {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    return { errors: [`${where}: невалидный YAML: ${errorMessage(error).split('\n')[0]}`] };
  }
  const errors = schemaErrors(FSM_SCHEMA, data, where);
  if (errors.length > 0 || !isRecord(data)) return { errors };
  const { harness, initial, limits, review, models, states } = data;
  if (typeof harness !== 'string' || typeof initial !== 'string' || !isRecord(states))
    return { errors: [`${where}: нет harness, initial или states`] };
  const def: MachineDef = {
    harness,
    initial,
    limits: {},
    review: { mode: DEFAULT_REVIEW.mode, budget: { ...DEFAULT_REVIEW.budget } },
    models: { ...DEFAULT_MODELS },
    states: [],
  };
  if (isRecord(limits))
    for (const [k, v] of Object.entries(limits)) if (typeof v === 'number') def.limits[k] = v;
  if (isRecord(review)) {
    if (isOneOf(['collect', 'sequential'], review['mode'])) def.review.mode = review['mode'];
    const budget = review['budget'];
    if (
      isRecord(budget) &&
      typeof budget['crit'] === 'number' &&
      typeof budget['warn'] === 'number'
    )
      def.review.budget = { crit: budget['crit'], warn: budget['warn'] };
  }
  if (isRecord(models)) {
    for (const key of ['planner', '1b', '2'] as const) {
      const m = models[key];
      if (typeof m === 'string') def.models[key] = m;
    }
  }
  for (const [name, s] of Object.entries(states)) {
    if (!isRecord(s)) continue;
    const state: StateDef = {
      name,
      actor: isOneOf(ACTORS, s['actor']) ? s['actor'] : 'script',
      final: s['final'] === true,
      on: {},
    };
    if (typeof s['action'] === 'string') state.action = s['action'];
    const on = s['on'];
    if (isRecord(on))
      for (const [event, t] of Object.entries(on)) state.on[event] = transitionsOf(t);
    def.states.push(state);
  }
  return { def, errors: [] };
}

export const stateOf = (def: MachineDef, name: string): StateDef | undefined =>
  def.states.find((s) => s.name === name);

/**
 * Статическая проверка графа: цели и имена существуют, все состояния
 * достижимы, тупиков нет, события действий обработаны полностью, а
 * у каждого цикла есть лимит — счётчик или решение человека.
 */
export function staticErrors<C>(def: MachineDef, registry: Registry<C>, where: string): string[] {
  const errors: string[] = [];
  const names = new Set(def.states.map((s) => s.name));
  const at = (state: string, rest = '') => `${where}/states/${state}${rest}`;
  if (!names.has(def.initial)) errors.push(`${where}/initial: нет состояния ${def.initial}`);
  for (const s of def.states) {
    if (s.action !== undefined) {
      const action = registry.actions.get(s.action);
      if (action === undefined)
        errors.push(`${at(s.name, '/action')}: нет действия ${s.action} в реестре`);
      else if (!s.final) {
        for (const e of action.events)
          if (s.on[e] === undefined)
            errors.push(`${at(s.name, '/on')}: не обработано событие ${e}`);
        for (const e of Object.keys(s.on))
          if (!action.events.includes(e))
            errors.push(
              `${at(s.name, `/on/${e}`)}: действие ${s.action} не порождает событие ${e}`,
            );
      }
    }
    if (s.final && Object.keys(s.on).length > 0)
      errors.push(`${at(s.name, '/on')}: у конечного состояния нет переходов`);
    if (!s.final && Object.keys(s.on).length === 0)
      errors.push(`${at(s.name)}: тупик — нет переходов и состояние не конечное`);
    if (!s.final && s.action === undefined) errors.push(`${at(s.name, '/action')}: нет действия`);
    for (const [event, list] of Object.entries(s.on)) {
      list.forEach((t, i) => {
        const p = at(s.name, `/on/${event}${list.length > 1 ? `/${i}` : ''}`);
        if (!names.has(t.to)) errors.push(`${p}/to: нет состояния ${t.to}`);
        if (t.count !== undefined && def.limits[t.count] === undefined)
          errors.push(`${p}/count: нет лимита ${t.count} в limits`);
        for (const r of t.reset)
          if (def.limits[r] === undefined) errors.push(`${p}/reset: нет лимита ${r} в limits`);
        if (t.guard !== undefined && !registry.guards.has(t.guard))
          errors.push(`${p}/guard: нет guard ${t.guard} в реестре`);
      });
      const last = list.at(-1);
      if (
        last !== undefined &&
        list.length > 1 &&
        (last.count !== undefined || last.guard !== undefined)
      )
        errors.push(`${at(s.name, `/on/${event}`)}: последний вариант должен быть безусловным`);
      if (list.length === 1 && list[0]?.count !== undefined)
        errors.push(
          `${at(s.name, `/on/${event}`)}: после исчерпания ${list[0].count} нужен запасной вариант`,
        );
    }
  }
  if (errors.length > 0) return errors;

  // Достижимость.
  const reached = new Set([def.initial]);
  const queue = [def.initial];
  while (queue.length > 0) {
    const name = queue.shift() ?? '';
    for (const list of Object.values(stateOf(def, name)?.on ?? {}))
      for (const t of list)
        if (!reached.has(t.to)) {
          reached.add(t.to);
          queue.push(t.to);
        }
  }
  for (const s of def.states)
    if (!reached.has(s.name)) errors.push(`${at(s.name)}: недостижимо из ${def.initial}`);
  if (!def.states.some((s) => s.final)) errors.push(`${where}/states: нет конечного состояния`);

  // Циклы без лимита: без переходов со счётчиком и выходов из состояний
  // человека граф обязан быть ацикличным.
  const edges = new Map<string, string[]>();
  for (const s of def.states) {
    if (s.actor === 'user') continue;
    edges.set(
      s.name,
      Object.values(s.on).flatMap((list) =>
        list.filter((t) => t.count === undefined).map((t) => t.to),
      ),
    );
  }
  const color = new Map<string, number>();
  const cycles: string[] = [];
  const visit = (name: string, stack: string[]): void => {
    if (color.get(name) === 2) return;
    if (color.get(name) === 1) {
      cycles.push([...stack.slice(stack.indexOf(name)), name].join(' → '));
      return;
    }
    color.set(name, 1);
    for (const next of edges.get(name) ?? []) visit(next, [...stack, name]);
    color.set(name, 2);
  };
  for (const s of def.states) visit(s.name, []);
  for (const c of cycles) errors.push(`${where}/states: цикл без лимита: ${c}`);
  return errors;
}

/** Mermaid-диаграмма автомата. */
export function machineMermaid(def: MachineDef): string {
  const lines = ['stateDiagram-v2', `    [*] --> ${def.initial}`];
  for (const s of def.states) {
    for (const [event, list] of Object.entries(s.on)) {
      for (const t of list) {
        const notes = [
          event,
          t.guard === undefined ? '' : `[${t.guard}]`,
          t.count === undefined ? '' : `${t.count}++`,
          t.reset.length === 0 ? '' : `${t.reset.join(',')}=0`,
        ].filter((n) => n !== '');
        lines.push(`    ${s.name} --> ${t.to}: ${notes.join(' ')}`);
      }
    }
    if (s.final) lines.push(`    ${s.name} --> [*]`);
  }
  return lines.join('\n');
}

export interface MachineState {
  state: string;
  counters: Record<string, number>;
}

/** Переход по событию: первый вариант, у которого guard и лимит пропускают. */
export async function resolve<C>(
  def: MachineDef,
  registry: Registry<C>,
  current: MachineState,
  event: string,
  ctx: C,
): Promise<MachineState> {
  const state = stateOf(def, current.state);
  const list = state?.on[event];
  if (state === undefined || list === undefined)
    throw new Error(`нет перехода из ${current.state} по событию ${event}`);
  for (const t of list) {
    const used = t.count === undefined ? 0 : (current.counters[t.count] ?? 0);
    if (t.count !== undefined && used >= (def.limits[t.count] ?? 0)) continue;
    if (t.guard !== undefined) {
      const guard = registry.guards.get(t.guard);
      if (guard === undefined || !(await guard(ctx))) continue;
    }
    const counters = { ...current.counters };
    for (const r of t.reset) counters[r] = 0;
    if (t.count !== undefined) counters[t.count] = used + 1;
    return { state: t.to, counters };
  }
  throw new Error(`из ${current.state} по событию ${event} не прошёл ни один вариант`);
}

export interface Journal {
  load: () => Promise<MachineState>;
  save: (next: MachineState, from: string, event: string) => Promise<void>;
}

export type DriveResult = { final: string } | { paused: string; message: string };

/**
 * Исполнение: действие текущего состояния → событие → переход →
 * сохранение. Прерванный прогон продолжается с сохранённого состояния:
 * действие текущего состояния выполняется заново. `event` — внешнее
 * событие (например, `retry`) перед первым шагом.
 */
export async function drive<C>(
  def: MachineDef,
  registry: Registry<C>,
  journal: Journal,
  ctx: C,
  event?: string,
): Promise<DriveResult> {
  let current = await journal.load();
  if (event !== undefined) {
    const next = await resolve(def, registry, current, event, ctx);
    await journal.save(next, current.state, event);
    current = next;
  }
  for (;;) {
    const state = stateOf(def, current.state);
    if (state === undefined) throw new Error(`нет состояния ${current.state}`);
    const action = state.action === undefined ? undefined : registry.actions.get(state.action);
    if (state.final) {
      if (action !== undefined) await action.run(ctx);
      return { final: state.name };
    }
    if (action === undefined) throw new Error(`нет действия у состояния ${state.name}`);
    const result = await action.run(ctx);
    if ('pause' in result) return { paused: state.name, message: result.pause };
    const next = await resolve(def, registry, current, result.event, ctx);
    await journal.save(next, current.state, result.event);
    current = next;
  }
}
