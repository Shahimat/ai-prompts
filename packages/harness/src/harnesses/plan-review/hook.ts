import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expectBuild, isRecord } from '@shahimat/ai-core';
import { driveSession } from '#harnesses/core/index';
import {
  planFileOf,
  planPathOf,
  reportCommand,
  type HookName,
  type PlanContext,
} from './actions.ts';
import type { LoadedHarness } from './load.ts';
import { readPlanState, readReview, reviewText, savePlanState } from './review.ts';

export interface HookInput {
  prompt?: string;
  file_path?: string;
  command?: string;
  message?: string;
  reason?: string;
}

export function hookInputOf(raw: unknown): HookInput {
  if (!isRecord(raw)) return {};
  const input: HookInput = {};
  const str = (
    key: string,
    to: 'prompt' | 'file_path' | 'command' | 'message' | 'reason',
  ): void => {
    const value = raw[key];
    if (typeof value === 'string') input[to] = value;
  };
  str('prompt', 'prompt');
  str('file_path', 'file_path');
  str('path', 'file_path');
  str('command', 'command');
  str('message', 'message');
  str('text', 'message');
  str('reason', 'reason');
  return input;
}

export interface HookDecision {
  event?: string;
  block?: string;
}

export const EXIT_WORD = 'выход';

export const EXIT_FLAG = '[plan-review: exit]';

export const ASK_FLAG = '[plan-review: ask]';

const lastLine = (message: string | undefined): string =>
  (message ?? '').trimEnd().split('\n').at(-1)?.trim() ?? '';

export const hasExitFlag = (message: string | undefined): boolean =>
  lastLine(message) === EXIT_FLAG;

export const hasAskFlag = (message: string | undefined): boolean => lastLine(message) === ASK_FLAG;

export const askQuestionOf = (message: string): string =>
  message.trimEnd().split('\n').slice(0, -1).join('\n').trim();

export const isExitWord = (prompt: string | undefined): boolean =>
  (prompt ?? '').trim().toLowerCase() === EXIT_WORD;

export function bashDecision(command: string | undefined, allowed: string): HookDecision {
  if ((command ?? '').trim() === allowed) return {};
  return {
    block: `в сессии планера Bash — только прогон файла ожиданий: ${allowed}. Читай проект инструментами Read, Glob и Grep.`,
  };
}

export function hookEvent(
  state: string,
  hook: HookName,
  input: HookInput,
  planPath: string,
): HookDecision {
  if (hook === 'prompt') {
    if (state !== 'awaiting_input') return {};
    return { event: isExitWord(input.prompt) ? 'exit' : 'request' };
  }
  if (hook === 'ask') return state === 'composing' ? { event: 'unclear' } : {};
  if (hook === 'answer') return state === 'clarify_form' ? { event: 'answered' } : {};
  if (hook === 'edit') {
    const target = path.resolve(input.file_path ?? '');
    if (target !== path.resolve(planPath))
      return { block: `планер правит только файл ожиданий ${planPath}` };
    if (state === 'gathering') return { event: 'gathered' };
    if (state === 'composing') return {};
    return { block: `в состоянии ${state} файл ожиданий не меняется` };
  }
  return {};
}

export const FINISHED =
  'Сессия plan-review завершена: файл ожиданий записан, harness закрывает сессию планера.';

