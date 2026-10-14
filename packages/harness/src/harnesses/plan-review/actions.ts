// Встроенные действия процесса plan-review. Каждое — одно состояние
// автомата: модель работает только внутри действия, переход выбирает
// автомат по возвращённому событию.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActionDef, MachineDef, Registry } from '../core/index.ts';
import { UsageError } from '../../shared/diagnostics.ts';
import { isRecord } from '../../shared/guards.ts';
import {
  acceptFindings,
  findingsSchema,
  MODEL_STAGES,
  passes,
  verdict,
  type Criterion,
  type Finding,
  type ModelStage,
  type StageVerdict,
} from './plan/criteria.ts';
import { formalCheck, formatFinding } from './plan/formal.ts';
import {
  changedParts,
  dependencyMermaid,
  parsePlan,
  replaceSection,
  setFrontmatter,
  withDependents,
  withoutScriptSections,
} from './plan/model.ts';
import type { HeadlessRun, ModelRunner } from '../core/index.ts';
import type { Prompter } from '../core/index.ts';
import { harnessFile, type Session } from '../core/index.ts';

export interface PlanContext {
  session: Session;
  home: string;
  def: MachineDef;
  criteria: Criterion[];
  runner: ModelRunner;
  prompter: Prompter;
  /** Команда вызова этого harness: `[node, bin.js]`. */
  self: string[];
}

// ─────────────────────────────── общее ───────────────────────────────

const quote = (s: string): string =>
  /^[\w./:@-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, '\\$1')}"`;

/** Команда проверки 1a для планера и Stop-hook. */
export function checkCommand(ctx: PlanContext, hook = false): string {
  return [
    ...ctx.self,
    'session',
    ctx.session.id,
    'check',
    ...(hook ? ['--hook'] : []),
    '--home',
    ctx.home,
  ]
    .map(quote)
    .join(' ');
}

/** Настройки одной сессии Claude Code: только наш Stop-hook. */
export function hookSettings(ctx: PlanContext): object {
  return { hooks: { Stop: [{ hooks: [{ type: 'command', command: checkCommand(ctx, true) }] }] } };
}

/** Абсолютный путь в правиле разрешений Claude Code начинается с `//`. */
const rulePath = (dir: string): string => `/${dir.split(path.sep).join('/')}/**`;

/** Разрешения планера и исправителя: читать проект, писать только в каталог сессии. */
export function plannerTools(ctx: PlanContext): { tools: string[]; allowed: string[] } {
  const dir = rulePath(ctx.session.dir);
  return {
    tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'],
    allowed: [
      'Read',
      'Glob',
      'Grep',
      `Edit(${dir})`,
      `Write(${dir})`,
      `Bash(${checkCommand(ctx)})`,
    ],
  };
}

/** Инструменты стадий ревью: сеть только у стадии 2. */
export const REVIEW_TOOLS: Record<ModelStage, string[]> = {
  '1b': ['Read'],
  '2': ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
};

async function template(
  ctx: PlanContext,
  name: string,
  vars: Record<string, string>,
): Promise<string> {
  const file = harnessFile(ctx.home, ctx.session.data.harness, `prompts/${name}.md`);
  const text = await readFile(file, 'utf8');
  return text.replace(/\{\{(\w+)\}\}/g, (m: string, key: string) => vars[key] ?? m);
}

function baseVars(ctx: PlanContext): Record<string, string> {
  return {
    session: ctx.session.id,
    session_dir: ctx.session.dir,
    plan: ctx.session.planPath,
    context: ctx.session.contextPath,
    project: ctx.session.data.project,
    title: ctx.session.data.title,
    request: ctx.session.data.request,
    check: checkCommand(ctx),
  };
}

async function readPlanOrFail(ctx: PlanContext): Promise<string> {
  const text = await ctx.session.readPlan();
  if (text === undefined) throw new UsageError(`нет ${ctx.session.planPath}`);
  return text;
}

function gitStatus(dir: string): string | undefined {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : undefined;
}

