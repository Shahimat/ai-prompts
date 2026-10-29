import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  errorMessage,
  isRecord,
  isStringArray,
  runtime,
  UsageError,
  type CommandArgs,
  type CommandNode,
} from '@shahimat/ai-core';
import {
  acceptDod,
  AFFIRMATIVE,
  answer,
  ask,
  asCard,
  callRead,
  callWrite,
  emit,
  harnessHome,
  jobFile,
  jobLog,
  jobMeta,
  lastFeedback,
  loadAutonomy,
  loadOpsConfig,
  loadProvider,
  opsRole,
  pending,
  PRIORITY,
  readJson,
  processModule,
  providerContext,
  report,
  resolveSession,
  runIndex,
  saveMeta,
  stopJobWatches,
  takeAnswered,
  takeFeedback,
  takeGate,
  writeCard,
  type ActionDef,
  type ActionResult,
  type HarnessModule,
  type ProcessContext,
  type Registry,
  type Session,
} from '#harnesses/core/index';

const NAME = 'ticket-work';

const answerHint = (s: Session): string => `ответ: ai ${NAME} answer ${s.short} <текст>`;
const rel = (s: Session, name: string): string => path.relative(s.data.project, jobFile(s, name));

async function provider(ctx: ProcessContext, iface: 'tasks' | 'vcs') {
  const config = await loadOpsConfig(ctx.session.data.project);
  return {
    config,
    provider: await loadProvider(
      ctx.session.data.project,
      ctx.home,
      iface,
      config.providers[iface],
    ),
    pctx: providerContext(ctx.session.data.project, ctx.home, config.repo),
  };
}

async function once(s: Session, marker: string, act: () => Promise<unknown>): Promise<void> {
  const file = jobFile(s, `.${marker}-${s.data.state}`);
  if (existsSync(file)) return;
  await act();
  await writeFile(file, '', 'utf8');
}

const clearMarker = (s: Session, marker: string, state: string): Promise<void> =>
  rm(jobFile(s, `.${marker}-${state}`), { force: true });

const reportOf = (data: unknown): string =>
  isRecord(data) && typeof data['report'] === 'string' ? data['report'] : '';

type RoleStep = { data: unknown } | ActionResult;

async function roleStep(
  ctx: ProcessContext,
  role: string,
  priority: number,
  task: string,
  addDirs: readonly string[] = [],
): Promise<RoleStep> {
  const s = ctx.session;
  await clearMarker(s, 'failed', 'failed');
  const waiting = await pending(s);
  if (waiting !== undefined && waiting.state === s.data.state && waiting.answer === undefined)
    return {
      pause: `вопросы роли ${role}:\n${waiting.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n${answerHint(s)}`,
    };
  const answered = await takeAnswered(s);
  const n = await runIndex(s, s.data.state);
  await jobLog(s, `роль ${role}: прогон ${n}`);
  let data: unknown;
  try {
    ({ data } = await opsRole({
      root: s.data.project,
      home: ctx.home,
      role,
      task: answered === undefined ? task : `${task}\n\nОтветы на твои вопросы:\n${answered}`,
      lane: 'jobs',
      priority: answered === undefined ? priority : PRIORITY.answered,
      job: s.short,
      options: { transcript: jobFile(s, `runs/${s.data.state}-${n}.jsonl`), addDirs },
    }));
  } catch (error) {
    await jobLog(s, `роль ${role}: ошибка — ${errorMessage(error)}`);
    await ask(s, [
      `роль ${role} не ответила: ${errorMessage(error)}. Повторить (любой ответ) или поправить причину?`,
    ]);
    await emit(
      ctx.home,
      s.data.project,
      'question',
      `роль ${role} не ответила — ${answerHint(s)}`,
      s.short,
    );
    return { pause: `роль ${role}: ${errorMessage(error)}\n${answerHint(s)}` };
  }
  const questions = isRecord(data) && isStringArray(data['questions']) ? data['questions'] : [];
  const failed = isRecord(data) && data['status'] === 'failed';
  await jobLog(
    s,
    `роль ${role}: ${failed ? 'провал' : 'готово'}${questions.length === 0 ? '' : `, вопросов ${questions.length}`}`,
  );
  if (questions.length > 0 || failed) {
    const list =
      questions.length > 0
        ? questions
        : [`роль ${role} сообщила о провале: ${reportOf(data)} — что делать?`];
    await ask(s, list);
    await emit(
      ctx.home,
      s.data.project,
      'question',
      `${list[0] ?? ''} — ${answerHint(s)}`,
      s.short,
    );
    return {
      pause: `вопросы роли ${role}:\n${list.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n${answerHint(s)}`,
    };
  }
  return { data };
}