export interface HookOutcome {
  code: number;
  message?: string;
  task?: string;
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

async function afterReview(ctx: PlanContext): Promise<HookOutcome> {
  const s = ctx.session;
  const { round } = await readPlanState(s);
  const record = await readReview(s, round);
  if (record === undefined) return { code: 0 };
  const lines = reviewText(record);
  const hint =
    !record.summary.remarksDeclared && record.summary.remarks.length > 0
      ? [
          '',
          'В файле есть замечания, а блока info.remarks нет: скажи пользователю и попроси добавить info.remarks().',
        ]
      : [];
  if (s.data.state === 'composing') {
    const text = [
      `Ревью ${round}: сверх бюджета файла. Исправь ожидания по замечаниям и закончи ход — ревью повторится.`,
      ...lines,
      ...hint,
    ].join('\n');
    return { code: 2, task: text, message: text };
  }
  const { page } = await readPlanState(s);
  const link = page === undefined ? [] : [`Страница плана: ${page} — дай пользователю эту ссылку.`];
  if (record.pass) {
    const text = [
      `Ревью ${round} чистое. Кратко поясни пользователю, что записано и что осталось заглушками, и жди его следующего запроса.`,
      ...link,
      ...lines,
      ...hint,
    ].join('\n');
    return { code: 2, task: text, message: text };
  }
  const cycles = ctx.def.limits['cycles'] ?? 0;
  const text = [
    `Ревью ${round}: после ${cycles} циклов без чистого ревью. Объясни пользователю, где зациклился и что не можешь разрешить, и жди его решения.`,
    ...lines,
    ...hint,
  ].join('\n');
  return { code: 2, task: text, message: text };
}

async function exitNow(ctx: PlanContext, harness: LoadedHarness): Promise<HookOutcome> {
  await driveSession(harness.def, harness.registry, ctx.session, ctx, 'exit');
  return { code: 0 };
}

const stateNow = (s: PlanContext['session']): string => s.data.state;

async function lastReviewClean(s: PlanContext['session']): Promise<boolean> {
  const { round } = await readPlanState(s);
  return round === 0 || (await readReview(s, round))?.pass === true;
}

const POSTPONED =
  'Выход отложен: последнее ревью с замечаниями сверх бюджета. Исправь их и снова поставь флаг выхода.';

async function onStop(
  ctx: PlanContext,
  harness: LoadedHarness,
  input: HookInput,
): Promise<HookOutcome> {
  const s = ctx.session;
  const flag = hasExitFlag(input.message);
  if (s.data.state === 'gathering')
    await driveSession(harness.def, harness.registry, s, ctx, 'replied');
  if (stateNow(s) === 'awaiting_input') {
    if (!flag) return { code: 0 };
    return (await lastReviewClean(s)) ? exitNow(ctx, harness) : { code: 2, task: POSTPONED };
  }
  if (stateNow(s) !== 'composing') return { code: 0 };
  const text = await readFile(planPathOf(s), 'utf8');
  const hash = sha(text);
  const state = await readPlanState(s);
  if (state.reviewedHash === hash) {
    if (!flag) return { code: 0 };
    return (await lastReviewClean(s)) ? exitNow(ctx, harness) : { code: 2, task: POSTPONED };
  }
  const build = expectBuild(s.data.project, planFileOf(s));
  if (!build.ok) {
    const blocks = state.buildBlocks + 1;
    const limit = harness.def.limits['build'] ?? 0;
    if (blocks > limit) {
      await savePlanState(s, { ...state, buildBlocks: 0 });
      await s.log({ build: 'released', errors: build.errors });
      return { code: 0 };
    }
    await savePlanState(s, { ...state, buildBlocks: blocks });
    const task = [
      `Файл ожиданий не собирается (${blocks}/${limit}) — ревью не запущено. Исправь:`,
      ...build.errors,
    ].join('\n');
    return { code: 2, task, message: `Файл ожиданий не собирается (${blocks}/${limit}).` };
  }
  await savePlanState(s, { ...state, buildBlocks: 0, reviewedHash: hash });
  await driveSession(harness.def, harness.registry, s, ctx, 'written');
  const outcome = await afterReview(ctx);
  if (!flag) return outcome;
  const { round } = await readPlanState(s);
  const clean = (await readReview(s, round))?.pass === true;
  if (stateNow(s) === 'awaiting_input' && clean) return exitNow(ctx, harness);
  const postponed: HookOutcome =
    outcome.task === undefined ? { code: 2, message: POSTPONED } : { code: 2, task: outcome.task };
  return { ...postponed, message: [POSTPONED, outcome.message ?? ''].join('\n\n') };
}

export async function runHook(
  ctx: PlanContext,
  harness: LoadedHarness,
  hook: HookName,
  input: HookInput,
): Promise<HookOutcome> {
  const s = ctx.session;
  const finished = (): boolean =>
    harness.def.states.find((st) => st.name === s.data.state)?.final === true;
  if (hook === 'end') {
    await s.log({ pause: s.data.state, reason: input.reason ?? '' });
    return { code: 0 };
  }
  if (hook === 'bash') {
    const decision = bashDecision(input.command, reportCommand(ctx));
    return decision.block === undefined ? { code: 0 } : { code: 2, message: decision.block };
  }
  if (finished())
    return hook === 'prompt' || hook === 'edit' ? { code: 2, message: FINISHED } : { code: 0 };
  if (hook === 'ask') {
    if (stateNow(s) !== 'composing') return { code: 0 };
    s.data.pendingQuestion = askQuestionOf(input.message ?? '');
    await s.save();
    await driveSession(harness.def, harness.registry, s, ctx, 'unclear');
    return { code: 0 };
  }
  if (hook === 'answer') {
    if (stateNow(s) !== 'clarify_form') return { code: 0 };
    const answer = input.prompt ?? '';
    await driveSession(harness.def, harness.registry, s, ctx, 'answered');
    return { code: 0, task: answer };
  }
  if (hook === 'stop') return onStop(ctx, harness, input);
  const decision = hookEvent(s.data.state, hook, input, planPathOf(s));
  if (decision.block !== undefined) return { code: 2, message: decision.block };
  if (decision.event !== undefined) {
    if (decision.event === 'request') s.data.stageTask = input.prompt ?? '';
    await s.save();
    await driveSession(harness.def, harness.registry, s, ctx, decision.event);
  }
  if (decision.event === undefined && input.prompt !== undefined && !finished())
    return { code: 0, task: input.prompt };
  return finished() ? { code: 2, message: FINISHED } : { code: 0 };
}
