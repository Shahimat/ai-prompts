import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ModelRunner } from '@shahimat/ai-core';
import {
  cliCommand,
  errorMessage,
  isRecord,
  openCodeTextOf,
  spawnOpenCode,
  resolveProjectModel,
} from '@shahimat/ai-core';
import type { ActionDef, MachineDef, Registry, Session } from '#harnesses/core/index';
import { harnessFile } from '#harnesses/core/index';
import { hasAskFlag, runHook, type HookInput, type HookOutcome } from './hook.ts';
import type { LoadedHarness } from './load.ts';
import type { PlanPage } from './page.ts';
import { judge, readPlanState, readReview, savePlanState } from './review.ts';

export interface PlanContext {
  session: Session;
  home: string;
  def: MachineDef;
  harness: LoadedHarness;
  runner: ModelRunner;
  stage: StageRunner;
  repl: (prompt: string) => Promise<string>;
  hook: boolean;
  terminal: boolean;
  page: (root: string, file: string) => Promise<PlanPage>;
}

export const HOOKS = ['prompt', 'edit', 'bash', 'ask', 'answer', 'stop', 'end'] as const;
export type HookName = (typeof HOOKS)[number];

export const PLANNER_AGENT = 'planner';

export const plannerAgentPath = (root: string): string =>
  path.join(root, '.opencode', 'agents', `${PLANNER_AGENT}.md`);

export const BRIDGE_DIR = path.join('.opencode', 'artifacts', 'plan-review');

export const BRIDGE_FILE = path.join(BRIDGE_DIR, 'bridge.json');

export const EVENTS_FILE = 'planner-events.jsonl';

export interface StageSpec {
  cwd: string;
  model: string;
  sessionId: string;
  resume: boolean;
  systemPrompt: string;
  task: string;
  attachments: string[];
}

export interface StageResult {
  code: number;
  text: string;
  error?: string;
}

export interface StageRunner {
  run: (spec: StageSpec) => Promise<StageResult>;
}

export const eventsFileOf = (s: Session): string => s.file(EVENTS_FILE);

const quote = (s: string): string =>
  /^[\w./:@-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, '\\$1')}"`;

const shell = (words: string[]): string => words.map(quote).join(' ');

export const planFileOf = (s: Session): string => s.data.planFile ?? '';

export const planPathOf = (s: Session): string => path.join(s.data.project, planFileOf(s));

export function reportCommand(ctx: PlanContext): string {
  return shell([
    ...cliCommand(),
    'expect',
    'report',
    planFileOf(ctx.session),
    '--root',
    ctx.session.data.project,
  ]);
}

export interface BridgeSpec {
  events: string;
  plan: string;
  report: string;
}

export async function writeBridge(ctx: PlanContext): Promise<BridgeSpec> {
  const bridge: BridgeSpec = {
    events: eventsFileOf(ctx.session),
    plan: planFileOf(ctx.session),
    report: reportCommand(ctx),
  };
  await mkdir(path.join(ctx.session.data.project, BRIDGE_DIR), { recursive: true });
  await writeFile(
    path.join(ctx.session.data.project, BRIDGE_FILE),
    `${JSON.stringify(bridge, null, 2)}\n`,
    'utf8',
  );
  return bridge;
}

export const opencodeStage: StageRunner = {
  run: async (spec) => {
    const result = await spawnOpenCode(
      {
        cwd: spec.cwd,
        agent: PLANNER_AGENT,
        model: spec.model,
        prompt: spec.systemPrompt,
        task: spec.task,
        out: '',
        session: spec.sessionId,
        attachments: spec.attachments,
      },
      {
        onLine: (line) => {
          const text = openCodeTextOf(line);
          if (text !== undefined) console.log(text);
        },
      },
    );
    return result.error === undefined
      ? { code: result.code, text: result.text }
      : { code: result.code, text: result.text, error: result.error };
  },
};

const ATTACHMENT = /(?:^|\s)@(\S+)/g;

