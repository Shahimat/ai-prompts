import { it } from 'vitest';
import { describe } from './levels.ts';
import type { PlanDecl, StepDef } from './levels.ts';
import { registerScope, sourceNow, type Scope } from './scope.ts';

function scopedDescribe(title: string, scope: Scope, body: () => void): void {
  registerScope(title, scope);
  describe(title, () => {
    body();
  });
}

export { MACHINE_TITLE, PLAN_TITLE, STEP_TITLE } from './model.ts';
import { MACHINE_TITLE, PLAN_TITLE, STEP_TITLE } from './model.ts';
export const STEPS_TITLE = 'шаги плана';

export function plan(decl: PlanDecl): void {
  const source = sourceNow();
  it(PLAN_TITLE, (ctx) => {
    ctx.task.meta.planDecl = { name: decl.name };
    if (source !== undefined) ctx.task.meta.source = source;
  });
}

let stepsDepth = 0;

export function steps(body: () => void): void {
  describe(STEPS_TITLE, () => {
    stepsDepth++;
    try {
      body();
    } finally {
      stepsDepth--;
    }
  });
}

export interface StepOptions {
  title: string;
  after?: readonly string[];
  why?: string;
}

export function step(id: string, options: StepOptions, body: () => void): void {
  if (stepsDepth === 0) throw new Error(`step ${id}: шаг объявляется внутри steps(...)`);
  const def: StepDef = {
    id,
    title: options.title,
    after: [...(options.after ?? [])],
  };
  if (options.why !== undefined) def.why = options.why;
  const source = sourceNow();
  scopedDescribe(`${id}. ${options.title}`, { step: { id } }, () => {
    it(STEP_TITLE, (ctx) => {
      ctx.task.meta.stepDef = def;
      if (source !== undefined) ctx.task.meta.source = source;
    });
    body();
  });
}

export type { Actor } from './model.ts';
import type { Actor } from './model.ts';

export type TargetSpec<S extends string, L extends string> =
  | S
  | {
      readonly to: S;
      readonly count?: L;
      readonly reset?: readonly L[];
      readonly guard?: string;
      readonly label?: string;
    };

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
  readonly start?: string;
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
  transition: <K extends ActiveOf<D>>(
    from: K,
    event: EventsOf<D, K>,
    body: () => void,
    to?: StatesOf<D>,
  ) => void;
  whole: (body: () => void) => void;
  entry: (body: () => void) => void;
}

export function fsm<const D extends MachineSpec<StatesOf<D>, LimitsOf<D>>>(
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
    transition: (from: string, event: string, body, to?: string) =>
      to === undefined
        ? scoped(`переход ${from} —${event}→`, `tr:${from}:${event}`, body)
        : scoped(`переход ${from} —${event}→ ${to}`, `tr:${from}:${event}:${to}`, body),
    whole: (body) => scoped('автомат', 'machine', body),
    entry: (body) => scoped('вход', 'entry', body),
  };
}

export { graphOf, type GraphState, type GraphTransition, type MachineGraph } from './model.ts';