const isResult = (r: RoleStep): r is ActionResult => 'pause' in r || 'event' in r;

const intake: ActionDef<ProcessContext> = {
  events: ['ok', 'fail'],
  run: async (ctx) => {
    const s = ctx.session;
    await clearMarker(s, 'failed', 'failed');
    try {
      const { provider: tasks, pctx } = await provider(ctx, 'tasks');
      const card = asCard(await callRead(tasks, 'fetch', [s.data.request, pctx]), tasks.source);
      await writeCard(s, card);
      await saveMeta(s, await jobMeta(s));
      await jobLog(s, `карточка: ${card.title}, DoD ${card.dod.length}`);
      return { event: 'ok' };
    } catch (error) {
      await jobLog(s, `intake: ${errorMessage(error)}`);
      return { event: 'fail' };
    }
  },
};

const research: ActionDef<ProcessContext> = {
  events: ['done'],
  run: async (ctx) => {
    const s = ctx.session;
    const r = await roleStep(
      ctx,
      'researcher',
      PRIORITY.research,
      `Исследуй задачу из карточки ${rel(s, 'task.md')} перед правкой: что где лежит, что затронет изменение, риски. Отчёт — в ${rel(s, 'research.md')} по формату роли.`,
    );
    return isResult(r) ? r : { event: 'done' };
  },
};

const plan: ActionDef<ProcessContext> = {
  events: ['done'],
  run: async (ctx) => {
    const s = ctx.session;
    const remark = existsSync(jobFile(s, 'plan-remark.md'))
      ? `\nЗамечание пользователя к прошлому плану: ${rel(s, 'plan-remark.md')}.`
      : '';
    const r = await roleStep(
      ctx,
      'implementer',
      PRIORITY.plan,
      `Режим плана: код не меняй. По карточке ${rel(s, 'task.md')} и исследованию ${rel(s, 'research.md')} составь план правки — шаги, файлы, проверки, связь с каждым пунктом DoD. План — в ${rel(s, 'plan.md')}.${remark}`,
    );
    return isResult(r) ? r : { event: 'done' };
  },
};

const gate: ActionDef<ProcessContext> = {
  events: ['approved', 'revise'],
  run: async (ctx) => {
    const s = ctx.session;
    const text = await takeGate(s);
    if (text === undefined) {
      await once(s, 'asked', () =>
        emit(
          ctx.home,
          s.data.project,
          'question',
          `план готов: ${rel(s, 'plan.md')} — «да» или замечание; ${answerHint(s)}`,
          s.short,
        ),
      );
      return { pause: `план: ${rel(s, 'plan.md')} — «да» или замечание к плану; ${answerHint(s)}` };
    }
    await clearMarker(s, 'asked', 'plan-gate');
    if (AFFIRMATIVE.test(text)) {
      await writeFile(jobFile(s, 'plan.approved'), `${new Date().toISOString()}\n`, 'utf8');
      await jobLog(s, 'план принят');
      return { event: 'approved' };
    }
    await writeFile(jobFile(s, 'plan-remark.md'), `${text}\n`, 'utf8');
    await jobLog(s, 'замечание к плану');
    return { event: 'revise' };
  },
};

async function workdirOf(ctx: ProcessContext): Promise<string> {
  const s = ctx.session;
  const meta = await jobMeta(s);
  if (meta.workdir !== undefined && existsSync(meta.workdir)) return meta.workdir;
  const { provider: vcs, pctx } = await provider(ctx, 'vcs');
  const dir = await callRead(vcs, 'create', [{ short: s.short, ref: s.data.request }, pctx]);
  if (typeof dir !== 'string') throw new UsageError(`${vcs.source}: create вернул не путь`);
  meta.workdir = dir;
  await saveMeta(s, meta);
  await jobLog(s, `копия: ${dir}`);
  return dir;
}

