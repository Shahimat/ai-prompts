import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActionDef, MachineDef, ModelRunner, Registry, Session } from '#harnesses/core/index';
import { harnessFile } from '#harnesses/core/index';
import { errorMessage } from '#shared/guards';
import type { PlanPage } from './page.ts';
import { judge, readPlanState, readReview, savePlanState } from './review.ts';

export interface PlanContext {
  session: Session;
  home: string;
  def: MachineDef;
  runner: ModelRunner;
  self: string[];
  hook: boolean;
  terminal: boolean;
  page: (root: string, file: string) => Promise<PlanPage>;
}

export const HOOKS = ['prompt', 'edit', 'bash', 'ask', 'answer', 'stop', 'end'] as const;
export type HookName = (typeof HOOKS)[number];

export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
export const PLANNER_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Edit',
  'Write',
  'Bash',
  'AskUserQuestion',
  'Agent',
];

const quote = (s: string): string =>
  /^[\w./:@-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, '\\$1')}"`;

const shell = (words: string[]): string => words.map(quote).join(' ');

export const planFileOf = (s: Session): string => s.data.planFile ?? '';

export const planPathOf = (s: Session): string => path.join(s.data.project, planFileOf(s));

export function hookCommand(ctx: PlanContext, hook: HookName): string {
  return shell([...ctx.self, 'plan-review', 'hook', ctx.session.short, hook, '--home', ctx.home]);
}

export function reportCommand(ctx: PlanContext): string {
  return shell([
    ...ctx.self,
    'expect',
    'report',
    planFileOf(ctx.session),
    '--root',
    ctx.session.data.project,
  ]);
}

export function hookSettings(ctx: PlanContext): object {
  const run = (hook: HookName, timeout: number) => ({
    type: 'command',
    command: hookCommand(ctx, hook),
    timeout,
  });
  return {
    hooks: {
      UserPromptSubmit: [{ hooks: [run('prompt', 30)] }],
      PreToolUse: [
        { matcher: EDIT_TOOLS.join('|'), hooks: [run('edit', 30)] },
        { matcher: 'Bash', hooks: [run('bash', 30)] },
        { matcher: 'AskUserQuestion', hooks: [run('ask', 30)] },
      ],
      PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [run('answer', 30)] }],
      Stop: [{ hooks: [run('stop', 3600)] }],
      SessionEnd: [{ hooks: [run('end', 30)] }],
    },
  };
}

const rulePath = (abs: string): string => `/${abs.split(path.sep).join('/')}`;

export function plannerTools(ctx: PlanContext): { tools: string[]; allowed: string[] } {
  const file = rulePath(planPathOf(ctx.session));
  return {
    tools: PLANNER_TOOLS,
    allowed: [
      'Read',
      'Glob',
      'Grep',
      `Edit(${file})`,
      `Write(${file})`,
      `Bash(${reportCommand(ctx)})`,
      'AskUserQuestion',
      'Agent',
    ],
  };
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

async function runPlanner(ctx: PlanContext): Promise<string> {
  const s = ctx.session;
  const resume = s.data.plannerSession !== undefined;
  const sessionId = s.data.plannerSession ?? randomUUID();
  if (!resume) {
    s.data.plannerSession = sessionId;
    await s.save();
  }
  const { tools, allowed } = plannerTools(ctx);
  const page = await openPage(ctx);
  try {
    await ctx.runner.interactive({
      cwd: s.data.project,
      model: ctx.def.models.planner,
      sessionId,
      resume,
      name: `plan-review · ${s.data.title}`,
      addDirs: [],
      systemPrompt: await template(ctx, 'planner', plannerVars(ctx, page?.url ?? 'не поднялась')),
      settings: hookSettings(ctx),
      tools,
      allowedTools: allowed,
      prompt: resume ? '' : s.data.request,
    });
  } finally {
    await page?.stop();
    const state = await readPlanState(s);
    delete state.page;
    await savePlanState(s, state);
  }
  return `сессия планера закрыта; продолжить — harness plan-review open ${s.short}`;
}

const planner = (events: readonly string[]): ActionDef<PlanContext> => ({
  events,
  run: async (ctx) => {
    if (ctx.hook) return { pause: `ждёт события сессии планера в ${ctx.session.data.state}` };
    if (!ctx.terminal)
      return {
        pause: `сессия планера идёт в терминале: harness plan-review open ${ctx.session.short}`,
      };
    return { pause: await runPlanner(ctx) };
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
