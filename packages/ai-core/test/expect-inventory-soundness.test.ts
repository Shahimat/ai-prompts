import { strictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { artifactPath } from '#lib/artifacts';
import { criterionInventory, registrationInput, type CriterionInput } from '#lib/expect/inventory';
import { implementationBinding, type ProducerContext } from '#lib/expect/proof';
import { findImplementationVerdict, sealVerdict } from '#lib/expect/verdicts';
import { errorMessage } from '#shared/guards';

const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const entry = 'sample.expect.ts';
const roots: string[] = [];
const observations: unknown[] = [];
const agentCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('#lib/role', () => ({
  askRole: () => {
    agentCalls.count++;
    throw new Error('real producer forbidden');
  },
}));
const activity = { fixtureRuns: 0, callbackExecutions: 0, externalModuleRequests: 0 };
const producer: ProducerContext = {
  adapter: 'controlled-synthetic-soundness-v2',
  complete: true,
  instructions: [{ name: 'synthetic', text: 'only immutable declared data' }],
  contract: 'no tools, environment or IO',
  diagnostics: [],
};

type Callback = (context?: unknown) => unknown;
const callable = (value: unknown): value is Callback => typeof value === 'function';
interface Outcome {
  name: string;
  location: string;
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
}

function execute(source: string): Outcome[] {
  activity.fixtureRuns++;
  const tasks: {
    name: string;
    location: string;
    callback: Callback;
    skip: boolean;
    only: boolean;
  }[] = [];
  const suites: { name: string; skip: boolean; only: boolean }[] = [];
  let exclusive = false;
  const addTest = (name: string, callback: unknown) => {
    if (!callable(callback)) throw new Error('synthetic callback missing');
    const location = /soundness-fixture\.cjs:\d+:\d+/.exec(new Error().stack ?? '')?.[0] ?? '';
    tasks.push({
      name: [...suites.map((suite) => suite.name), name].join(' > '),
      location,
      callback,
      skip: suites.some((suite) => suite.skip),
      only: suites.some((suite) => suite.only),
    });
  };
  const addSuite = (name: string, callback: unknown, mode: 'normal' | 'skip' | 'only') => {
    if (!callable(callback)) throw new Error('synthetic suite callback missing');
    exclusive ||= mode === 'only';
    suites.push({ name, skip: mode === 'skip', only: mode === 'only' });
    try {
      callback();
    } finally {
      suites.pop();
    }
  };
  const api = {
    it: addTest,
    describe: Object.assign(
      (name: string, callback: unknown) => addSuite(name, callback, 'normal'),
      {
        skip: (name: string, callback: unknown) => addSuite(name, callback, 'skip'),
        only: (name: string, callback: unknown) => addSuite(name, callback, 'only'),
      },
    ),
    expect: (value: unknown) => ({ toBe: (expected: unknown) => strictEqual(value, expected) }),
  };
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ESNext },
  });
  runInNewContext(
    compiled.outputText,
    {
      exports: {},
      require: (name: string) => {
        if (name !== 'vitest') {
          activity.externalModuleRequests++;
          throw new Error('synthetic external module forbidden');
        }
        return api;
      },
    },
    { filename: 'soundness-fixture.cjs' },
  );
  return tasks.map((task): Outcome => {
    if (task.skip || (exclusive && !task.only))
      return { name: task.name, location: task.location, status: 'skipped' };
    let skipped = false;
    try {
      const callback = task.callback;
      activity.callbackExecutions++;
      callback({
        skip: () => {
          skipped = true;
        },
      });
      return { name: task.name, location: task.location, status: skipped ? 'skipped' : 'passed' };
    } catch (error) {
      return {
        name: task.name,
        location: task.location,
        status: 'failed',
        error: errorMessage(error),
      };
    }
  });
}

async function fixture(source: string) {
  const base = artifactPath(projectRoot, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: 'correction-v2/fixtures',
  });
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'soundness-'));
  roots.push(root);
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(root, entry), source);
  return root;
}

function selected(criteria: CriterionInput[], title: string) {
  const criterion = criteria.find((item) => item.intent.at(-1) === title);
  if (criterion === undefined) throw new Error(`missing synthetic criterion ${title}`);
  return criterion;
}

