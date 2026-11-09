import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { acquireLease, publishProjectJson, readJson } from '#lib/local-store';
import { expectHelperDir, expectHelperPath, normalizedProjectPath } from '#lib/artifacts';
import { isRecord } from '#shared/guards';
import { canonicalDigest, criterionInventory } from './inventory.ts';
import {
  checkerGeneration,
  entryLeaseName,
  isProducerContext,
  producerContext,
  type ProducerContext,
} from './proof.ts';
import { readEvidence, shaOf } from './evidence.ts';
import { canonicalJson } from '#lib/proof/inputs';

export interface SemanticGeneration {
  inventory: string;
  membership: string;
  policy: string;
  complete: boolean;
  producer: ProducerContext;
  evidence: { ref: string; text: string; sha: string }[];
}

export interface PlanBinding {
  root: string;
  entry: string;
  run: string;
  plan: string;
  input: string;
  policy: string;
}

export interface BoundPlan {
  version: 2;
  binding: PlanBinding;
  generation: SemanticGeneration;
  payload: unknown;
  digest: string;
}

export async function semanticGeneration(
  root: string,
  entry: string,
  refs: string[],
  controlled?: ProducerContext,
): Promise<SemanticGeneration> {
  const before = criterionInventory(root, entry);
  const producer = controlled ?? (await producerContext(root));
  const evidence = await Promise.all(
    [...new Set(refs)].sort().map(async (ref) => {
      const text = await readEvidence(ref, root);
      return { ref, text, sha: shaOf(text) };
    }),
  );
  const after = criterionInventory(root, entry);
  if (before.generation !== after.generation) throw new Error('STALE_EXPECT_GENERATION');
  const checker = checkerGeneration();
  return {
    inventory: after.generation,
    membership: after.membership,
    policy: canonicalDigest({ schema: 'bound-plan-answer-v2', producer, checker }),
    complete: producer.complete && producer.diagnostics.length === 0 && checker.valid,
    producer,
    evidence,
  };
}

const pointer = (entry: string): string => `${expectHelperDir(entry)}/active-v2.json`;
const same = (a: unknown, b: unknown): boolean => canonicalDigest(a) === canonicalDigest(b);

export async function prepareBoundPlan(
  root: string,
  entryPath: string,
  payload: unknown,
  capture: () => Promise<SemanticGeneration>,
): Promise<BoundPlan> {
  const entry = normalizedProjectPath(entryPath);
  const lease = await acquireLease(root, entryLeaseName(entry), 'expect-prepare');
  try {
    const immutablePayload: unknown = JSON.parse(canonicalJson(payload));
    const captured = await capture();
    const generation = {
      ...captured,
      evidence: captured.evidence.map((evidence) => ({ ...evidence })),
      producer: {
        ...captured.producer,
        instructions: captured.producer.instructions.map((instruction) => ({ ...instruction })),
        diagnostics: [...captured.producer.diagnostics],
      },
    };
    const binding: PlanBinding = {
      root: canonicalDigest(await realpath(root)),
      entry,
      run: randomUUID(),
      plan: randomUUID(),
      input: canonicalDigest({ generation, payload: immutablePayload }),
      policy: generation.policy,
    };
    const body = { version: 2, binding, generation, payload: immutablePayload };
    const plan: BoundPlan = { ...body, version: 2, digest: canonicalDigest(body) };
    if (!same(generation, await capture())) throw new Error('STALE_EXPECT_GENERATION');
    await publishProjectJson(
      root,
      `${expectHelperDir(entry)}/generations/${binding.plan}/bundle.json`,
      plan,
    );
    await publishProjectJson(
      root,
      pointer(entry),
      { plan: binding.plan, digest: plan.digest },
      false,
    );
    return plan;
  } finally {
    await lease.release();
  }
}

export function isBoundPlan(value: unknown): value is BoundPlan {
  if (
    !isRecord(value) ||
    value['version'] !== 2 ||
    !isRecord(value['binding']) ||
    !isRecord(value['generation']) ||
    typeof value['digest'] !== 'string'
  )
    return false;
  const binding = value['binding'];
  const generation = value['generation'];
  if (
    !['root', 'entry', 'run', 'plan', 'input', 'policy'].every(
      (key) => typeof binding[key] === 'string',
    ) ||
    !['inventory', 'membership', 'policy'].every((key) => typeof generation[key] === 'string') ||
    typeof generation['complete'] !== 'boolean' ||
    !isProducerContext(generation['producer']) ||
    !Array.isArray(generation['evidence']) ||
    !generation['evidence'].every(
      (e) =>
        isRecord(e) &&
        typeof e['ref'] === 'string' &&
        typeof e['sha'] === 'string' &&
        typeof e['text'] === 'string' &&
        shaOf(e['text']) === e['sha'],
    )
  )
    return false;
  const { digest, ...body } = value;
  return (
    digest === canonicalDigest(body) &&
    binding['policy'] === generation['policy'] &&
    binding['input'] === canonicalDigest({ generation, payload: value['payload'] })
  );
}

export function answerEnvelope(plan: BoundPlan, item: string, input: string, data: unknown) {
  return { version: 2, binding: plan.binding, item, input, data };
}

export function validateAnswerEnvelope(
  plan: BoundPlan,
  item: string,
  input: string,
  answer: unknown,
): unknown {
  if (
    !isRecord(answer) ||
    answer['version'] !== 2 ||
    !same(answer['binding'], plan.binding) ||
    answer['item'] !== item ||
    answer['input'] !== input ||
    !Object.hasOwn(answer, 'data')
  )
    throw new Error('FOREIGN_EXPECT_ANSWER');
  return answer['data'];
}

