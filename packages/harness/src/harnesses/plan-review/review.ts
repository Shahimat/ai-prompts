import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expectSummary, runExpect, type ExpectSummary } from '#commands/expect/index';
import { errorCode, isRecord, isStringArray } from '#shared/guards';
import type { MachineDef, ModelRunner, Session } from '#harnesses/core/index';

export const JUDGE_TOOLS = ['Read', 'Glob', 'Grep'];

export interface ReviewRecord {
  round: number;
  pass: boolean;
  summary: ExpectSummary;
  rejected: string[];
}

export interface PlanState {
  round: number;
  reviewedHash?: string;
  buildBlocks: number;
  page?: string;
}

const stateFile = (s: Session): string => s.file('plan-review.json');

export async function readPlanState(s: Session): Promise<PlanState> {
  try {
    const data: unknown = JSON.parse(await readFile(stateFile(s), 'utf8'));
    if (isRecord(data)) {
      const state: PlanState = {
        round: typeof data['round'] === 'number' ? data['round'] : 0,
        buildBlocks: typeof data['buildBlocks'] === 'number' ? data['buildBlocks'] : 0,
      };
      if (typeof data['reviewedHash'] === 'string') state.reviewedHash = data['reviewedHash'];
      if (typeof data['page'] === 'string') state.page = data['page'];
      return state;
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  return { round: 0, buildBlocks: 0 };
}

export async function savePlanState(s: Session, state: PlanState): Promise<void> {
  await writeFile(stateFile(s), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

const reviewFile = (s: Session, round: number): string =>
  s.file(path.join('review', `${round}.json`));

export async function readReview(s: Session, round: number): Promise<ReviewRecord | undefined> {
  if (!existsSync(reviewFile(s, round))) return undefined;
  const data: unknown = JSON.parse(await readFile(reviewFile(s, round), 'utf8'));
  if (!isRecord(data) || typeof data['pass'] !== 'boolean' || !isRecord(data['summary']))
    throw new Error(`review/${round}.json: нет pass или summary`);
  return {
    round,
    pass: data['pass'],
    summary: summaryOf(data['summary']),
    rejected: isStringArray(data['rejected']) ? data['rejected'] : [],
  };
}

function summaryOf(v: Record<string, unknown>): ExpectSummary {
  const num = (r: unknown, key: string): number =>
    isRecord(r) && typeof r[key] === 'number' ? r[key] : 0;
  const list = (key: string): unknown[] => {
    const value = v[key];
    return Array.isArray(value) ? value : [];
  };
  return {
    blocked: v['blocked'] === true,
    count: {
      crit: num(v['count'], 'crit'),
      warn: num(v['count'], 'warn'),
      info: num(v['count'], 'info'),
      pending: num(v['count'], 'pending'),
    },
    budget: { crit: num(v['budget'], 'crit'), warn: num(v['budget'], 'warn') },
    remarks: list('remarks').flatMap((r) =>
      isRecord(r) && typeof r['text'] === 'string'
        ? [
            typeof r['detail'] === 'string'
              ? { text: r['text'], detail: r['detail'] }
              : { text: r['text'] },
          ]
        : [],
    ),
    failures: list('failures').flatMap((f) =>
      isRecord(f) &&
      (f['level'] === 'crit' || f['level'] === 'warn') &&
      typeof f['title'] === 'string' &&
      typeof f['message'] === 'string'
        ? [{ level: f['level'], title: f['title'], message: f['message'] }]
        : [],
    ),
    remarksDeclared: v['remarksDeclared'] === true,
  };
}

const ANSWER_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'verdict', 'ref', 'quote', 'reason'],
  properties: {
    id: { type: 'string' },
    verdict: { type: 'boolean' },
    ref: { type: 'string' },
    quote: { type: 'string' },
    reason: { type: 'string' },
  },
};

export const BATCH_ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answers'],
  properties: { answers: { type: 'array', items: ANSWER_ITEM } },
};

export const LINT_ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['contradictions', 'unmeasurable'],
  properties: {
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['a', 'b', 'reason'],
        properties: { a: { type: 'string' }, b: { type: 'string' }, reason: { type: 'string' } },
      },
    },
    unmeasurable: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'reason'],
        properties: { id: { type: 'string' }, reason: { type: 'string' } },
      },
    },
  },
};