export function attachmentsOf(task: string, root: string): string[] {
  const out: string[] = [];
  for (const match of task.matchAll(ATTACHMENT)) {
    const file = match[1] ?? '';
    const abs = path.resolve(root, file);
    if (existsSync(abs)) out.push(abs);
  }
  return out;
}

export async function readPlannerEvents(
  file: string,
  from: number,
  root: string,
): Promise<{ input: HookInput[]; next: number }> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return { input: [], next: from };
  }
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const input: HookInput[] = [];
  for (const line of lines.slice(from)) {
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(data)) continue;
    if (data['kind'] === 'edit' && typeof data['path'] === 'string')
      input.push({ file_path: path.resolve(root, data['path']) });
  }
  return { input, next: lines.length };
}

export async function template(
  ctx: PlanContext,
  name: string,
  vars: Record<string, string>,
): Promise<string> {
  const file = harnessFile(ctx.home, ctx.session.data.harness, `prompts/${name}.md`);
  const text = await readFile(file, 'utf8');
  return text.replace(/\{\{(\w+)\}\}/g, (m: string, key: string) => vars[key] ?? m);
}

const plannerVars = (ctx: PlanContext, page: string): Record<string, string> => ({
  page,
  title: ctx.session.data.title,
  project: ctx.session.data.project,
  plan: planFileOf(ctx.session),
  report: reportCommand(ctx),
  cycles: String(ctx.def.limits['cycles'] ?? 0),
});

async function openPage(ctx: PlanContext): Promise<PlanPage | undefined> {
  const s = ctx.session;
  try {
    const page = await ctx.page(s.data.project, planFileOf(s));
    console.log(`страница плана: ${page.url}`);
    await savePlanState(s, { ...(await readPlanState(s)), page: page.url });
    return page;
  } catch (error) {
    console.error(`страница плана не поднялась: ${errorMessage(error)}`);
    return undefined;
  }
}

const finalOf = (harness: LoadedHarness, s: Session): boolean =>
  harness.def.states.find((st) => st.name === s.data.state)?.final === true;

const finishedMessage = 'сессия планера закрыта: план завершён.';

async function queueTask(s: Session, outcome: HookOutcome): Promise<void> {
  if (outcome.message !== undefined) console.log(outcome.message);
  if (outcome.task === undefined) return;
  s.data.stageTask = outcome.task;
  await s.save();
}

const PLANNER_STATES = ['awaiting_input', 'gathering', 'composing', 'clarify_form'];

async function stageTurn(
  ctx: PlanContext,
  harness: LoadedHarness,
  task: string,
  offset: { value: number },
): Promise<void> {
  const s = ctx.session;
  const resume = s.data.plannerSession !== undefined;
  if (s.data.plannerSession === undefined) {
    s.data.plannerSession = `ses_${randomUUID().replaceAll('-', '')}`;
    await s.save();
  }
  const spec: StageSpec = {
    cwd: s.data.project,
    model: (
      await resolveProjectModel(
        s.data.project,
        'planner',
        ctx.def.models.planner,
        'plan-review.planner',
      )
    ).model,
    sessionId: s.data.plannerSession,
    resume,
    systemPrompt: await template(
      ctx,
      'planner',
      plannerVars(ctx, (await readPlanState(s)).page ?? 'не поднялась'),
    ),
    task,
    attachments: attachmentsOf(task, s.data.project),
  };
  const result = await ctx.stage.run(spec);
  if (result.error !== undefined) console.error(`стадия планера: ${result.error}`);
  const events = await readPlannerEvents(eventsFileOf(s), offset.value, s.data.project);
  offset.value = events.next;
  const hookCtx: PlanContext = { ...ctx, hook: true };
  for (const input of events.input) await runHook(hookCtx, harness, 'edit', input);
  if (hasAskFlag(result.text)) await runHook(hookCtx, harness, 'ask', { message: result.text });
  let outcome: HookOutcome = { code: 0 };
  if (s.data.state !== 'clarify_form')
    outcome = await runHook(hookCtx, harness, 'stop', { message: result.text });
  if (outcome.task === undefined) delete s.data.stageTask;
  else s.data.stageTask = outcome.task;
  await s.save();
  if (outcome.message !== undefined) console.log(outcome.message);
}

