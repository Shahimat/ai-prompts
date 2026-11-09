import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  artifactPath,
  expectCacheFile,
  expectHelperDir,
  expectHelperPath,
  expectPlanConsumer,
  isRecord,
  runExpect,
  type ExpectConsumerTask,
  type HeadlessResult,
} from '@shahimat/ai-core';
import { createSession, harnessFile } from '#harnesses/core/store/session';
import { parseMachine } from '#harnesses/core/fsm/machine';
import { judge } from '#harnesses/plan-review/review';

const control = vi.hoisted(() => ({ complete: true }));
vi.mock('#expect-proof-fixture', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    producerContext: async (root: string) => {
      const producer = original['producerContext'];
      if (typeof producer !== 'function') throw new Error('missing fixture producer');
      const actual: unknown = await Reflect.apply(producer, undefined, [root]);
      if (!isRecord(actual)) throw new Error('invalid fixture producer');
      return control.complete
        ? {
            ...actual,
            adapter: 'controlled-plan-review-v2-fixture',
            complete: true,
            diagnostics: [],
          }
        : actual;
    },
  };
});

const entry = 'sample.expect.ts';
const now = new Date('2026-11-09');
const source =
  "import {it,expect} from 'vitest'; import {value} from './helper.ts'; it('synthetic criterion',()=>expect(value()).toBe(1));";
