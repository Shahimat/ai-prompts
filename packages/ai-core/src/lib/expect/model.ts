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

export const STEP_TITLE = '__step__';
export const MACHINE_TITLE = '__machine__';
export const PLAN_TITLE = '__plan__';

export type Actor = 'script' | 'model' | 'user';

export interface GraphTransition {
  to: string;
  count?: string;
  reset: string[];
  label?: string;
}

export interface GraphState {
  name: string;
  actor?: Actor;
  final: boolean;
  description?: string;
  on: Record<string, GraphTransition[]>;
}

export interface MachineGraph {
  initial: string;
  start?: string;
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
  if (typeof t['label'] === 'string') result.label = t['label'];
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
    if (typeof s['description'] === 'string') state.description = s['description'];
    const on = s['on'];
    if (isObject(on))
      for (const [event, t] of Object.entries(on))
        state.on[event] = (Array.isArray(t) ? t : [t]).map(transitionOf);
    return state;
  });
  const graph: MachineGraph = { initial: def['initial'], limits, states };
  if (typeof def['start'] === 'string') graph.start = def['start'];
  return graph;
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