function reuse(before: CriterionInput, after: CriterionInput) {
  const binding = implementationBinding(before, 'consumer', [], producer);
  const candidate = implementationBinding(after, 'consumer', [], producer);
  const verdict = sealVerdict({
    question: 'consumer',
    evidence: {},
    verdict: true,
    quote: 'synthetic before outcome passed',
    ref: 'synthetic',
    reason: 'controlled actual callback observation',
    at: '2026-11-08',
    binding,
  });
  return {
    beforeComplete: before.complete,
    afterComplete: after.complete,
    beforeInput: before.input,
    afterInput: after.input,
    reused:
      findImplementationVerdict({ verdicts: { baseline: verdict }, lint: {} }, candidate) !==
      undefined,
  };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  if (agentCalls.count !== 0 || activity.externalModuleRequests !== 0)
    throw new Error('unexpected external execution');
});
afterAll(async () => {
  const value = process.env['T3A_SOUNDNESS_PHASE'];
  const phase = value === 'red' || value === 'green' ? value : 'test';
  const file = artifactPath(projectRoot, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: `checks/soundness-a-v2-${phase}-${randomUUID()}.json`,
  });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      { phase, observations, actualCallbacks: true, realAgentCalls: agentCalls.count, ...activity },
      null,
      2,
    ),
  );
  console.log(`soundness evidence: ${file}`);
});

