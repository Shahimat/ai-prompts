import path from 'node:path';
import { BUDGET_TITLE, LEVELS, type Budget, type Level, type StepDef } from '#lib/expect/levels';
import { MACHINE_TITLE, STEP_TITLE } from '#lib/expect/plan';
import { isServiceTitle, STEP_STATUSES, type NodeScope, type StepStatus } from '#lib/expect/scope';
import { isOneOf, isRecord, isStringArray } from '#shared/guards';

export const STATUSES = ['passed', 'failed', 'todo', 'skipped', 'pending', 'disabled'] as const;

export interface MachineDecl {
  name: string;
  def: unknown;
}

export interface TestResult {
  file: string;
  path: string[];
  title: string;
  status: (typeof STATUSES)[number];
  message: string;
  level: Level;
  notes: string[];
  planned: boolean;
  pattern?: string;
  budget?: Budget;
  step?: string;
  stepStatus?: StepStatus;
  node?: NodeScope;
  stepDef?: StepDef;
  machine?: MachineDecl;
}

const isBudget = (v: unknown): v is Budget =>
  isRecord(v) && typeof v['crit'] === 'number' && typeof v['warn'] === 'number';

function stepDefOf(v: unknown): StepDef | undefined {
  if (!isRecord(v)) return undefined;
  const { id, title, status, after, why } = v;
  if (typeof id !== 'string' || typeof title !== 'string') return undefined;
  if (!isOneOf(STEP_STATUSES, status) || !isStringArray(after)) return undefined;
  const def: StepDef = { id, title, status, after };
  if (typeof why === 'string') def.why = why;
  return def;
}

function nodeOf(v: unknown): NodeScope | undefined {
  if (!isRecord(v) || typeof v['machine'] !== 'string' || typeof v['node'] !== 'string')
    return undefined;
  return { machine: v['machine'], node: v['node'] };
}

function machineOf(v: unknown): MachineDecl | undefined {
  if (!isRecord(v) || typeof v['name'] !== 'string') return undefined;
  return { name: v['name'], def: v['def'] };
}

export function parseVitestReport(data: unknown, root: string): TestResult[] {
  const fail = (what: string): never => {
    throw new Error(`отчёт vitest: ${what}`);
  };
  if (!isRecord(data) || !Array.isArray(data['testResults'])) return fail('нет testResults');
  return data['testResults'].flatMap((file: unknown) => {
    if (!isRecord(file) || typeof file['name'] !== 'string') return fail('файл без name');
    const name = file['name'];
    if (!Array.isArray(file['assertionResults'])) return fail(`${name}: нет assertionResults`);
    const tests = file['assertionResults'].map((a: unknown) => {
      if (!isRecord(a) || typeof a['title'] !== 'string') return fail(`${name}: тест без title`);
      const { ancestorTitles, status, failureMessages } = a;
      if (!isStringArray(ancestorTitles)) return fail(`${name}: ancestorTitles — не строки`);
      if (!isOneOf(STATUSES, status)) return fail(`${name}: неизвестный статус ${String(status)}`);
      if (!isStringArray(failureMessages)) return fail(`${name}: failureMessages — не строки`);
      const meta = isRecord(a['meta']) ? a['meta'] : {};
      const { level, notes, budget, planned, step, stepStatus, source, pattern } = meta;
      const result: TestResult = {
        file: relative(root, typeof source === 'string' ? source : name),
        path: ancestorTitles,
        title: a['title'],
        status,
        message: (failureMessages[0] ?? '').split('\n')[0] ?? '',
        level: isOneOf(LEVELS, level) ? level : 'crit',
        notes: isStringArray(notes) ? notes : [],
        planned: planned === true,
      };
      if (isBudget(budget)) result.budget = budget;
      if (typeof step === 'string') result.step = step;
      if (typeof pattern === 'string') result.pattern = pattern;
      if (isOneOf(STEP_STATUSES, stepStatus)) result.stepStatus = stepStatus;
      const node = nodeOf(meta['node']);
      if (node !== undefined) result.node = node;
      const stepDef = stepDefOf(meta['stepDef']);
      if (stepDef !== undefined) result.stepDef = stepDef;
      const machine = machineOf(meta['machine']);
      if (machine !== undefined) result.machine = machine;
      return { result, own: typeof source === 'string' };
    });
    const byTop = new Map<string, string>();
    for (const t of tests)
      if (t.own && t.result.path[0] !== undefined) byTop.set(t.result.path[0], t.result.file);
    return tests.map(({ result, own }) => {
      if (own) return result;
      const top = result.path[0];
      const file = top === undefined ? undefined : byTop.get(top);
      return file === undefined ? result : { ...result, file };
    });
  });
}