const implement: ActionDef<ProcessContext> = {
  events: ['done'],
  run: async (ctx) => {
    const s = ctx.session;
    let dir: string;
    try {
      dir = await workdirOf(ctx);
    } catch (error) {
      await ask(s, [`копия репозитория не создана: ${errorMessage(error)} — поправь и ответь`]);
      await emit(
        ctx.home,
        s.data.project,
        'question',
        `копия не создана — ${answerHint(s)}`,
        s.short,
      );
      return { pause: `копия не создана: ${errorMessage(error)}; ${answerHint(s)}` };
    }
    const extra = [
      existsSync(jobFile(s, 'review.md')) ? `замечания ревью — ${rel(s, 'review.md')}` : '',
      existsSync(jobFile(s, 'verify.log')) ? `последняя проверка — ${rel(s, 'verify.log')}` : '',
      (await lastFeedback(s)) === undefined
        ? ''
        : 'доработка — последний feedback-*.md в каталоге job',
    ].filter((x) => x !== '');
    const r = await roleStep(
      ctx,
      'implementer',
      PRIORITY.implement,
      [
        `Правь код в копии ${dir} (только там) по карточке ${rel(s, 'task.md')} и принятому плану ${rel(s, 'plan.md')}.`,
        extra.length === 0 ? '' : `Учти: ${extra.join('; ')}.`,
        `Не коммить и не пушь. Сообщение коммита — в ${rel(s, 'commit.md')}. Устойчивые факты для документации — намерения JSON по схеме intents в ${rel(s, 'intents.json')}.`,
      ]
        .filter((x) => x !== '')
        .join('\n'),
      [dir],
    );
    return isResult(r) ? r : { event: 'done' };
  },
};

const verify: ActionDef<ProcessContext> = {
  events: ['ok', 'fail'],
  run: async (ctx) => {
    const s = ctx.session;
    const config = await loadOpsConfig(s.data.project);
    const dir = (await jobMeta(s)).workdir ?? s.data.project;
    const lines: string[] = [];
    let ok = true;
    for (const cmd of config.verify) {
      const r = spawnSync(cmd, { cwd: dir, shell: true, encoding: 'utf8' });
      lines.push(
        `$ ${cmd}`,
        `код ${r.status ?? 'null'}`,
        (r.stdout ?? '').slice(-4000),
        (r.stderr ?? '').slice(-4000),
      );
      if (r.status !== 0) {
        ok = false;
        break;
      }
    }
    if (config.verify.length === 0) lines.push('проверок нет: context/ops.yml → verify');
    await writeFile(jobFile(s, 'verify.log'), `${lines.join('\n')}\n`, 'utf8');
    await jobLog(s, `проверка: ${ok ? 'ok' : 'провал'}`);
    return { event: ok ? 'ok' : 'fail' };
  },
};

export interface Verdict {
  status: 'ok' | 'fail' | 'unknown';
  item: string;
  evidence: string;
}

export function parseVerdicts(report: string): Verdict[] {
  const out: Verdict[] = [];
  for (const line of report.split('\n')) {
    const m = /^\s*-\s*\[(ok|fail|unknown)\]\s*(.+?)\s+—\s+(.+)$/.exec(line);
    if (m === null) continue;
    const status = m[1] === 'ok' || m[1] === 'fail' ? m[1] : 'unknown';
    out.push({ status, item: (m[2] ?? '').trim(), evidence: (m[3] ?? '').trim() });
  }
  return out;
}

const squash = (t: string): string => t.replace(/\s+/g, ' ').trim();

export async function quoted(dir: string, evidence: string): Promise<boolean> {
  const m = /([^\s«»:]+):(\d+)\s*«([^»]+)»/.exec(evidence);
  if (m === null) return false;
  const file = path.resolve(dir, m[1] ?? '');
  if (!file.startsWith(path.resolve(dir)) || !existsSync(file)) return false;
  return squash(await readFile(file, 'utf8')).includes(squash(m[3] ?? ''));
}

