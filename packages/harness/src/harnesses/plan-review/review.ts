import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  expectSummary,
  expectPlanConsumer,
  runExpect,
  errorMessage,
  type ExpectSummary,
  type ExpectConsumerTask,
} from '@shahimat/ai-core';
import { confinedProjectPath } from '@shahimat/ai-core';
import { errorCode, isRecord, isStringArray, resolveProjectModel } from '@shahimat/ai-core';
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
  type: 'array',
  items: ANSWER_ITEM,
};

export const LINT_ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['evaluated'],
  properties: {
    evaluated: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'problem', 'reason'],
        properties: {
          id: { type: 'string' },
          problem: { type: 'boolean' },
          reason: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

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
  t: ExpectConsumerTask,
): Promise<unknown> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'binding', 'item', 'input', 'data'],
    properties: {
      version: { const: 2 },
      binding: { type: 'object' },
      item: { type: 'string' },
      input: { type: 'string' },
      data: t.kind === 'batch' ? BATCH_ANSWER_SCHEMA : LINT_ANSWER_SCHEMA,
    },
  };
  const result = await input.runner.headless({
    cwd: root,
    context: { purpose: 'expect-helper' },
    model: (await resolveProjectModel(root, 'judge', input.def.models.judge, 'plan-review.judge'))
      .model,
    addDirs: [],
    systemPrompt: input.systemPrompt,
    tools: JUDGE_TOOLS,
    allowedTools: JUDGE_TOOLS,
    prompt: `${t.text}\nФайл ответа не пиши: верни ответ единственным JSON-объектом без пояснений, строго по схеме: ${JSON.stringify(schema)}`,
    schema,
    persist: false,
    maxTurns: 30,
  });
  if (result.structured === undefined) throw new Error(`${t.task}: судья не вернул ответ`);
  return result.structured;
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
  const abs = confinedProjectPath(root, file);
  const before = await readFile(abs, 'utf8');
  const args = { root, now: new Date(), params: { file } };
  const rejected: string[] = [];
  if ((await quiet(() => runExpect('judge', args))) !== 0) {
    try {
      const consumer = await expectPlanConsumer(root, file, args.now);
      for (const task of consumer.tasks)
        await consumer.produce(task.task, () => answerTask(input, root, task));
      await quiet(() => consumer.apply());
    } catch (error) {
      rejected.push(errorMessage(error));
    } finally {
      if ((await readFile(abs, 'utf8')) !== before) {
        await writeFile(abs, before, 'utf8');
        rejected.push('судья изменил файл ожиданий — правка отменена');
      }
    }
  }
  const summary = await expectSummary(root, file);
  const state = await readPlanState(s);
  const record: ReviewRecord = {
    round: state.round + 1,
    pass: !summary.blocked && rejected.length === 0,
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
