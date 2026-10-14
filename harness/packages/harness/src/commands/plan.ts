// Команды категории plan и сессий: harness plan …, harness session ….

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../diagnostics.ts';
import { errorCode, isRecord } from '../guards.ts';
import { drive, machineMermaid, type Journal } from '../fsm/machine.ts';
import { loadHarness, loadHarnessOrFail, type LoadedHarness } from '../handlers/load.ts';
import { readReview, startCycle, type PlanContext } from '../handlers/plan-iter.ts';
import { formalCheck, formatFinding } from '../plan/formal.ts';
import { renderPlanHtml } from '../plan/render.ts';
import { ClaudeRunner, type ModelRunner } from '../runner/claude.ts';
import { terminalPrompter, type Prompter } from '../runner/terminal.ts';
import {
  createSession,
  harnessHome,
  listHarnesses,
  listSessions,
  openSession,
  type Session,
} from '../store/session.ts';
import type { CommandArgs } from './types.ts';

/** Ввод-вывод процесса; тесты подменяют модель и терминал. */
export const io: { runner: () => ModelRunner; prompter: () => Prompter } = {
  runner: () => new ClaudeRunner(),
  prompter: terminalPrompter,
};

/** Как вызвать этот harness из hook и из планера: тем же Node, тем же файлом. */
export function selfCommand(): string[] {
  const bin = import.meta.url.endsWith('.ts') ? '../bin.ts' : '../bin.js';
  return [process.execPath, fileURLToPath(new URL(bin, import.meta.url))];
}

function param(args: CommandArgs, key: string): string {
  const value = args.params?.[key];
  if (value === undefined) throw new UsageError(`нет параметра <${key}>`);
  return value;
}

const homeOf = (args: CommandArgs): string => harnessHome(args.home);

function context(session: Session, home: string, harness: LoadedHarness): PlanContext {
  return {
    session,
    home,
    def: harness.def,
    criteria: harness.criteria,
    runner: io.runner(),
    prompter: io.prompter(),
    self: selfCommand(),
  };
}

function journal(session: Session): Journal {
  return {
    load: async () => ({ state: session.data.state, counters: { ...session.data.counters } }),
    save: async (next, from, event) => {
      session.data.state = next.state;
      session.data.counters = next.counters;
      await session.save();
      await session.log({ from, event, to: next.state, counters: next.counters });
    },
  };
}

async function run(session: Session, home: string, event?: string): Promise<number> {
  const harness = await loadHarnessOrFail(home, session.data.harness);
  const ctx = context(session, home, harness);
  const result = await drive(harness.def, harness.registry, journal(session), ctx, event);
  if ('final' in result) console.log(`${session.id}: ${result.final}`);
  else console.log(`${session.id}: ${result.paused} — ${result.message}`);
  return 0;
}

// ─────────────────────────────── plan ───────────────────────────────

export async function runPlanList(args: CommandArgs): Promise<number> {
  for (const name of await listHarnesses(homeOf(args), 'plan')) console.log(name);
  return 0;
}

const harnessName = (args: CommandArgs): string => `plan/${param(args, 'harness')}`;

export async function runPlanStart(args: CommandArgs): Promise<number> {
  const home = homeOf(args);
  const harness = await loadHarnessOrFail(home, harnessName(args));
  const prompter = io.prompter();
  const ask = async (value: string | undefined, question: string, flag: string) => {
    if (value !== undefined && value.trim() !== '') return value.trim();
    if (!prompter.interactive) throw new UsageError(`без терминала нужен ${flag}`);
    const answer = await prompter.text(question);
    if (answer === '') throw new UsageError(`пустое значение: ${flag}`);
    return answer;
  };
  const title = await ask(args.name, 'Название плана: ', '--name');
  const request = await ask(args.request, 'Запрос: ', '--request');
  const session = await createSession(home, {
    harness: harness.name,
    title,
    request,
    project: args.root,
    initial: harness.def.initial,
    now: args.now,
  });
  console.log(`сессия ${session.id}: ${session.dir}`);
  return run(session, home);
}

export async function runPlanValidate(args: CommandArgs): Promise<number> {
  const result = await loadHarness(homeOf(args), harnessName(args));
  if (result.harness !== undefined) {
    const plugins = result.harness.plugins;
    console.log(
      `${harnessName(args)}: ok${plugins.length > 0 ? ` (плагины: ${plugins.join(', ')})` : ''}`,
    );
    return 0;
  }
  for (const e of result.errors) console.error(e);
  console.error(`${harnessName(args)}: ошибок ${result.errors.length}`);
  return 1;
}

export async function runPlanGraph(args: CommandArgs): Promise<number> {
  const harness = await loadHarnessOrFail(homeOf(args), harnessName(args));
  console.log(machineMermaid(harness.def));
  return 0;
}

// ─────────────────────────────── session ───────────────────────────────

export async function runSessionList(args: CommandArgs): Promise<number> {
  for (const s of await listSessions(homeOf(args)))
    console.log(`${s.id}\t${s.data.harness}\t${s.data.state}\t${s.data.title}`);
  return 0;
}

const sessionOf = async (args: CommandArgs): Promise<Session> =>
  openSession(homeOf(args), param(args, 'session'));