let root: string;
beforeEach(async () => {
  vi.stubEnv('OC3_PROOF_TRANSPORT', undefined);
  control.complete = true;
  const parent = artifactPath(path.resolve(import.meta.dirname, '..', '..', '..'), {
    kind: 'run',
    key: 'incremental-verification-final',
    name: 'harness-v2-fixtures',
  });
  await mkdir(parent, { recursive: true });
  root = await mkdtemp(path.join(parent, 'review-'));
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(root, entry), source);
  await writeFile(path.join(root, 'helper.ts'), 'export function value(){return 1;}');
  await writeFile(path.join(root, 'AGENTS.md'), 'synthetic original instructions');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function answerOf(task: ExpectConsumerTask) {
  const end = task.text.indexOf('\nОтвет только');
  const review: unknown = JSON.parse(task.text.slice(task.text.indexOf('\n{\n'), end));
  const line = task.text
    .slice(end)
    .split('\n')
    .find((line) => line.startsWith('{"version":2'));
  if (!isRecord(review) || !Array.isArray(review['checks']) || line === undefined)
    throw new Error('invalid immutable test task');
  const envelope: unknown = JSON.parse(line);
  if (!isRecord(envelope)) throw new Error('invalid immutable test envelope');
  return {
    version: envelope['version'],
    binding: envelope['binding'],
    item: envelope['item'],
    input: envelope['input'],
    data: {
      evaluated: review['checks'].map((check) => {
        if (!isRecord(check) || typeof check['id'] !== 'string')
          throw new Error('invalid test check');
        return {
          id: check['id'],
          problem: false,
          reason: 'controlled explicit negative evaluation',
        };
      }),
    },
  };
}

async function prepare() {
  expect(await runExpect('judge', { root, now, params: { file: entry } })).toBe(1);
  const consumer = await expectPlanConsumer(root, entry, now);
  const task = consumer.tasks[0];
  if (task === undefined) throw new Error('missing title task');
  return { consumer, task };
}

async function noCommit(): Promise<void> {
  await expect(readFile(path.join(root, expectCacheFile(entry)))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  const pointer: unknown = JSON.parse(
    await readFile(
      expectHelperPath(root, entry, `${expectHelperDir(entry)}/active-v2.json`),
      'utf8',
    ),
  );
  if (!isRecord(pointer)) throw new Error('missing active pointer');
  expect(pointer['applied']).not.toBe(true);
}

it('default incomplete production context blocks review before runner or apply and cannot claim clean', async () => {
  control.complete = false;
  const home = path.join(root, 'home');
  const session = await createSession(home, {
    harness: 'plan-review',
    title: 'synthetic',
    request: '',
    project: root,
    initial: 'review',
    now,
  });
  const parsed = parseMachine(
    await readFile(harnessFile(home, 'plan-review', 'harness.yaml'), 'utf8'),
    'synthetic',
  );
  if (parsed.def === undefined) throw new Error('invalid builtin test machine');
  const producer = vi.fn<() => Promise<HeadlessResult>>(async () => ({
    text: '',
    structured: undefined,
    sessionId: undefined,
    costUsd: undefined,
  }));
  const review = await judge(
    { session, def: parsed.def, runner: { headless: producer }, systemPrompt: 'synthetic' },
    entry,
  );
  expect(review.pass).toBe(false);
  expect(review.summary.count.pending).toBeGreaterThan(0);
  expect(review.rejected).toContain('INCOMPLETE_EXPECT_PRODUCER: needs-review');
  expect(producer).toHaveBeenCalledTimes(0);
  await noCommit();
});

it.each([
  ['legacy', 'MISSING_TITLE_COVERAGE'],
  ['missing', 'MISSING_TITLE_COVERAGE'],
  ['duplicate', 'DUPLICATE_OR_FOREIGN_TITLE_ANSWER'],
  ['foreign', 'DUPLICATE_OR_FOREIGN_TITLE_ANSWER'],
  ['blank', 'MISSING_TITLE_REASON'],
])('explicit title coverage rejects %s without any commit', async (variant, error) => {
  const { consumer, task } = await prepare();
  const answer = answerOf(task);
  const first = answer.data.evaluated[0];
  if (first === undefined) throw new Error('missing synthetic check');
  const data =
    variant === 'legacy'
      ? { contradictions: [], unmeasurable: [] }
      : {
          evaluated:
            variant === 'missing'
              ? []
              : variant === 'duplicate'
                ? [{ ...first }, { ...first }]
                : [
                    {
                      ...first,
                      id: variant === 'foreign' ? 'foreign' : first.id,
                      reason: variant === 'blank' ? '   ' : first.reason,
                    },
                  ],
        };
  const producer = vi.fn<() => Promise<unknown>>(async () => ({ ...answer, data }));
  await expect(consumer.produce(task.task, producer)).rejects.toThrow(error);
  expect(producer).toHaveBeenCalledTimes(1);
  await expect(consumer.apply()).rejects.toThrow('MISSING_EXPECT_ANSWERS');
  await noCommit();
});

it.each(['root', 'entry', 'run', 'plan', 'input', 'policy', 'item', 'task-input'])(
  'foreign %s answer cannot reach apply',
  async (field) => {
    const { consumer, task } = await prepare();
    const answer = answerOf(task);
    if (!isRecord(answer['binding'])) throw new Error('missing binding');
    const foreign =
      field === 'item'
        ? { ...answer, item: 'foreign' }
        : field === 'task-input'
          ? { ...answer, input: 'foreign' }
          : { ...answer, binding: { ...answer['binding'], [field]: 'foreign' } };
    const producer = vi.fn<() => Promise<unknown>>(async () => foreign);
    await expect(consumer.produce(task.task, producer)).rejects.toThrow('FOREIGN_EXPECT_ANSWER');
    expect(producer).toHaveBeenCalledTimes(1);
    await expect(consumer.apply()).rejects.toThrow('MISSING_EXPECT_ANSWERS');
    await noCommit();
  },
);

it.each([
  ['source', 'STALE_EXPECT_GENERATION'],
  ['helper', 'STALE_EXPECT_GENERATION'],
  ['instructions', 'STALE_EXPECT_GENERATION'],
  ['payload', 'CORRUPT_EXPECT_PLAN'],
  ['task', 'CORRUPT_EXPECT_TASK'],
  ['bundle', 'CORRUPT_EXPECT_BUNDLE'],
  ['reprepare', 'FOREIGN_EXPECT_PLAN'],
])('prepared consumer rejects %s change before subsequent runner/apply', async (variant, error) => {
  const { consumer, task } = await prepare();
  const planPath = expectHelperPath(root, entry, `${expectHelperDir(entry)}/plan.json`);
  const plan: unknown = JSON.parse(await readFile(planPath, 'utf8'));
  if (!isRecord(plan) || !isRecord(plan['bound']) || !isRecord(plan['bound']['binding']))
    throw new Error('invalid test plan');
  if (variant === 'source')
    await writeFile(path.join(root, entry), `${source}\nexport const changed=1;`);
  if (variant === 'helper')
    await writeFile(path.join(root, 'helper.ts'), 'export function value(){return 2;}');
  if (variant === 'instructions')
    await writeFile(path.join(root, 'AGENTS.md'), 'changed synthetic instructions');
  if (variant === 'payload')
    await writeFile(planPath, JSON.stringify({ ...plan, extra: 'corrupt' }));
  if (variant === 'task')
    await writeFile(expectHelperPath(root, entry, task.task), `${task.text}\ncorrupt`);
  if (variant === 'bundle') {
    const id = plan['bound']['binding']['plan'];
    if (typeof id !== 'string') throw new Error('missing plan identity');
    await writeFile(
      expectHelperPath(root, entry, `${expectHelperDir(entry)}/generations/${id}/bundle.json`),
      '{}',
    );
  }
  const prepared =
    variant === 'reprepare' ? await runExpect('judge', { root, now, params: { file: entry } }) : 1;
  expect(prepared).toBe(1);
  const producer = vi.fn<() => Promise<unknown>>(async () => answerOf(task));
  await expect(consumer.produce(task.task, producer)).rejects.toThrow(error);
  expect(producer).toHaveBeenCalledTimes(0);
  await expect(consumer.apply()).rejects.toThrow('MISSING_EXPECT_ANSWERS');
  await noCommit();
});

it('valid explicit coverage uses the actual default-capture facade and commits only all accepted tasks', async () => {
  const { consumer, task } = await prepare();
  await expect(consumer.apply()).rejects.toThrow('MISSING_EXPECT_ANSWERS');
  await expect(consumer.produce('foreign-task', async () => answerOf(task))).rejects.toThrow(
    'FOREIGN_EXPECT_TASK',
  );
  await consumer.produce(task.task, async () => answerOf(task));
  await consumer.apply();
  const store: unknown = JSON.parse(
    await readFile(path.join(root, expectCacheFile(entry)), 'utf8'),
  );
  if (!isRecord(store) || !isRecord(store['titles'])) throw new Error('missing accepted titles');
  expect(Object.keys(store['titles'])).toHaveLength(1);
  await expect(consumer.apply()).rejects.toThrow('FOREIGN_EXPECT_PLAN');
});
