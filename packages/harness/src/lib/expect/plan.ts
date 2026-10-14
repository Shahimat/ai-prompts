import { it } from 'vitest';
import { describe } from './levels.ts';
import type { PlanDecl, StepDef } from './levels.ts';
import { registerScope, sourceNow, type Scope, type StepStatus } from './scope.ts';

function scopedDescribe(title: string, scope: Scope, body: () => void): void {
  registerScope(title, scope);
  describe(title, () => {
    body();
  });
}

export const STEP_TITLE = '__step__';
export const MACHINE_TITLE = '__machine__';
export const PLAN_TITLE = '__plan__';

export function plan(decl: PlanDecl): void {
  const source = sourceNow();
  it(PLAN_TITLE, (ctx) => {
    ctx.task.meta.planDecl = { name: decl.name, kind: decl.kind };
    if (source !== undefined) ctx.task.meta.source = source;
  });
}

export interface StepOptions {
  title: string;
  status: StepStatus;
  after?: readonly string[];
  why?: string;
}

export function step(id: string, options: StepOptions, body: () => void): void {
  const def: StepDef = {
    id,
    title: options.title,
    status: options.status,
    after: [...(options.after ?? [])],
  };
  if (options.why !== undefined) def.why = options.why;
  const source = sourceNow();
  scopedDescribe(`${id}. ${options.title}`, { step: { id, status: options.status } }, () => {
    it(STEP_TITLE, (ctx) => {
      ctx.task.meta.stepDef = def;
      if (source !== undefined) ctx.task.meta.source = source;
    });
    body();
  });
}

export type Actor = 'script' | 'model' | 'user';

export type TargetSpec<S extends string, L extends string> =
  | S
  | { readonly to: S; readonly count?: L; readonly reset?: readonly L[]; readonly guard?: string };

export interface ActiveStateSpec<S extends string, L extends string> {
  readonly actor: Actor;
  readonly description?: string;
  readonly on: Readonly<
    Record<string, TargetSpec<S, L> | readonly [TargetSpec<S, L>, ...TargetSpec<S, L>[]]>
  >;
}

export interface FinalStateSpec {
  readonly final: true;
  readonly description?: string;
}

export type StateSpec<S extends string, L extends string> = ActiveStateSpec<S, L> | FinalStateSpec;

export interface MachineSpec<S extends string, L extends string> {
  readonly initial: S;
  readonly limits?: Readonly<Record<L, number>>;
  readonly states: Readonly<Record<S, StateSpec<S, L>>>;
}

type StatesOf<D> = D extends { readonly states: infer R } ? keyof R & string : never;
type LimitsOf<D> = D extends { readonly limits: infer R } ? keyof R & string : never;
type EventsOf<D, K> = D extends { readonly states: infer R }
  ? K extends keyof R
    ? R[K] extends { readonly on: infer O }
      ? keyof O & string
      : never
    : never
  : never;
type ActiveOf<D> = {
  [K in StatesOf<D>]: EventsOf<D, K> extends never ? never : K;
}[StatesOf<D>];

export interface Machine<D> {
  readonly name: string;
  readonly def: D;
  state: (name: StatesOf<D>, body: () => void) => void;
  transition: <K extends ActiveOf<D>>(from: K, event: EventsOf<D, K>, body: () => void) => void;
  whole: (body: () => void) => void;
}

export function machine<const D extends MachineSpec<StatesOf<D>, LimitsOf<D>>>(
  name: string,
  def: D,
): Machine<D> {
  const source = sourceNow();
  it(`${MACHINE_TITLE}${name}`, (ctx) => {
    ctx.task.meta.machine = { name, def };
    if (source !== undefined) ctx.task.meta.source = source;
  });
  const scoped = (title: string, node: string, body: () => void) =>
    scopedDescribe(`${name} › ${title}`, { node: { machine: name, node } }, body);
  return {
    name,
    def,
    state: (s: string, body) => scoped(`состояние ${s}`, `state:${s}`, body),
    transition: (from: string, event: string, body) =>
      scoped(`переход ${from} —${event}→`, `tr:${from}:${event}`, body),
    whole: (body) => scoped('автомат', 'machine', body),
  };
}

export interface GraphTransition {
  to: string;
  count?: string;
  reset: string[];
}

export interface GraphState {
  name: string;
  actor?: Actor;
  final: boolean;
  on: Record<string, GraphTransition[]>;
}

