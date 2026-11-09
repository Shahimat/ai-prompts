import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactPath, expectCacheFile, expectHelperDir, expectHelperPath } from '#lib/artifacts';
import { beginProofRun } from '#lib/proof/transport';
import { expectPlanConsumer, runExpect } from '#commands/expect/index';
import { main } from '@shahimat/cli';
import { isRecord } from '#shared/guards';
import {
  isBoundPlan,
  answerEnvelope,
  prepareBoundPlan,
  semanticGeneration,
} from '#lib/expect/bundle';
import { implementationBinding, implementationSource, producerContext } from '#lib/expect/proof';
import { shaOf } from '#lib/expect/evidence';
import { canonicalDigest, criterionInventory } from '#lib/expect/inventory';
import { isTitlePlan } from '#lib/expect/title-proof';

const counters = vi.hoisted(() => ({ fake: 0, real: 0, scenarios: 0 }));
vi.mock('#lib/expect/proof', async (importOriginal) => {
  const original = await importOriginal<typeof import('#lib/expect/proof')>();
  return {
    ...original,
    producerContext: async () => ({
      adapter: 'controlled-fake-title-only',
      complete: true,
      instructions: [{ name: 'system', text: 'immutable task only; no tools' }],
      contract: 'explicit unary/pair coverage',
      diagnostics: [],
    }),
  };
});
vi.mock('#lib/role', async (importOriginal) => {
  const original = await importOriginal<typeof import('#lib/role')>();
  return {
    ...original,
    askRole: async (_root: string, _role: string, text: string) => {
      counters.fake++;
      const start = text.indexOf('\n{\n');
      const end = text.indexOf('\nОтвет только');
      const plan: unknown = JSON.parse(text.slice(start, end));
      const line = text
        .slice(end)
        .split('\n')
        .find((line) => line.startsWith('{"version":2'));
      if (!isRecord(plan) || !Array.isArray(plan['checks']) || line === undefined)
        throw new Error('bad fake request');
      const envelope: unknown = JSON.parse(line);
      if (!isRecord(envelope)) throw new Error('bad fake envelope');
      return {
        data: {
          ...envelope,
          data: {
            evaluated: plan['checks'].map((check) => {
              if (!isRecord(check)) throw new Error('bad fake check');
              return {
                id: check['id'],
                problem: false,
                reason: 'controlled explicit negative evaluation',
              };
            }),
          },
        },
      };
    },
  };
});

const project = path.resolve(import.meta.dirname, '..', '..', '..');
const entry = 'sample.expect.ts';
const now = new Date('2026-11-08');
const source = (title = 'first', body = '1') =>
  `import {it,expect} from 'vitest';\nit('${title}',()=>expect(${body}).toBe(${body}));\nit('second',()=>expect(2).toBe(2));\nit('third',()=>expect(3).toBe(3));\n`;