const relative = (root: string, file: string): string =>
  path.relative(root, file).split(path.sep).join('/');

export const fullName = (t: { path: string[]; title: string }): string =>
  [...t.path, t.title].join(' > ');

export function byFile(results: TestResult[]): Map<string, TestResult[]> {
  const files = new Map<string, TestResult[]>();
  for (const r of results) files.set(r.file, [...(files.get(r.file) ?? []), r]);
  return files;
}

export const visible = (results: TestResult[]): TestResult[] =>
  results.filter((r) => !isServiceTitle(r.title));

export const budgetOf = (tests: TestResult[]): Budget =>
  tests.find((t) => t.title === BUDGET_TITLE)?.budget ?? { crit: 0, warn: 0 };

export const stepsOf = (tests: TestResult[]): StepDef[] =>
  tests.flatMap((t) => (t.title === STEP_TITLE && t.stepDef !== undefined ? [t.stepDef] : []));

export const machinesOf = (tests: TestResult[]): MachineDecl[] =>
  tests.flatMap((t) =>
    t.title.startsWith(MACHINE_TITLE) && t.machine !== undefined ? [t.machine] : [],
  );

export const isPlannedTest = (t: TestResult): boolean =>
  t.planned && (t.status === 'skipped' || t.status === 'pending' || t.status === 'todo');

export const isProgress = (t: TestResult): boolean =>
  t.status === 'failed' && t.stepStatus === 'active';

export type Outcome = 'pass' | 'fail' | 'todo' | 'skip';

export function outcomeOf(t: TestResult): Outcome {
  if (isPlannedTest(t) || t.status === 'todo') return 'todo';
  if (t.status === 'failed') return 'fail';
  if (t.status === 'passed') return 'pass';
  return 'skip';
}

export function stepIssues(steps: StepDef[], tests: TestResult[]): string[] {
  const issues: string[] = [];
  const byId = new Map<string, StepDef>();
  for (const s of steps) {
    if (byId.has(s.id)) issues.push(`шаг ${s.id} объявлен дважды`);
    byId.set(s.id, s);
  }
  for (const s of steps) {
    for (const dep of s.after) {
      const d = byId.get(dep);
      if (d === undefined) issues.push(`шаг ${s.id}: в after нет шага ${dep}`);
      else if (s.status === 'done' && d.status !== 'done')
        issues.push(`шаг ${s.id} done, но ${dep} — ${d.status}`);
    }
    if (s.status === 'done' && tests.some((t) => t.step === s.id && t.planned))
      issues.push(`шаг ${s.id} done, но в нём есть ожидания без проверки (todo)`);
  }
  const color = new Map<string, number>();
  const visit = (id: string, stack: string[]): void => {
    if (color.get(id) === 2) return;
    if (color.get(id) === 1) {
      issues.push(`цикл шагов: ${[...stack.slice(stack.indexOf(id)), id].join(' → ')}`);
      return;
    }
    color.set(id, 1);
    for (const dep of byId.get(id)?.after ?? []) if (byId.has(dep)) visit(dep, [...stack, id]);
    color.set(id, 2);
  };
  for (const s of steps) visit(s.id, []);
  return issues;
}
