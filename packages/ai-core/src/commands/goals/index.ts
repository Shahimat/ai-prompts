import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import * as ts from 'typescript';
import type { CommandArgs } from '#shared/args';
import { UsageError, type Diagnostic } from '#shared/diagnostics';
import { errorCode, isRecord } from '#shared/guards';
import { report } from '#shared/report';
import { BASELINE_DIR, GOALS_DIR } from '#shared/layout';

interface Step {
  kind: 'describe' | 'crit' | 'warn' | 'wip' | 'todo' | 'budget';
  title?: string;
  ticket?: string;
  crit?: number;
  warn?: number;
}

interface Ticket {
  key: string;
  title: string;
  todo: boolean;
  wip: boolean;
}

interface Goal {
  steps: Step[];
  tickets: Ticket[];
}

const posix = (p: string): string => p.split(path.sep).join('/');

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

async function listDir(abs: string): Promise<string[]> {
  try {
    return (await readdir(abs)).sort();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
}

function literal(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function callName(node: ts.CallExpression): string | undefined {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const left = expression.expression;
    const base = ts.isIdentifier(left) ? left.text : undefined;
    return base === undefined ? undefined : `${base}.${expression.name.text}`;
  }
  return undefined;
}

function budgetOf(node: ts.CallExpression): Pick<Step, 'crit' | 'warn'> {
  const arg = node.arguments[0];
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return {};
  const values: Pick<Step, 'crit' | 'warn'> = {};
  for (const property of arg.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name.getText();
    if (name !== 'crit' && name !== 'warn') continue;
    if (!ts.isNumericLiteral(property.initializer)) continue;
    if (name === 'crit') values.crit = Number(property.initializer.text);
    else values.warn = Number(property.initializer.text);
  }
  return values;
}

function parseGoal(file: string, text: string): Goal {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const steps: Step[] = [];
  const tickets: Ticket[] = [];

  const visit = (node: ts.Node, ticket: Ticket | undefined): void => {
    if (ts.isCallExpression(node)) {
      const name = callName(node);
      if (name === 'describe') {
        const title = literal(node.arguments[0]);
        if (title !== undefined && title.startsWith('ticket:')) {
          const key = title.slice('ticket:'.length).trim();
          const current: Ticket = { key, title, todo: false, wip: false };
          tickets.push(current);
          steps.push({ kind: 'describe', title, ticket: key });
          ts.forEachChild(node, (child) => visit(child, current));
          return;
        }
        steps.push({
          kind: 'describe',
          ...(title === undefined ? {} : { title }),
          ...(ticket === undefined ? {} : { ticket: ticket.key }),
        });
      } else if (name === 'crit' || name === 'warn') {
        steps.push({ kind: name, ...(ticket === undefined ? {} : { ticket: ticket.key }) });
      } else if (name === 'crit.wip') {
        if (ticket !== undefined) ticket.wip = true;
        steps.push({ kind: 'wip', ...(ticket === undefined ? {} : { ticket: ticket.key }) });
      } else if (name === 'it.todo') {
        if (ticket !== undefined) ticket.todo = true;
        const title = literal(node.arguments[0]);
        steps.push({
          kind: 'todo',
          ...(title === undefined ? {} : { title }),
          ...(ticket === undefined ? {} : { ticket: ticket.key }),
        });
      } else if (name === 'budget') {
        steps.push({
          kind: 'budget',
          ...budgetOf(node),
          ...(ticket === undefined ? {} : { ticket: ticket.key }),
        });
      }
    }
    ts.forEachChild(node, (child) => visit(child, ticket));
  };
  visit(source, undefined);
  return { steps, tickets };
}

function fileOf(args: CommandArgs): string {
  const file = args.params?.['file'];
  if (file === undefined) throw new UsageError('нужен путь к файлу цели: <goal.expect.ts>');
  return posix(path.relative(args.root, path.resolve(args.root, file)));
}

async function goalOf(args: CommandArgs): Promise<{ rel: string; goal: Goal }> {
  const rel = fileOf(args);
  if (!rel.endsWith('.expect.ts')) throw new UsageError(`файл цели — *.expect.ts: ${rel}`);
  const text = await readOrNull(path.join(args.root, rel));
  if (text === null) throw new UsageError(`нет файла цели ${rel} в ${args.root}`);
  return { rel, goal: parseGoal(rel, text) };
}

function signature(goal: Goal, ticket: string): string {
  return goal.steps
    .map((step) => {
      const inside = step.ticket === ticket;
      const ticketTitle =
        step.kind === 'describe' && step.title !== undefined && step.title.startsWith('ticket:');
      const title = !inside || ticketTitle ? (step.title ?? '') : '';
      const budget = step.kind === 'budget' ? `${step.crit ?? 0}/${step.warn ?? 0}` : '';
      return [step.kind, step.ticket ?? '', title, budget].join('|');
    })
    .join('\n');
}

async function check(args: CommandArgs): Promise<number> {
  const ticket = args.ticket;
  if (ticket === undefined || ticket === '') throw new UsageError('нужен --ticket <key>');
  let { rel, goal } = await goalOf(args);
  if (!goal.tickets.some((t) => t.key === ticket) && rel.startsWith(`${GOALS_DIR}/program--`)) {
    for (const imported of await importsOf(args, rel)) {
      const text = await readOrNull(path.join(args.root, imported));
      if (text === null) continue;
      const candidate: Goal = parseGoal(imported, text);
      if (candidate.tickets.some((t) => t.key === ticket)) {
        rel = imported;
        goal = candidate;
        break;
      }
    }
  }
  const diagnostics: Diagnostic[] = [];
  if (!goal.tickets.some((t) => t.key === ticket))
    diagnostics.push({ file: rel, message: `нет тикета ${ticket}` });

  const base = path.posix.join(BASELINE_DIR, ticket);
  const candidates = [path.posix.join(base, rel), path.posix.join(base, path.posix.basename(rel))];
  let baselinePath: string | undefined;
  let baselineText: string | undefined;
  for (const candidate of candidates) {
    const text = await readOrNull(path.join(args.root, candidate));
    if (text !== null) {
      baselinePath = candidate;
      baselineText = text;
      break;
    }
  }
  if (baselineText === undefined) {
    diagnostics.push({ file: base, message: 'нет baseline: снимите снимок файла цели' });
  } else {
    const expected = signature(parseGoal(baselinePath ?? rel, baselineText), ticket);
    const actual = signature(goal, ticket);
    if (expected !== actual)
      diagnostics.push({
        file: rel,
        message:
          'AST не совпадает с baseline: изменения вне активного тикета или смена структуры/budget',
      });
  }
  return report('goals check', diagnostics);
}

async function programFiles(args: CommandArgs): Promise<string[]> {
  const dir = path.join(args.root, GOALS_DIR);
  const names = (await listDir(dir)).filter((n) => n.endsWith('.expect.ts'));
  const programs = names.filter((n) => n.startsWith('program--'));
  return programs.length > 0
    ? programs.map((n) => `${GOALS_DIR}/${n}`)
    : names.map((n) => `${GOALS_DIR}/${n}`);
}

async function importsOf(args: CommandArgs, rel: string): Promise<string[]> {
  const text = await readOrNull(path.join(args.root, rel));
  if (text === null) return [];
  const matches = [...text.matchAll(/import\s+['"]\.\/([^'"]+\.expect\.ts)['"]/g)];
  return matches.map((m) => path.posix.join(path.posix.dirname(rel), m[1] ?? ''));
}

function latestPass(raw: string | null): boolean | undefined {
  if (raw === null) return undefined;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data)) return false;
    const results: unknown = data['results'];
    if (!Array.isArray(results)) return false;
    const last: unknown = results.at(-1);
    if (!isRecord(last)) return false;
    const items: unknown = last['items'];
    if (!Array.isArray(items) || items.length === 0) return false;
    const pass = items.filter((item) => isRecord(item) && item['status'] === 'pass').length;
    return pass / items.length >= 0.8;
  } catch {
    return false;
  }
}