/** Проект не должен меняться: изменения после прогона — в журнал и на экран. */
async function guardProject<T>(ctx: PlanContext, label: string, fn: () => Promise<T>): Promise<T> {
  const before = gitStatus(ctx.session.data.project);
  const result = await fn();
  const after = gitStatus(ctx.session.data.project);
  if (before !== undefined && after !== undefined && before !== after) {
    ctx.prompter.say(`ВНИМАНИЕ: ${label} изменил файлы проекта:\n${after}`);
    await ctx.session.log({ warning: 'project-changed', by: label, status: after });
  }
  return result;
}

async function writePlan(ctx: PlanContext, text: string): Promise<void> {
  await writeFile(ctx.session.planPath, text, 'utf8');
}

async function setStatus(ctx: PlanContext, status: string): Promise<void> {
  const text = await ctx.session.readPlan();
  if (text === undefined) return;
  const next = setFrontmatter(text, 'status', status);
  if (next !== text) await writePlan(ctx, next);
}

const isApproved = (text: string): boolean => parsePlan(text).frontmatter['status'] === 'approved';

/** Headless-прогон планера-исправителя: новый или возобновлённый контекст. */
async function runPlanner(
  ctx: PlanContext,
  promptText: string,
  resume?: string,
): Promise<string | undefined> {
  const { tools, allowed } = plannerTools(ctx);
  const run: HeadlessRun = {
    cwd: ctx.session.data.project,
    model: ctx.def.models.planner,
    addDirs: [ctx.session.dir],
    systemPrompt: await template(ctx, 'fixer', baseVars(ctx)),
    tools,
    allowedTools: allowed,
    prompt: promptText,
    persist: true,
    maxTurns: 60,
    settings: hookSettings(ctx),
  };
  if (resume === undefined) run.sessionId = randomUUID();
  else run.resume = resume;
  const result = await guardProject(ctx, 'исправитель', () => ctx.runner.headless(run));
  return result.sessionId ?? run.sessionId ?? resume;
}

// ─────────────────────────────── draft ───────────────────────────────

const draft: ActionDef<PlanContext> = {
  events: ['done'],
  run: async (ctx) => {
    if (!ctx.prompter.interactive)
      return {
        pause: `первичный диалог идёт в терминале: harness session ${ctx.session.id} resume`,
      };
    const sessionId = randomUUID();
    ctx.session.data.plannerSession = sessionId;
    await ctx.session.save();
    const systemPrompt = await template(ctx, 'planner', baseVars(ctx));
    const { tools, allowed } = plannerTools(ctx);
    await guardProject(ctx, 'планер', () =>
      ctx.runner.interactive({
        cwd: ctx.session.data.project,
        model: ctx.def.models.planner,
        sessionId,
        name: ctx.session.id,
        addDirs: [ctx.session.dir],
        systemPrompt,
        settings: hookSettings(ctx),
        tools,
        allowedTools: allowed,
        prompt: ctx.session.data.request,
      }),
    );
    return { event: 'done' };
  },
};

// ─────────────────────────────── formal ───────────────────────────────

const formal: ActionDef<PlanContext> = {
  events: ['ok', 'broken', 'exhausted'],
  run: async (ctx) => {
    if (ctx.session.data.formalExhausted === true) {
      delete ctx.session.data.formalExhausted;
      await ctx.session.save();
      return { event: 'exhausted' };
    }
    const text = await ctx.session.readPlan();
    const findings: Finding[] =
      text === undefined
        ? [{ criterion: 'sections', level: 'crit', stage: '1a', item: 'plan', text: 'нет plan.md' }]
        : formalCheck(text, ctx.session.id);
    await writeFile(ctx.session.file('formal.json'), `${JSON.stringify(findings, null, 2)}\n`);
    if (findings.length > 0 || text === undefined) return { event: 'broken' };
    // Схема — раздел скрипта: строится из «Зависит от».
    const next = replaceSection(text, 'Схема', dependencyMermaid(parsePlan(text).items));
    if (next !== text) await writePlan(ctx, next);
    return { event: 'ok' };
  },
};