export interface MachineGraph {
  initial: string;
  limits: Record<string, number>;
  states: GraphState[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function transitionOf(t: unknown): GraphTransition {
  if (typeof t === 'string') return { to: t, reset: [] };
  if (!isObject(t) || typeof t['to'] !== 'string') throw new Error('переход без to');
  const result: GraphTransition = { to: t['to'], reset: [] };
  if (typeof t['count'] === 'string') result.count = t['count'];
  const reset = t['reset'];
  if (Array.isArray(reset)) result.reset = reset.filter((r) => typeof r === 'string');
  return result;
}

export function graphOf(def: unknown): MachineGraph {
  if (!isObject(def) || typeof def['initial'] !== 'string' || !isObject(def['states']))
    throw new Error('machine: нет initial или states');
  const limits: Record<string, number> = {};
  const rawLimits = def['limits'];
  if (isObject(rawLimits))
    for (const [k, v] of Object.entries(rawLimits)) if (typeof v === 'number') limits[k] = v;
  const states = Object.entries(def['states']).map(([name, s]): GraphState => {
    if (!isObject(s)) throw new Error(`machine: состояние ${name} — не объект`);
    const state: GraphState = { name, final: s['final'] === true, on: {} };
    const actor = s['actor'];
    if (actor === 'script' || actor === 'model' || actor === 'user') state.actor = actor;
    const on = s['on'];
    if (isObject(on))
      for (const [event, t] of Object.entries(on))
        state.on[event] = (Array.isArray(t) ? t : [t]).map(transitionOf);
    return state;
  });
  return { initial: def['initial'], limits, states };
}

export interface YamlMachine {
  initial: string;
  limits: Record<string, number>;
  states: readonly {
    name: string;
    actor: string;
    final: boolean;
    on: Record<string, readonly { to: string; count?: string; reset: readonly string[] }[]>;
  }[];
}

const edgesOf = (s: { on: Record<string, readonly { to: string }[]> }): string[] =>
  Object.values(s.on).flatMap((list) => list.map((t) => t.to));

function reachable(g: MachineGraph, from: string, without?: string): Set<string> {
  const seen = new Set<string>();
  const queue = from === without ? [] : [from];
  while (queue.length > 0) {
    const name = queue.shift() ?? '';
    if (seen.has(name)) continue;
    seen.add(name);
    const state = g.states.find((s) => s.name === name);
    for (const next of state === undefined ? [] : edgesOf(state))
      if (next !== without && !seen.has(next)) queue.push(next);
  }
  return seen;
}

const describeTransition = (t: { to: string; count?: string; reset: readonly string[] }): string =>
  [t.to, t.count === undefined ? '' : `+${t.count}`, ...t.reset.map((r) => `${r}=0`)]
    .filter((p) => p !== '')
    .join(' ');

export interface MachineRef {
  readonly name: string;
  readonly def: unknown;
}

const sortedJson = (r: Record<string, number>): string =>
  JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))));

export const Graph = {
  sameAs(m: MachineRef, yaml: YamlMachine): void {
    const g = graphOf(m.def);
    const diffs: string[] = [];
    if (g.initial !== yaml.initial) diffs.push(`initial: ${g.initial} ≠ ${yaml.initial}`);
    if (sortedJson(g.limits) !== sortedJson(yaml.limits))
      diffs.push(`limits: ${sortedJson(g.limits)} ≠ ${sortedJson(yaml.limits)}`);
    const names = new Set([...g.states.map((s) => s.name), ...yaml.states.map((s) => s.name)]);
    for (const name of names) {
      const a = g.states.find((s) => s.name === name);
      const b = yaml.states.find((s) => s.name === name);
      if (a === undefined || b === undefined) {
        diffs.push(`${name}: есть только в ${a === undefined ? 'harness.yaml' : 'ожиданиях'}`);
        continue;
      }
      if (a.final !== b.final) diffs.push(`${name}: final ${String(a.final)} ≠ ${String(b.final)}`);
      if (!a.final && a.actor !== b.actor) diffs.push(`${name}: actor ${a.actor} ≠ ${b.actor}`);
      const events = new Set([...Object.keys(a.on), ...Object.keys(b.on)]);
      for (const event of events) {
        const left = (a.on[event] ?? []).map(describeTransition).join(' | ');
        const right = (b.on[event] ?? []).map(describeTransition).join(' | ');
        if (left !== right) diffs.push(`${name}: on.${event}: ${left || '—'} ≠ ${right || '—'}`);
      }
    }
    if (diffs.length > 0)
      throw new Error(`${m.name}: автомат расходится с harness.yaml:\n${diffs.join('\n')}`);
  },

  canReach(m: MachineRef, targets: readonly string[]): void {
    const g = graphOf(m.def);
    const stuck = g.states
      .map((s) => s.name)
      .filter((name) => ![...reachable(g, name)].some((r) => targets.includes(r)));
    if (stuck.length > 0)
      throw new Error(`${m.name}: из ${stuck.join(', ')} не достижимо ${targets.join(' | ')}`);
  },

  onlyVia(m: MachineRef, target: string, via: string): void {
    const g = graphOf(m.def);
    if (target === via) return;
    if (reachable(g, g.initial, via).has(target))
      throw new Error(`${m.name}: в ${target} есть путь из ${g.initial} в обход ${via}`);
  },
};