function printGoal(rel: string, goal: Goal, result: string | null): void {
  const achieved = latestPass(result);
  const last = goal.tickets.at(-1);
  if (goal.tickets.length === 0) {
    console.log(`${rel}: тикетов нет`);
    return;
  }
  for (const ticket of goal.tickets) {
    const stage = ticket.todo
      ? 'план'
      : ticket.wip
        ? 'в работе'
        : ticket === last && achieved === true
          ? 'достигнута'
          : 'готовый план';
    console.log(`${rel}: ${ticket.key} — ${stage}`);
  }
}

async function status(args: CommandArgs): Promise<number> {
  const rel = args.params?.['file'];
  const files =
    rel === undefined
      ? await programFiles(args)
      : [posix(path.relative(args.root, path.resolve(args.root, rel)))];
  for (const file of files) {
    const goal = parseGoal(file, (await readOrNull(path.join(args.root, file))) ?? '');
    if (file.startsWith(`${GOALS_DIR}/program--`)) {
      const imports = await importsOf(args, file);
      if (imports.length === 0) {
        console.log(`${file}: целей нет`);
        continue;
      }
      for (const imported of imports) {
        const text = await readOrNull(path.join(args.root, imported));
        if (text === null) continue;
        printGoal(
          imported,
          parseGoal(imported, text),
          await readOrNull(confinedProjectPath(args.root, expectStateFile(imported))),
        );
      }
      continue;
    }
    printGoal(file, goal, await readOrNull(confinedProjectPath(args.root, expectStateFile(file))));
  }
  return 0;
}

export async function runGoals(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command === 'check') return check(args);
  if (command === 'status') return status(args);
  throw new UsageError(`неизвестная команда: goals ${command ?? ''}`.trimEnd());
}
import { confinedProjectPath, expectStateFile } from '#lib/artifacts';