const repair: ActionDef<PlanContext> = {
  events: ['done'],
  run: async (ctx) => {
    const raw = await readFile(ctx.session.file('formal.json'), 'utf8').catch(() => '[]');
    const parsed: unknown = JSON.parse(raw);
    const lines = Array.isArray(parsed)
      ? parsed.flatMap((f) =>
          isRecord(f) && typeof f['item'] === 'string' && typeof f['text'] === 'string'
            ? [`- ${f['item']}: ${f['text']}`]
            : [],
        )
      : [];
    const text = [
      'Проверка структуры plan.md (1a) нашла нарушения:',
      ...lines,
      '',
      `Исправь plan.md и прогони \`${checkCommand(ctx)}\` до чистого результата.`,
    ].join('\n');
    const resumed = await runPlanner(ctx, text, ctx.session.data.plannerSession);
    if (resumed !== undefined) ctx.session.data.plannerSession = resumed;
    await ctx.session.save();
    return { event: 'done' };
  },
};

// ─────────────────────────────── review ───────────────────────────────

function criteriaList(criteria: Criterion[], stage: ModelStage): string {
  return criteria
    .filter((c) => c.stage === stage)
    .map((c) => `- \`${c.id}\` (${c.level}): ${c.text}`)
    .join('\n');
}

interface StageRun {
  stage: ModelStage;
  findings: Finding[];
  costUsd: number | undefined;
}

/** Прогон стадии; стадии без критериев не запускаются — null. */
async function reviewStage(
  ctx: PlanContext,
  stage: ModelStage,
  reviewDir: string,
): Promise<StageRun | null> {
  if (!ctx.criteria.some((c) => c.stage === stage)) return null;
  const plan = path.join(reviewDir, 'plan.md');
  const result = await ctx.runner.headless({
    // Стадии 1b нужен только план; стадии 2 — проект и сеть.
    cwd: stage === '1b' ? reviewDir : ctx.session.data.project,
    model: ctx.def.models[stage],
    addDirs: stage === '1b' ? [] : [reviewDir],
    systemPrompt: await template(ctx, `review-${stage}`, {
      plan,
      project: ctx.session.data.project,
      criteria: criteriaList(ctx.criteria, stage),
    }),
    tools: REVIEW_TOOLS[stage],
    allowedTools: REVIEW_TOOLS[stage],
    prompt: `Проверь план ${plan} по критериям стадии ${stage}. Верни замечания по схеме.`,
    schema: findingsSchema(ctx.criteria, stage),
    persist: false,
    maxTurns: stage === '1b' ? 8 : 40,
  });
  return {
    stage,
    findings: acceptFindings(result.structured, ctx.criteria, stage),
    costUsd: result.costUsd,
  };
}

/** Раздел «Точки улучшения»: warn и info последнего ревью. */
export function improvementPoints(findings: Finding[]): string {
  const points = findings.filter((f) => f.level !== 'crit');
  if (points.length === 0) return '—';
  return points.map((f) => `- ${f.level} · ${f.item} · \`${f.criterion}\`: ${f.text}`).join('\n');
}

export interface ReviewRecord {
  round: number;
  findings: Finding[];
  verdicts: StageVerdict[];
  pass: boolean;
}

const review: ActionDef<PlanContext> = {
  events: ['pass', 'fail'],
  run: async (ctx) => {
    const text = await readPlanOrFail(ctx);
    const round = ctx.session.data.round + 1;
    const dir = ctx.session.file(path.join('review', String(round)));
    await mkdir(dir, { recursive: true });
    // Ревьюеры видят только копию плана без разделов скрипта: context.md
    // и прошлые замечания в каталог не попадают.
    await writeFile(path.join(dir, 'plan.md'), withoutScriptSections(text), 'utf8');
    const formalFindings = formalCheck(text, ctx.session.id);
    const findings: Finding[] = [...formalFindings];
    const runs: StageRun[] = [];
    if (formalFindings.length === 0) {
      if (ctx.def.review.mode === 'collect') {
        const all = await Promise.all(MODEL_STAGES.map((s) => reviewStage(ctx, s, dir)));
        runs.push(...all.filter((r) => r !== null));
      } else {
        for (const s of MODEL_STAGES) {
          const run = await reviewStage(ctx, s, dir);
          if (run === null) continue;
          runs.push(run);
          if (!passes(verdict(run.findings, ctx.def.review.budget, [s]))) break;
        }
      }
      findings.push(...runs.flatMap((r) => r.findings));
    }
    const stages = formalFindings.length > 0 ? (['1a'] as const) : runs.map((r) => r.stage);
    const verdicts = verdict(findings, ctx.def.review.budget, stages);
    const pass = passes(verdicts);
    const record: ReviewRecord = { round, findings, verdicts, pass };
    await ctx.session.log({
      review: round,
      costs: Object.fromEntries(runs.map((r) => [r.stage, r.costUsd ?? null])),
    });
    await writeFile(path.join(dir, 'findings.json'), `${JSON.stringify(record, null, 2)}\n`);
    ctx.session.data.round = round;
    if (!pass) ctx.session.data.fix = { source: 'review', round };
    await ctx.session.save();
    await writePlan(
      ctx,
      replaceSection(await readPlanOrFail(ctx), 'Точки улучшения', improvementPoints(findings)),
    );
    for (const v of verdicts)
      ctx.prompter.say(
        `ревью ${round} · ${v.stage}: crit ${v.crit} · warn ${v.warn} · info ${v.info} — ${v.pass ? 'ok' : 'провал'}`,
      );
    return { event: pass ? 'pass' : 'fail' };
  },
};