const review: ActionDef<ProcessContext> = {
  events: ['ok', 'fail'],
  run: async (ctx) => {
    const s = ctx.session;
    const { provider: tasks, pctx } = await provider(ctx, 'tasks');
    const card = asCard(await callRead(tasks, 'fetch', [s.data.request, pctx]), tasks.source);
    const previous = await readJson(jobFile(s, 'dod.json'), `${s.short}/dod.json`);
    const { dodChanged } = await writeCard(s, card);
    const waiting = await pending(s);
    const dodQuestion =
      waiting !== undefined &&
      waiting.state === s.data.state &&
      (waiting.questions[0] ?? '').startsWith('DoD');
    if (dodQuestion && waiting.answer === undefined)
      return { pause: `DoD в источнике изменился; ${answerHint(s)}` };
    if (dodChanged && !dodQuestion) {
      await ask(s, [
        'DoD в источнике изменился — продолжить по новому DoD? («да» — по новому, иначе — по прежнему)',
      ]);
      await emit(ctx.home, s.data.project, 'question', `DoD изменился — ${answerHint(s)}`, s.short);
      return { pause: `DoD в источнике изменился; ${answerHint(s)}` };
    }
    if (dodQuestion && waiting.answer !== undefined) {
      await takeAnswered(s);
      if (!AFFIRMATIVE.test(waiting.answer) && isStringArray(previous))
        await writeFile(
          jobFile(s, 'dod-previous.md'),
          `${previous.map((d) => `- ${d}`).join('\n')}\n`,
          'utf8',
        );
      await acceptDod(s, card.dod);
    }
    const dodNote = existsSync(jobFile(s, 'dod-previous.md'))
      ? ` Проверяй по прежнему DoD из ${rel(s, 'dod-previous.md')}: пользователь не принял новый.`
      : '';
    const dir = (await jobMeta(s)).workdir ?? s.data.project;
    const { provider: vcs, pctx: vctx } = await provider(ctx, 'vcs');
    const diff = await callRead(vcs, 'diff', [dir, vctx]);
    await writeFile(jobFile(s, 'diff'), typeof diff === 'string' ? diff : '', 'utf8');
    const r = await roleStep(
      ctx,
      'reviewer',
      PRIORITY.review,
      [
        `Проверь результат по DoD карточки ${rel(s, 'task.md')}.${dodNote}`,
        `Diff — ${rel(s, 'diff')}, копия репозитория — ${dir}, проверки — ${rel(s, 'verify.log')}.`,
        'Report — строки «- [ok|fail|unknown] <пункт DoD> — <путь от корня копии>:<строка> «<дословная цитата>»» или причина; для ok цитата обязательна.',
      ].join('\n'),
      [dir],
    );
    if (isResult(r)) return r;
    const verdicts = parseVerdicts(reportOf(r.data));
    const checked: Verdict[] = [];
    for (const v of verdicts)
      checked.push(
        v.status === 'ok' && !(await quoted(dir, v.evidence))
          ? { ...v, status: 'unknown', evidence: `цитата не найдена дословно: ${v.evidence}` }
          : v,
      );
    const lines = checked.map((v) => `- [${v.status}] ${v.item} — ${v.evidence}`);
    await writeFile(jobFile(s, 'review.md'), `${lines.join('\n') || reportOf(r.data)}\n`, 'utf8');
    const failed =
      checked.some((v) => v.status === 'fail') ||
      (checked.length === 0 && isRecord(r.data) && r.data['status'] === 'failed');
    const unknown = checked.filter((v) => v.status === 'unknown').length;
    await jobLog(
      s,
      `ревью: ${failed ? 'провал' : 'ok'}${unknown === 0 ? '' : `, без доказательства ${unknown}`}`,
    );
    return { event: failed ? 'fail' : 'ok' };
  },
};

const ready: ActionDef<ProcessContext> = {
  events: ['done', 'feedback'],
  run: async (ctx) => {
    const s = ctx.session;
    const feedback = await takeFeedback(s);
    if (feedback !== undefined) {
      await clearMarker(s, 'asked', 'ready');
      await jobLog(s, 'доработка');
      return { event: 'feedback' };
    }
    const text = await takeGate(s);
    if (text === undefined) {
      const dir = (await jobMeta(s)).workdir ?? s.data.project;
      const msg = `готово к коммиту: копия ${dir}, diff ${rel(s, 'diff')}, сообщение ${rel(s, 'commit.md')}, ревью ${rel(s, 'review.md')}; закоммить сам и ответь «готово», доработка — текстом; ${answerHint(s)}`;
      await once(s, 'asked', () => emit(ctx.home, s.data.project, 'ready', msg, s.short));
      return { pause: msg };
    }
    await clearMarker(s, 'asked', 'ready');
    if (AFFIRMATIVE.test(text)) return { event: 'done' };
    await writeFile(jobFile(s, 'feedback.md'), `${text}\n`, 'utf8');
    await takeFeedback(s);
    await jobLog(s, 'доработка от пользователя');
    return { event: 'feedback' };
  },
};