export async function currentBoundPlan(
  root: string,
  entry: string,
  plan: BoundPlan,
  capture: () => Promise<SemanticGeneration>,
): Promise<SemanticGeneration> {
  const active = await readJson(expectHelperPath(root, entry, pointer(entry)));
  if (
    !isBoundPlan(plan) ||
    !isRecord(active) ||
    active['applied'] === true ||
    active['plan'] !== plan.binding.plan ||
    active['digest'] !== plan.digest ||
    plan.binding.root !== canonicalDigest(await realpath(root)) ||
    plan.binding.entry !== entry
  )
    throw new Error('FOREIGN_EXPECT_PLAN');
  const stored = await readJson(
    expectHelperPath(
      root,
      entry,
      `${expectHelperDir(entry)}/generations/${plan.binding.plan}/bundle.json`,
    ),
  );
  if (!same(stored, plan)) throw new Error('CORRUPT_EXPECT_BUNDLE');
  const current = await capture();
  if (!same(current, plan.generation)) throw new Error('STALE_EXPECT_GENERATION');
  const after = await readJson(expectHelperPath(root, entry, pointer(entry)));
  if (!isRecord(after) || !same(active, after)) throw new Error('FOREIGN_EXPECT_PLAN');
  if (!current.complete) throw new Error('INCOMPLETE_EXPECT_PRODUCER: needs-review');
  return current;
}

export async function runBoundProducer(
  root: string,
  entryPath: string,
  plan: BoundPlan,
  item: string,
  input: string,
  capture: () => Promise<SemanticGeneration>,
  produce: (request: unknown) => Promise<unknown>,
): Promise<unknown> {
  const entry = normalizedProjectPath(entryPath);
  const inspect = async () => {
    const lease = await acquireLease(root, entryLeaseName(entry), 'expect-run');
    try {
      await currentBoundPlan(root, entry, plan, capture);
    } finally {
      await lease.release();
    }
  };
  const key = canonicalDigest({ root: await realpath(root), plan: plan.digest, item, input });
  let execution = productions.get(key);
  if (execution === undefined) {
    execution = produceOnce(root, entry, plan, item, input, inspect, produce);
    productions.set(key, execution);
    void execution
      .finally(() => {
        productions.delete(key);
      })
      .catch(() => undefined);
  }
  const answer: unknown = JSON.parse(await execution);
  await currentBoundPlan(root, entry, plan, capture);
  return answer;
}

const productions = new Map<string, Promise<string>>();

async function produceOnce(
  root: string,
  entry: string,
  plan: BoundPlan,
  item: string,
  input: string,
  inspect: () => Promise<void>,
  produce: (request: unknown) => Promise<unknown>,
): Promise<string> {
  const node = canonicalDigest({ item, input });
  const base = `${expectHelperDir(entry)}/generations/${plan.binding.plan}/production/${node}`;
  const lease = await acquireLease(
    root,
    `${entryLeaseName(entry)}-producer-${canonicalDigest({ node, run: plan.binding.run })}`,
    'expect-producer',
  );
  try {
    await inspect();
    const previous = await readJson(expectHelperPath(root, entry, `${base}.json`));
    if (previous !== undefined) {
      if (
        !isRecord(previous) ||
        previous['status'] !== 'answered' ||
        previous['integrity'] !== canonicalDigest(previous['answer'])
      )
        throw new Error('EXPECT_PRODUCER_NEW_RUN_REQUIRED');
      validateAnswerEnvelope(plan, item, input, previous['answer']);
      return canonicalJson(previous['answer']);
    }
    if ((await readJson(expectHelperPath(root, entry, `${base}.started.json`))) !== undefined)
      throw new Error('EXPECT_PRODUCER_NEW_RUN_REQUIRED');
    await publishProjectJson(root, `${base}.started.json`, { binding: plan.binding, item, input });
    try {
      const request: unknown = JSON.parse(
        canonicalJson({
          binding: plan.binding,
          item,
          input,
          payload: plan.payload,
          generation: plan.generation,
        }),
      );
      const answer = await produce(request);
      await inspect();
      validateAnswerEnvelope(plan, item, input, answer);
      const encoded = canonicalJson(answer);
      await publishProjectJson(root, `${base}.json`, {
        status: 'answered',
        answer,
        integrity: canonicalDigest(answer),
      });
      return encoded;
    } catch (error) {
      await publishProjectJson(root, `${base}.json`, { status: 'failed' });
      throw error;
    }
  } finally {
    await lease.release();
  }
}

export async function applyBoundPlan<T>(
  root: string,
  entryPath: string,
  plan: BoundPlan,
  capture: () => Promise<SemanticGeneration>,
  validate: () => Promise<T>,
  commit: (validated: T) => Promise<void>,
): Promise<void> {
  const entry = normalizedProjectPath(entryPath);
  const lease = await acquireLease(root, entryLeaseName(entry), 'expect-apply');
  try {
    const current = await currentBoundPlan(root, entry, plan, capture);
    const validated = await validate();
    if (!same(await capture(), current)) throw new Error('STALE_EXPECT_GENERATION');
    await commit(validated);
    await publishProjectJson(
      root,
      pointer(entry),
      { plan: plan.binding.plan, digest: plan.digest, applied: true },
      false,
    );
  } finally {
    await lease.release();
  }
}