export async function readReview(session: Session, round: number): Promise<ReviewRecord> {
  const data: unknown = JSON.parse(
    await readFile(session.file(path.join('review', String(round), 'findings.json')), 'utf8'),
  );
  if (!isRecord(data) || !Array.isArray(data['findings']))
    throw new Error(`review/${round}/findings.json: нет findings`);
  const findings: Finding[] = data['findings'].flatMap((f): Finding[] => {
    if (!isRecord(f)) return [];
    const { criterion, level, stage, item, text } = f;
    if (
      typeof criterion !== 'string' ||
      typeof item !== 'string' ||
      typeof text !== 'string' ||
      (level !== 'crit' && level !== 'warn' && level !== 'info') ||
      (stage !== '1a' && stage !== '1b' && stage !== '2')
    )
      return [];
    return [{ criterion, level, stage, item, text }];
  });
  return { round, findings, verdicts: [], pass: data['pass'] === true };
}

// ─────────────────────────────── fix ───────────────────────────────

async function fixPrompt(ctx: PlanContext): Promise<string> {
  const fix = ctx.session.data.fix;
  if (fix === undefined) throw new Error('нет задания на правку');
  if (fix.source === 'review') {
    const record = await readReview(ctx.session, fix.round);
    return [
      `Ревью ${fix.round} не пропустило план. Замечания:`,
      ...record.findings.map((f) => `- ${formatFinding(f)}`),
      '',
      'Исправь plan.md по замечаниям crit и warn; info — на твоё усмотрение. Новые решения и отвергнутые варианты запиши в context.md.',
    ].join('\n');
  }
  if (fix.mode === 'rework')
    return [
      'Пользователь вернул план на переработку. Комментарий:',
      fix.comment,
      '',
      'Переработай plan.md целиком с учётом комментария; решения — в context.md.',
    ].join('\n');
  return [
    `Пользователь вернул на доработку пункты: ${fix.items.join(', ')}.`,
    fix.comment === '' ? '' : `Комментарий:\n${fix.comment}`,
    '',
    'Меняй только эти пункты и пункты, которые от них зависят. Остальное — побайтно как было.',
  ].join('\n');
}

const fixAction: ActionDef<PlanContext> = {
  events: ['done', 'rejected'],
  run: async (ctx) => {
    const before = await readPlanOrFail(ctx);
    if (isApproved(before)) throw new UsageError('согласованный план не правится');
    const resumed = await runPlanner(ctx, await fixPrompt(ctx));
    if (resumed !== undefined) ctx.session.data.plannerSession = resumed;
    const after = await readPlanOrFail(ctx);
    const fix = ctx.session.data.fix;
    if (fix?.source === 'user' && fix.mode === 'revise') {
      const allowed = withDependents(parsePlan(before).items, fix.items);
      const extra = changedParts(before, after).filter((p) => !allowed.has(p));
      if (extra.length > 0) {
        const rejected = ctx.session.file(path.join('revisions', `rejected-${Date.now()}.md`));
        await mkdir(path.dirname(rejected), { recursive: true });
        await writeFile(rejected, after, 'utf8');
        await writePlan(ctx, before);
        await ctx.session.save();
        ctx.prompter.say(`правка отклонена: изменены неотмеченные части ${extra.join(', ')}`);
        await ctx.session.log({ rejected: extra });
        return { event: 'rejected' };
      }
    }
    const revision = parsePlan(after).frontmatter['revision'];
    const nextRevision =
      typeof revision === 'number' && Number.isInteger(revision) ? revision + 1 : 1;
    const next = setFrontmatter(
      setFrontmatter(after, 'revision', `${nextRevision}`),
      'status',
      'draft',
    );
    await writePlan(ctx, next);
    await saveRevision(ctx, next);
    await ctx.session.save();
    return { event: 'done' };
  },
};