interface JudgeTask {
  task: string;
  answer: string;
  kind: 'batch' | 'lint';
}

function tasksOf(plan: unknown): JudgeTask[] {
  if (!isRecord(plan)) return [];
  const of = (key: string, kind: JudgeTask['kind']): JudgeTask[] => {
    const list = plan[key];
    return Array.isArray(list)
      ? list.flatMap((t) =>
          isRecord(t) && typeof t['task'] === 'string' && typeof t['answer'] === 'string'
            ? [{ task: t['task'], answer: t['answer'], kind }]
            : [],
        )
      : [];
  };
  return [...of('batches', 'batch'), ...of('lint', 'lint')];
}

async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  console.log = () => undefined;
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}

export interface JudgeInput {
  session: Session;
  def: MachineDef;
  runner: ModelRunner;
  systemPrompt: string;
}

async function answerTask(
  input: JudgeInput,
  root: string,
  t: JudgeTask,
): Promise<string | undefined> {
  const text = await readFile(path.join(root, t.task), 'utf8');
  const result = await input.runner.headless({
    cwd: root,
    model: input.def.models.judge,
    addDirs: [],
    systemPrompt: input.systemPrompt,
    tools: JUDGE_TOOLS,
    allowedTools: JUDGE_TOOLS,
    prompt: `${text}\nФайл ответа не пиши: верни этот JSON структурированным ответом по схеме.`,
    schema: t.kind === 'batch' ? BATCH_ANSWER_SCHEMA : LINT_ANSWER_SCHEMA,
    persist: false,
    maxTurns: 30,
  });
  const answer =
    t.kind === 'batch' && isRecord(result.structured)
      ? result.structured['answers']
      : result.structured;
  if (answer === undefined) return `${t.task}: судья не вернул ответ`;
  await writeFile(path.join(root, t.answer), JSON.stringify(answer, null, 2), 'utf8');
  return undefined;
}

export const EXPECT_ENV = ['HARNESS_EXPECT_ROOT', 'HARNESS_EXPECT_ENTRY'];

export async function keepExpectEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = EXPECT_ENV.map((key) => [key, process.env[key]] as const);
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export function judge(input: JudgeInput, file: string): Promise<ReviewRecord> {
  return keepExpectEnv(() => judgeFile(input, file));
}

async function judgeFile(input: JudgeInput, file: string): Promise<ReviewRecord> {
  const s = input.session;
  const root = s.data.project;
  const abs = path.join(root, file);
  const before = await readFile(abs, 'utf8');
  const args = { root, now: new Date(), params: { file } };
  const rejected: string[] = [];
  if ((await quiet(() => runExpect('judge', args))) !== 0) {
    const plan: unknown = JSON.parse(
      await readFile(path.join(root, path.dirname(file), '.judge', 'plan.json'), 'utf8'),
    );
    const errors = await Promise.all(tasksOf(plan).map((t) => answerTask(input, root, t)));
    rejected.push(...errors.filter((e) => e !== undefined));
    if ((await readFile(abs, 'utf8')) !== before) {
      await writeFile(abs, before, 'utf8');
      rejected.push('судья изменил файл ожиданий — правка отменена');
    }
    await quiet(() => runExpect('judge', { ...args, apply: true }));
  }
  const summary = await expectSummary(root, file);
  const state = await readPlanState(s);
  const record: ReviewRecord = {
    round: state.round + 1,
    pass: !summary.blocked,
    summary,
    rejected,
  };
  await mkdir(path.dirname(reviewFile(s, record.round)), { recursive: true });
  await writeFile(reviewFile(s, record.round), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await savePlanState(s, { ...state, round: record.round });
  await s.log({ review: record.round, pass: record.pass, count: summary.count });
  return record;
}

export function reviewText(r: ReviewRecord): string[] {
  const { count, budget } = r.summary;
  return [
    `crit ${count.crit}/${budget.crit} · warn ${count.warn}/${budget.warn} · info ${count.info}${count.pending > 0 ? ` · без вердикта ${count.pending}` : ''}`,
    ...r.summary.failures.map((f) => `- ${f.level} «${f.title}» — ${f.message}`),
    ...r.summary.remarks.map((m) => `- ${m.text}${m.detail === undefined ? '' : ` — ${m.detail}`}`),
    ...r.rejected.map((e) => `- судья: ${e}`),
  ];
}