export async function runEpisode(ctx: PlanContext, harness: LoadedHarness): Promise<string> {
  const s = ctx.session;
  if (s.data.request !== '') {
    const request = s.data.request;
    s.data.request = '';
    await s.save();
    await runHook({ ...ctx, hook: true }, harness, 'prompt', { prompt: request });
  }
  await writeBridge(ctx);
  const page = await openPage(ctx);
  const offset = { value: 0 };
  let interrupt = false;
  const onInterrupt = (): void => {
    interrupt = true;
  };
  process.on('SIGINT', onInterrupt);
  try {
    for (;;) {
      if (finalOf(harness, s)) return finishedMessage;
      if (interrupt) {
        await runHook({ ...ctx, hook: true }, harness, 'end', { reason: 'interrupt' });
        return `пауза: сессия на месте — ai plan-review open ${s.short}`;
      }
      const state = s.data.state;
      if (!PLANNER_STATES.includes(state))
        return `состояние ${state} не исполняется в интерактивном сеансе — повтори open`;
      const hookCtx: PlanContext = { ...ctx, hook: true };
      if (state === 'clarify_form') {
        console.log(`вопрос планера: ${s.data.pendingQuestion ?? ''}`);
        const answer = await ctx.repl('ответ > ');
        if (answer.trim() === '')
          return `пауза: ввод закрыт, сессия на месте — ai plan-review open ${s.short}`;
        const outcome = await runHook(hookCtx, harness, 'answer', { prompt: answer });
        await queueTask(s, outcome);
        continue;
      }
      const queued = s.data.stageTask ?? '';
      if (queued !== '') {
        delete s.data.stageTask;
        await s.save();
        await stageTurn(ctx, harness, queued, offset);
        continue;
      }
      const line = await ctx.repl('планер > ');
      if (line.trim() === '')
        return `пауза: ввод закрыт, сессия на месте — ai plan-review open ${s.short}`;
      const outcome = await runHook(hookCtx, harness, 'prompt', { prompt: line });
      if (outcome.task === undefined && s.data.stageTask === undefined && !finalOf(harness, s)) {
        s.data.stageTask = line;
        await s.save();
      } else await queueTask(s, outcome);
    }
  } finally {
    process.off('SIGINT', onInterrupt);
    await page?.stop();
    const state = await readPlanState(s);
    delete state.page;
    await savePlanState(s, state);
  }
}

const planner = (events: readonly string[]): ActionDef<PlanContext> => ({
  events,
  run: async (ctx) => {
    if (ctx.hook) return { pause: `ждёт события сессии планера в ${ctx.session.data.state}` };
    if (!ctx.terminal)
      return {
        pause: `сессия планера идёт в терминале: ai plan-review open ${ctx.session.short}`,
      };
    return { pause: await runEpisode(ctx, ctx.harness) };
  },
});

const judgeAction: ActionDef<PlanContext> = {
  events: ['reviewed'],
  run: async (ctx) => {
    await judge(
      {
        session: ctx.session,
        def: ctx.def,
        runner: ctx.runner,
        systemPrompt: await template(ctx, 'judge', { project: ctx.session.data.project }),
      },
      planFileOf(ctx.session),
    );
    return { event: 'reviewed' };
  },
};

const analyze: ActionDef<PlanContext> = {
  events: ['remarks', 'clean'],
  run: async (ctx) => {
    const { round } = await readPlanState(ctx.session);
    const last = await readReview(ctx.session, round);
    return { event: last?.pass === true ? 'clean' : 'remarks' };
  },
};

export function planReviewRegistry(): Registry<PlanContext> {
  return {
    actions: new Map<string, ActionDef<PlanContext>>([
      ['planner-await', planner(['request', 'exit'])],
      ['planner-gather', planner(['gathered', 'replied'])],
      ['planner-compose', planner(['written', 'unclear'])],
      ['planner-clarify', planner(['answered'])],
      ['plan-judge', judgeAction],
      ['plan-analyze', analyze],
    ]),
    guards: new Map(),
  };
}