async function saveRevision(ctx: PlanContext, text: string): Promise<void> {
  const rev = parsePlan(text).frontmatter['revision'];
  const dir = ctx.session.file('revisions');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${typeof rev === 'number' ? rev : 'x'}.md`), text, 'utf8');
}

// ─────────────────────────────── user ───────────────────────────────

/** Новый цикл ревью: справка о провале считает раунды с этого номера. */
export async function startCycle(session: Session): Promise<void> {
  session.data.cycleStart = session.data.round + 1;
  await session.save();
}

async function walkItems(
  ctx: PlanContext,
  text: string,
): Promise<{ id: string; comment: string }[]> {
  const marked: { id: string; comment: string }[] = [];
  for (const item of parsePlan(text).items) {
    const answer = await ctx.prompter.text(
      `${item.id}. ${item.title} — Enter: нормально; иначе комментарий или «-» без комментария: `,
    );
    if (answer === '') continue;
    marked.push({ id: item.id, comment: answer === '-' ? '' : answer });
  }
  return marked;
}

const userMenu: ActionDef<PlanContext> = {
  events: ['approve', 'revise', 'rework', 'ask'],
  run: async (ctx) => {
    await setStatus(ctx, 'awaiting-user');
    if (!ctx.prompter.interactive)
      return { pause: `план ждёт решения: harness session ${ctx.session.id} resume` };
    const text = await readPlanOrFail(ctx);
    const p = ctx.prompter;
    p.say(`План: ${ctx.session.planPath}`);
    p.say(`HTML: harness session ${ctx.session.id} read`);
    for (;;) {
      const choice = await p.choose('Решение по плану:', [
        { key: 'approve', label: 'Согласовать всё' },
        { key: 'revise-all', label: 'Вернуть всё с комментарием' },
        { key: 'walk', label: 'Пройти по пунктам' },
        { key: 'rework', label: 'Переработать' },
        { key: 'ask', label: 'Уточнить' },
      ]);
      if (choice === 'approve') return { event: 'approve' };
      if (choice === 'revise-all') {
        const comment = await p.text('Комментарий: ');
        ctx.session.data.fix = {
          source: 'user',
          mode: 'revise',
          items: parsePlan(text).items.map((i) => i.id),
          comment,
        };
        await startCycle(ctx.session);
        return { event: 'revise' };
      }
      if (choice === 'walk') {
        const marked = await walkItems(ctx, text);
        if (marked.length === 0) {
          p.say('отмеченных пунктов нет');
          continue;
        }
        ctx.session.data.fix = {
          source: 'user',
          mode: 'revise',
          items: marked.map((m) => m.id),
          comment: marked
            .filter((m) => m.comment !== '')
            .map((m) => `${m.id}: ${m.comment}`)
            .join('\n'),
        };
        await startCycle(ctx.session);
        return { event: 'revise' };
      }
      if (choice === 'rework') {
        let comment = '';
        while (comment === '') {
          comment = await p.text('Что переработать (обязательно): ');
          if (comment === '') p.say('без комментария переработка не принимается');
        }
        ctx.session.data.fix = { source: 'user', mode: 'rework', items: [], comment };
        await startCycle(ctx.session);
        return { event: 'rework' };
      }
      const question = await p.text('Вопрос: ');
      if (question === '') continue;
      ctx.session.data.question = question;
      await ctx.session.save();
      return { event: 'ask' };
    }
  },
};

const answer: ActionDef<PlanContext> = {
  events: ['done'],
  run: async (ctx) => {
    const question = ctx.session.data.question;
    if (question === undefined) return { event: 'done' };
    const before = await readPlanOrFail(ctx);
    const result = await guardProject(ctx, 'ответ', async () =>
      ctx.runner.headless({
        cwd: ctx.session.data.project,
        model: ctx.def.models.planner,
        addDirs: [ctx.session.dir],
        systemPrompt: await template(ctx, 'answer', baseVars(ctx)),
        tools: ['Read', 'Glob', 'Grep'],
        allowedTools: ['Read', 'Glob', 'Grep'],
        prompt: question,
        persist: false,
        maxTurns: 20,
      }),
    );
    // «Уточнить» не меняет план ни на байт.
    if ((await readPlanOrFail(ctx)) !== before) await writePlan(ctx, before);
    const context = await readFile(ctx.session.contextPath, 'utf8').catch(() => '');
    await writeFile(
      ctx.session.contextPath,
      `${context.trimEnd()}\n\n## Уточнение\n\n**Вопрос.** ${question}\n\n**Ответ.** ${result.text.trim()}\n`,
      'utf8',
    );
    delete ctx.session.data.question;
    await ctx.session.save();
    ctx.prompter.say(result.text.trim());
    return { event: 'done' };
  },
};