describe('T3a completeness review regression boundaries', () => {
  it('A1 rejects reuse when an executed sibling changes the selected static method', async () => {
    const source =
      "import { it, expect } from 'vitest'; class Check { static first() { return 1; } } it('mutator', () => { Check.first = () => 2; }); it('consumer', () => expect(Check.first()).toBe(2));";
    const root = await fixture(source);
    const before = selected(criterionInventory(root, entry).criteria, 'consumer');
    const beforeOutcomes = execute(source);
    const changed = source.replace('Check.first = () => 2', 'Check.first = () => 3');
    await writeFile(path.join(root, entry), changed);
    const after = selected(criterionInventory(root, entry).criteria, 'consumer');
    const afterOutcomes = execute(changed);
    const proof = reuse(before, after);
    observations.push({ case: 'A1', beforeOutcomes, afterOutcomes, proof });
    expect(beforeOutcomes.at(-1)?.status).toBe('passed');
    expect(afterOutcomes.at(-1)?.status).toBe('failed');
    expect(proof.reused).toBe(false);
    expect(after.complete).toBe(false);
    expect(after.input).not.toBe(before.input);
  });

  it('A2 binds expression-suite initialization that changes the actual callback outcome', async () => {
    const source =
      "import { describe, it, expect } from 'vitest'; class Check { static first() { return 1; } } describe('suite', () => (Check.first = () => 2, it('consumer', () => expect(Check.first()).toBe(2))));";
    const root = await fixture(source);
    const before = selected(criterionInventory(root, entry).criteria, 'consumer');
    const changed = source.replace('Check.first = () => 2', 'Check.first = () => 3');
    const beforeOutcomes = execute(source);
    await writeFile(path.join(root, entry), changed);
    const after = selected(criterionInventory(root, entry).criteria, 'consumer');
    const afterOutcomes = execute(changed);
    const proof = reuse(before, after);
    observations.push({ case: 'A2-expression', beforeOutcomes, afterOutcomes, proof });
    expect(beforeOutcomes[0]?.status).toBe('passed');
    expect(afterOutcomes[0]?.status).toBe('failed');
    expect(proof.reused).toBe(false);
    expect(after.complete).toBe(false);
    expect(after.input).not.toBe(before.input);
  });

  it('A1 unmodelled reflective sibling effects cannot reuse a consumer proof', async () => {
    const source =
      "import { it, expect } from 'vitest'; class Check { static first() { return 1; } } it('mutator', () => { Reflect.set(Check, 'first', () => 2); }); it('consumer', () => expect(Check.first()).toBe(2));";
    const root = await fixture(source);
    const before = selected(criterionInventory(root, entry).criteria, 'consumer');
    const changed = source.replace('() => 2', '() => 3');
    const beforeOutcomes = execute(source);
    await writeFile(path.join(root, entry), changed);
    const after = selected(criterionInventory(root, entry).criteria, 'consumer');
    const afterOutcomes = execute(changed);
    const proof = reuse(before, after);
    observations.push({ case: 'A1-opaque-call', beforeOutcomes, afterOutcomes, proof });
    expect(beforeOutcomes.at(-1)?.status).toBe('passed');
    expect(afterOutcomes.at(-1)?.status).toBe('failed');
    expect(proof.reused).toBe(false);
    expect(after.complete).toBe(false);
    expect(after.input).not.toBe(before.input);
  });

  it('A2 conditional registration cannot preserve complete membership when a control binding changes', async () => {
    const source =
      "import { describe, it } from 'vitest'; const mode = 'on'; describe('suite', () => mode === 'on' ? it('consumer', () => 1) : undefined);";
    const root = await fixture(source);
    const before = criterionInventory(root, entry);
    const changed = source.replace("mode = 'on'", "mode = 'off'");
    await writeFile(path.join(root, entry), changed);
    const after = criterionInventory(root, entry);
    observations.push({
      case: 'A2-membership',
      beforeOutcomes: execute(source),
      afterOutcomes: execute(changed),
      before,
      after,
    });
    expect(execute(source)).toHaveLength(1);
    expect(execute(changed)).toHaveLength(0);
    expect(before.criteria[0]?.complete).toBe(false);
    expect(after.criteria[0]?.complete).toBe(false);
    expect(after.membership).not.toBe(before.membership);
  });

  it('A2 parent skip and only are registration contracts, not just literal titles', async () => {
    const variants = [];
    for (const modifier of ['', '.skip', '.only']) {
      const source = `import { describe, it } from 'vitest'; describe${modifier}('suite', () => { it('consumer', () => 1); }); it('outside', () => 1);`;
      const root = await fixture(source);
      const inventory = criterionInventory(root, entry);
      variants.push({
        modifier,
        criterion: selected(inventory.criteria, 'consumer'),
        membership: inventory.membership,
        outcomes: execute(source),
      });
    }
    observations.push({ case: 'A2-modifiers', variants });
    expect(variants[0]?.outcomes.map((outcome) => outcome.status)).toEqual(['passed', 'passed']);
    expect(variants[1]?.outcomes.map((outcome) => outcome.status)).toEqual(['skipped', 'passed']);
    expect(variants[2]?.outcomes.map((outcome) => outcome.status)).toEqual(['passed', 'skipped']);
    expect(new Set(variants.map((variant) => variant.criterion.input)).size).toBe(3);
    expect(new Set(variants.map((variant) => variant.membership)).size).toBe(3);
  });

  it('A3 named, alias and method callbacks cannot attest runtime parameters from type signatures', async () => {
    const bodies = [
      "it('raw', (context: {skip: () => void}) => context.skip());",
      "function raw(context: {skip: () => void}) { context.skip(); } it('raw', raw);",
      "const raw = (context: {skip: () => void}) => context.skip(); it('raw', raw);",
      "class Check { static raw(context: {skip: () => void}) { context.skip(); } } it('raw', Check.raw);",
    ];
    const variants = [];
    for (const body of bodies) {
      const source = `import { it } from 'vitest'; ${body}`;
      const root = await fixture(source);
      variants.push({
        criterion: criterionInventory(root, entry).criteria[0],
        outcomes: execute(source),
      });
    }
    observations.push({ case: 'A3-parameters', variants });
    expect(variants.every((variant) => variant.outcomes[0]?.status === 'skipped')).toBe(true);
    expect(variants.map((variant) => variant.criterion?.complete)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('A3 raw callback receivers remain unmodelled through named and method references', async () => {
    const variants = [];
    for (const body of [
      "function raw() { return this; } it('raw', raw);",
      "class Check { static raw() { return this; } } it('raw', Check.raw);",
    ]) {
      const source = `import { it } from 'vitest'; ${body}`;
      const root = await fixture(source);
      variants.push({
        criterion: criterionInventory(root, entry).criteria[0],
        outcomes: execute(source),
      });
    }
    observations.push({ case: 'A3-receiver', variants });
    expect(variants.map((variant) => variant.criterion?.complete)).toEqual([false, false]);
  });

  it('A4 groups repeated arrow/function-expression registration locations without ordinal identities', async () => {
    const variants = [];
    for (const callback of [
      "() => it('generated', () => 1)",
      "function () { it('generated', () => 1); }",
    ]) {
      const source = `import { describe, it } from 'vitest'; const register = ${callback}; describe('one', register); describe('two', register);`;
      const root = await fixture(source);
      const inventory = criterionInventory(root, entry);
      const criterion = selected(inventory.criteria, 'generated');
      const outcomes = execute(source);
      const location = {
        file: entry,
        line: criterion.location.line,
        column: criterion.location.column,
      };
      const mapped = registrationInput(
        inventory,
        location,
        outcomes.map(() => ({ ...location })),
      );
      variants.push({ criterion, outcomes, mapped });
    }
    observations.push({ case: 'A4', variants });
    for (const variant of variants) {
      expect(variant.outcomes.map((outcome) => outcome.name)).toEqual([
        'one > generated',
        'two > generated',
      ]);
      expect(variant.outcomes[0]?.location).not.toBe('');
      expect(variant.outcomes[0]?.location).toBe(variant.outcomes[1]?.location);
      expect(variant.criterion.complete).toBe(false);
      expect(variant.mapped?.complete).toBe(false);
      expect(variant.mapped?.multiplicity).toBe(2);
    }
  });
});