export async function runSessionStatus(args: CommandArgs): Promise<number> {
  const s = await sessionOf(args);
  const counters = Object.entries(s.data.counters)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  console.log(`сессия: ${s.id}`);
  console.log(`harness: ${s.data.harness}`);
  console.log(`состояние: ${s.data.state}`);
  console.log(`проект: ${s.data.project}`);
  console.log(`план: ${s.planPath}${existsSync(s.planPath) ? '' : ' (ещё нет)'}`);
  console.log(`ревью: ${s.data.round}${counters === '' ? '' : ` · счётчики: ${counters}`}`);
  if (s.data.round > 0) {
    const last = await readReview(s, s.data.round);
    console.log(
      `последнее ревью: ${last.pass ? 'пройдено' : 'провал'}, замечаний ${last.findings.length}`,
    );
  }
  return 0;
}

export async function runSessionResume(args: CommandArgs): Promise<number> {
  return run(await sessionOf(args), homeOf(args));
}

export async function runSessionRetry(args: CommandArgs): Promise<number> {
  const s = await sessionOf(args);
  if (s.data.state !== 'failed')
    throw new UsageError(`retry — только из failed; сейчас ${s.data.state}`);
  await startCycle(s);
  return run(s, homeOf(args), 'retry');
}

interface HookState {
  hash: string;
  blocks: number;
}

async function readHookState(file: string): Promise<HookState> {
  try {
    const data: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (isRecord(data) && typeof data['hash'] === 'string' && typeof data['blocks'] === 'number')
      return { hash: data['hash'], blocks: data['blocks'] };
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  return { hash: '', blocks: 0 };
}

/**
 * Проверка 1a. В режиме `--hook` — Stop-hook планера: молчит, пока плана
 * нет или он не менялся с последней чистой проверки; блокирует ход
 * (код 2) при нарушениях; после предела блокировок подряд отпускает и
 * отмечает сессию — автомат уйдёт в failed.
 */
export async function runSessionCheck(args: CommandArgs): Promise<number> {
  const s = await sessionOf(args);
  const text = await s.readPlan();
  if (args.hook !== true) {
    if (text === undefined) throw new UsageError(`нет ${s.planPath}`);
    const findings = formalCheck(text, s.id);
    for (const f of findings) console.error(formatFinding(f));
    console.log(findings.length === 0 ? 'check: ok' : `check: нарушений ${findings.length}`);
    return findings.length === 0 ? 0 : 1;
  }
  if (text === undefined) return 0;
  const stateFile = s.file('hook.json');
  const state = await readHookState(stateFile);
  const hash = createHash('sha256').update(text).digest('hex');
  if (hash === state.hash) return 0;
  const findings = formalCheck(text, s.id);
  if (findings.length === 0) {
    await writeFile(stateFile, JSON.stringify({ hash, blocks: 0 }));
    return 0;
  }
  const harness = await loadHarnessOrFail(homeOf(args), s.data.harness);
  const limit = harness.def.limits['formal'] ?? 3;
  const blocks = state.blocks + 1;
  await writeFile(stateFile, JSON.stringify({ hash: state.hash, blocks }));
  if (blocks > limit) {
    s.data.formalExhausted = true;
    await s.save();
    console.error(`plan.md не проходит проверку структуры после ${limit} блокировок — отпускаю`);
    return 0;
  }
  console.error(
    [
      'plan.md не проходит проверку структуры (1a):',
      ...findings.map(formatFinding),
      'Исправь plan.md и снова запусти проверку.',
    ].join('\n'),
  );
  return 2;
}

async function render(s: Session, out?: string): Promise<string> {
  const text = await s.readPlan();
  if (text === undefined) throw new UsageError(`нет ${s.planPath}`);
  const file = out === undefined ? s.file('plan.html') : path.resolve(out);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, renderPlanHtml(text), 'utf8');
  return file;
}

export async function runSessionRender(args: CommandArgs): Promise<number> {
  console.log(await render(await sessionOf(args), args.out));
  return 0;
}

function openerFor(file: string): string[] {
  const browser = process.env['BROWSER'];
  if (browser !== undefined && browser !== '') return [browser, file];
  if (process.platform === 'darwin') return ['open', file];
  if (process.platform === 'win32') return ['cmd', '/c', 'start', '', file];
  return ['xdg-open', file];
}

export async function runSessionRead(args: CommandArgs): Promise<number> {
  const s = await sessionOf(args);
  const html = s.file('plan.html');
  const stale = !existsSync(html) || statSync(html).mtimeMs < statSync(s.planPath).mtimeMs;
  if (stale) await render(s);
  const [cmd = 'open', ...rest] = openerFor(html);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, rest, { stdio: 'ignore', detached: true });
    child.on('error', reject);
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
  console.log(html);
  return 0;
}

/** Экспортируемые артефакты сессии. */
const EXPORTS = ['plan.md', 'context.md', 'plan.html', 'failure-report.md'];

export async function runSessionClone(what: 'all' | 'md', args: CommandArgs): Promise<number> {
  const s = await sessionOf(args);
  if (!existsSync(s.planPath)) throw new UsageError(`нет ${s.planPath}`);
  if (what === 'md') {
    let target = path.resolve(args.root, args.out ?? 'plan.md');
    if (existsSync(target) && statSync(target).isDirectory()) target = path.join(target, 'plan.md');
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(s.planPath, target);
    console.log(target);
    return 0;
  }
  const dir = path.resolve(args.root, args.out ?? '.');
  await mkdir(dir, { recursive: true });
  for (const name of EXPORTS) {
    if (!existsSync(s.file(name))) continue;
    await copyFile(s.file(name), path.join(dir, name));
    console.log(path.join(dir, name));
  }
  return 0;
}