let root: string;
const out: string[] = [];
beforeEach(async () => {
  const directory = artifactPath(project, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: 'fixtures',
  });
  await mkdir(directory, { recursive: true });
  root = await mkdtemp(path.join(directory, 'title-cli-'));
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(root, entry), source());
  out.length = 0;
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '));
  });
});
afterEach(async () => {
  counters.scenarios++;
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
afterAll(async () => {
  const file = artifactPath(project, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: `checks/title-cli-counters-b-${randomUUID()}.json`,
  });
  await writeFile(file, JSON.stringify(counters, null, 2));
  console.log(file);
});

describe('controlled explicit producer and query conformance', () => {
  it.each(['before', 'during'])(
    'default-only consumer captures immutable batch evidence %s producer dispatch',
    async (phase) => {
      const ref = 'evidence.md';
      const evidence = 'synthetic immutable evidence';
      await writeFile(path.join(root, ref), evidence);
      const criterion = criterionInventory(root, entry).criteria.find(
        (item) => item.intent.join(' ') === 'first',
      );
      const binding = implementationBinding(
        criterion,
        'first',
        [{ ref, sha: shaOf(evidence) }],
        await producerContext(root),
      );
      expect(binding.complete).toBe(true);
      const task = {
        task: `${expectHelperDir(entry)}/tasks/evidence.md`,
        answer: `${expectHelperDir(entry)}/tasks/evidence.answer.json`,
        items: [
          {
            id: 'synthetic-evidence-item',
            question: 'first',
            evidence: [{ ref, sha: shaOf(evidence), bytes: Buffer.byteLength(evidence) }],
            binding,
            source: implementationSource(criterion),
          },
        ],
      };
      const payload = {
        execution: { run: randomUUID(), force: false, allowJudge: false },
        batches: [task],
        lint: [],
        tasks: { [task.task]: 'synthetic immutable evidence request' },
      };
      const bound = await prepareBoundPlan(root, entry, payload, () =>
        semanticGeneration(root, entry, [ref]),
      );
      const text = `${payload.tasks[task.task]}\nОтвет только в конверте v2 (data — результат задания):\n${JSON.stringify(answerEnvelope(bound, task.task, canonicalDigest(task), '<ответ согласно заданию>'))}\n`;
      await mkdir(path.dirname(expectHelperPath(root, entry, task.task)), { recursive: true });
      await writeFile(expectHelperPath(root, entry, task.task), text);
      await writeFile(
        expectHelperPath(root, entry, `${expectHelperDir(entry)}/plan.json`),
        JSON.stringify({ ...payload, bound }),
      );
      const consumer = await expectPlanConsumer(root, entry, now);
      if (phase === 'before') await writeFile(path.join(root, ref), 'changed evidence');
      const producer = vi.fn<() => Promise<unknown>>(async () => {
        await writeFile(path.join(root, ref), 'changed evidence');
        return answerEnvelope(bound, task.task, canonicalDigest(task), []);
      });
      await expect(consumer.produce(task.task, producer)).rejects.toThrow(
        'STALE_EXPECT_GENERATION',
      );
      expect(producer).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
      await expect(consumer.apply()).rejects.toThrow('MISSING_EXPECT_ANSWERS');
      await expect(readFile(path.join(root, expectCacheFile(entry)))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );
  it('semantic coverage and a permissive report budget cannot waive scripted lint guards', async () => {
    const text = `import {budget} from '@shahimat/ai-core/expect';\nbudget({crit:10,warn:10});\n${source('x'.repeat(201))}`;
    await writeFile(path.join(root, entry), text);
    expect(await main(['expect', 'judge', entry, '--run', '--root', root], now)).toBe(0);
    expect(await main(['expect', 'report', entry, '--root', root], now)).toBe(0);
    expect(await main(['expect', 'lint', entry, '--root', root], now)).toBe(1);
    expect(out.join('\n')).toContain('needs-review/failed');
  }, 60000);
  it('manual apply revalidates generation before acceptance and cannot mint a fresh force-run marker', async () => {
    const before = counters.fake;
    const answer = async () => {
      const prepared: unknown = JSON.parse(
        await readFile(path.join(root, expectHelperDir(entry), 'plan.json'), 'utf8'),
      );
      if (
        !isRecord(prepared) ||
        !isBoundPlan(prepared['bound']) ||
        !Array.isArray(prepared['lint'])
      )
        throw new Error('missing bound plan');
      const task: unknown = prepared['lint'][0];
      if (
        !isRecord(task) ||
        typeof task['task'] !== 'string' ||
        typeof task['answer'] !== 'string' ||
        !isTitlePlan(task['review'])
      )
        throw new Error('missing title task');
      const data = {
        evaluated: task['review'].checks.map((check) => ({
          id: check.id,
          problem: false,
          reason: 'controlled manual negative evaluation',
        })),
      };
      await writeFile(
        path.join(root, task['answer']),
        JSON.stringify(
          answerEnvelope(prepared['bound'], task['task'], canonicalDigest(task), data),
        ),
      );
    };
    expect(await main(['expect', 'judge', entry, '--root', root], now)).toBe(1);
    await answer();
    await writeFile(path.join(root, entry), source('first', '4'));
    await expect(
      main(['expect', 'judge', entry, '--apply', '--force', '--root', root], now),
    ).rejects.toThrow('STALE_EXPECT_GENERATION');
    await expect(readFile(path.join(root, expectCacheFile(entry)))).rejects.toThrow();
    expect(await main(['expect', 'judge', entry, '--root', root], now)).toBe(1);
    await answer();
    expect(await main(['expect', 'judge', entry, '--apply', '--force', '--root', root], now)).toBe(
      0,
    );
    expect(await main(['expect', 'report', entry, '--root', root], now)).toBe(0);
    expect(await main(['expect', 'report', entry, '--force', '--root', root], now)).toBe(1);
    expect(counters.fake).toBe(before);
  }, 60000);
  it('cold/warm/force default queries never use producer, even inherited allowJudge=true', async () => {
    const before = counters.fake;
    const run = await beginProofRun(root, {
      owner: 'synthetic',
      scope: ['*'],
      force: true,
      allowJudge: true,
    });
    for (const command of ['report', 'lint', 'judge']) {
      expect(
        await runExpect(command, {
          root,
          now,
          params: { file: entry },
          proofRun: run,
          force: true,
        }),
      ).toBe(1);
    }
    expect(counters.fake).toBe(before);
    await expect(readFile(path.join(root, expectCacheFile(entry)))).rejects.toThrow();
  }, 60000);
  it('explicit fake run evaluates cold misses; body-only stays warm; title edit evaluates only three affected checks', async () => {
    const before = counters.fake;
    expect(await main(['expect', 'judge', entry, '--run', '--root', root], now)).toBe(0);
    expect(counters.fake - before).toBe(1);
    const stored = await readFile(path.join(root, expectCacheFile(entry)), 'utf8');
    expect(await main(['expect', 'report', entry, '--root', root], now)).toBe(0);
    expect(out.join('\n')).toContain('reused 6 · needs-review 0');
    await writeFile(path.join(root, entry), source('first', '4'));
    expect(await main(['expect', 'lint', entry, '--root', root], now)).toBe(0);
    expect(await readFile(path.join(root, expectCacheFile(entry)), 'utf8')).toBe(stored);
    expect(counters.fake - before).toBe(1);
    await writeFile(path.join(root, entry), source('renamed', '4'));
    expect(await main(['expect', 'judge', entry, '--root', root], now)).toBe(1);
    const prepared: unknown = JSON.parse(
      await readFile(path.join(root, expectHelperDir(entry), 'plan.json'), 'utf8'),
    );
    if (!isRecord(prepared) || !Array.isArray(prepared['lint'])) throw new Error('missing plan');
    const task: unknown = prepared['lint'][0];
    const review = isRecord(task) ? task['review'] : undefined;
    expect(isRecord(review) && Array.isArray(review['checks']) ? review['checks'].length : -1).toBe(
      3,
    );
    expect(await main(['expect', 'judge', entry, '--run', '--root', root], now)).toBe(0);
    expect(counters.fake - before).toBe(2);
  }, 60000);
  it('force evaluates once and current matching result is retained while foreign runs bypass it', async () => {
    const before = counters.fake;
    const run = await beginProofRun(root, {
      owner: 'synthetic',
      scope: ['*'],
      force: true,
      allowJudge: true,
    });
    const args = { root, now, params: { file: entry }, proofRun: run, force: true };
    expect(await runExpect('judge', { ...args, run: true })).toBe(0);
    expect(await runExpect('report', args)).toBe(0);
    expect(await runExpect('judge', { ...args, run: true })).toBe(1);
    expect(out.join('\n')).toContain('fresh run required');
    expect(counters.fake - before).toBe(1);
    expect(await main(['expect', 'report', entry, '--force', '--root', root], now)).toBe(1);
    expect(counters.fake - before).toBe(1);
  }, 60000);
  it('unsupported producer flags fail before queries and force never implies run', async () => {
    const before = counters.fake;
    for (const command of ['report', 'lint', 'serve']) {
      await expect(main(['expect', command, entry, '--run', '--root', root], now)).rejects.toThrow(
        '--run/--apply',
      );
    }
    await expect(
      main(['expect', 'judge', entry, '--run', '--apply', '--root', root], now),
    ).rejects.toThrow('exclusive');
    expect(await main(['expect', 'judge', entry, '--force', '--root', root], now)).toBe(1);
    expect(counters.fake).toBe(before);
  }, 60000);
});