// ─────────────────────────────── failed / approved ───────────────────────────────

/** Таблица «критерий × итерация»: критерий, упавший во всех итерациях, — кандидат на переформулировку. */
export function failureReport(title: string, records: ReviewRecord[]): string {
  const ids = [...new Set(records.flatMap((r) => r.findings.map((f) => f.criterion)))].sort();
  const header = `| Критерий | ${records.map((r) => `#${r.round}`).join(' | ')} | Повтор |`;
  const sep = `| --- | ${records.map(() => '---').join(' | ')} | --- |`;
  const rows = ids.map((id) => {
    const cells = records.map((r) => {
      const own = r.findings.filter((f) => f.criterion === id);
      return own.length === 0 ? '·' : own.map((f) => `${f.level} ${f.item}`).join(', ');
    });
    const always = records.length > 1 && cells.every((c) => c !== '·');
    return `| \`${id}\` | ${cells.join(' | ')} | ${always ? 'во всех — кандидат на переформулировку' : ''} |`;
  });
  return [
    `# Справка о провале: ${title}`,
    '',
    `Итераций ревью: ${records.length}. Лимит правок исчерпан.`,
    '',
    header,
    sep,
    ...rows,
    '',
    '## Замечания последней итерации',
    '',
    ...(records.at(-1)?.findings.map((f) => `- ${formatFinding(f)}`) ?? []),
    '',
  ].join('\n');
}

const reportFailure: ActionDef<PlanContext> = {
  events: ['retry'],
  run: async (ctx) => {
    const records: ReviewRecord[] = [];
    for (let r = ctx.session.data.cycleStart; r <= ctx.session.data.round; r++)
      records.push(
        await readReview(ctx.session, r).catch(() => ({
          round: r,
          findings: [],
          verdicts: [],
          pass: false,
        })),
      );
    await writeFile(
      ctx.session.file('failure-report.md'),
      failureReport(ctx.session.data.title, records),
      'utf8',
    );
    return {
      pause: `справка о провале: ${ctx.session.file('failure-report.md')}; заново — harness session ${ctx.session.id} retry`,
    };
  },
};

const approve: ActionDef<PlanContext> = {
  events: [],
  run: async (ctx) => {
    await setStatus(ctx, 'approved');
    ctx.prompter.say(`план согласован: ${ctx.session.planPath}`);
    return { event: 'done' };
  },
};

export function planReviewRegistry(): Registry<PlanContext> {
  return {
    actions: new Map<string, ActionDef<PlanContext>>([
      ['planner-draft', draft],
      ['plan-check', formal],
      ['planner-repair', repair],
      ['plan-review', review],
      ['planner-fix', fixAction],
      ['user-menu', userMenu],
      ['planner-answer', answer],
      ['report-failure', reportFailure],
      ['plan-approve', approve],
    ]),
    guards: new Map(),
  };
}