const docs: ActionDef<ProcessContext> = {
  events: ['ok'],
  run: async (ctx) => {
    const s = ctx.session;
    const intents = jobFile(s, 'intents.json');
    if (!existsSync(intents)) return { event: 'ok' };
    const [bin = process.execPath, ...pre] = runtime().self;
    const r = spawnSync(
      bin,
      [
        ...pre,
        'docs-delta',
        'start',
        '--name',
        `job-${s.short}`,
        '--file',
        intents,
        '--root',
        s.data.project,
        '--home',
        ctx.home,
      ],
      { cwd: s.data.project, encoding: 'utf8' },
    );
    await jobLog(s, `документация: docs-delta — код ${r.status ?? 'null'}`);
    if (r.status !== 0)
      await emit(
        ctx.home,
        s.data.project,
        'warn',
        `docs-delta для job не прошла — намерения в ${rel(s, 'intents.json')}`,
        s.short,
      );
    return { event: 'ok' };
  },
};

const failed: ActionDef<ProcessContext> = {
  events: ['retry'],
  run: async (ctx) => {
    const s = ctx.session;
    await once(s, 'failed', () =>
      emit(
        ctx.home,
        s.data.project,
        'failed',
        `попытки исчерпаны — журнал ${rel(s, 'log.md')}; повтор: ai ${NAME} open ${s.short}`,
        s.short,
      ),
    );
    return {
      pause: `попытки исчерпаны — журнал ${rel(s, 'log.md')}; исправь причину и запусти ai ${NAME} open ${s.short}`,
    };
  },
};

const done: ActionDef<ProcessContext> = {
  events: [],
  run: async (ctx) => {
    const s = ctx.session;
    const root = s.data.project;
    const meta = await jobMeta(s);
    try {
      if (meta.workdir !== undefined && existsSync(meta.workdir)) {
        const { provider: vcs, pctx } = await provider(ctx, 'vcs');
        await callRead(vcs, 'remove', [meta.workdir, pctx]);
      }
    } catch (error) {
      await jobLog(s, `копия не удалена: ${errorMessage(error)}`);
    }
    await stopJobWatches(ctx.home, root, s.short);
    const { provider: tasks, pctx } = await provider(ctx, 'tasks');
    const status = `готово: job ${s.short}`;
    if (tasks.methods.has('update')) {
      const outcome = await callWrite(tasks, await loadAutonomy(root), 'update', false, [
        s.data.request,
        status,
        pctx,
      ]);
      if (!outcome.done) {
        const file = jobFile(s, 'status.md');
        await writeFile(file, `${status}\n`, 'utf8');
        await emit(
          ctx.home,
          root,
          'suggest',
          `статус в источник — после «да»: ai ops act tasks update ${s.data.request} --file ${rel(s, 'status.md')}`,
          s.short,
        );
      }
    }
    await jobLog(s, 'закрыт');
    await emit(ctx.home, root, 'done', `job закрыт: ${s.data.title}`, s.short);
    return { event: 'done' };
  },
};

function registry(): Registry<ProcessContext> {
  return {
    actions: new Map<string, ActionDef<ProcessContext>>([
      ['job-intake', intake],
      ['job-research', research],
      ['job-plan', plan],
      ['job-gate', gate],
      ['job-implement', implement],
      ['job-verify', verify],
      ['job-review', review],
      ['job-ready', ready],
      ['job-docs', docs],
      ['job-failed', failed],
      ['job-done', done],
    ]),
    guards: new Map([
      ['no-card', (ctx: ProcessContext) => !existsSync(jobFile(ctx.session, 'task.md'))],
      ['no-plan', (ctx: ProcessContext) => !existsSync(jobFile(ctx.session, 'plan.approved'))],
    ]),
  };
}

const module: HarnessModule = processModule(NAME, registry, {
  title: (args: CommandArgs) => args.name ?? args.params?.['ref'] ?? NAME,
  request: async (args: CommandArgs) => {
    const ref = args.params?.['ref'];
    if (ref === undefined) throw new UsageError('нет параметра <ref>');
    return ref;
  },
  options: '[--name <заголовок>]',
});
module.startParams = ['<ref>'];

const answerNode: CommandNode = {
  path: [NAME, 'answer', '<id>', '<text>'],
  kind: 'harness',
  effect: 'mutation',
  options: '[--home <dir>]',
  run: async (args) => {
    const home = harnessHome(args.home);
    const id = args.params?.['id'];
    const text = args.params?.['text'];
    if (id === undefined || text === undefined) throw new UsageError('нужны <id> и <text>');
    const s = await resolveSession(home, id, NAME);
    const kind = await answer(s, text);
    await jobLog(s, `ответ пользователя (${kind === 'question' ? 'на вопрос' : 'решение'})`);
    return report(s, await module.drive(s, home));
  },
};
module.nodes = [answerNode];

export const TICKET_WORK = module;
