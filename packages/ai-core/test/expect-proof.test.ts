import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { artifactPath, expectHelperDir, expectHelperPath } from '#lib/artifacts';
import {
  criterionInventory,
  reconcileCriterionLineage,
  registrationInput,
  type CriterionInventory,
} from '#lib/expect/inventory';
import { implementationBinding, producerContext, type ProducerContext } from '#lib/expect/proof';
import {
  answerEnvelope,
  applyBoundPlan,
  prepareBoundPlan,
  runBoundProducer,
  semanticGeneration,
  validateAnswerEnvelope,
} from '#lib/expect/bundle';
import {
  findImplementationVerdict,
  loadVerdicts,
  saveVerdicts,
  verdictsPath,
  verdictTrust,
} from '#lib/expect/verdicts';
import { applyAnswers } from '#lib/expect/batch';
import { allAnchors } from '#lib/expect/anchors';
import { schemaErrors } from '#lib/expect/schema';
import { shaOf } from '#lib/expect/evidence';

const launches = vi.hoisted(() => ({ agents: 0 }));
vi.mock('#lib/role', () => ({
  askRole: () => {
    launches.agents++;
    throw new Error('real producer forbidden');
  },
}));
const roots: string[] = [];
const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const counters = {
  realAgentCalls: 0,
  fakeSuccessExecutions: 0,
  successfulRequests: 0,
  fakeFailureExecutions: 0,
};
const entry = 'example.expect.ts';
const producer: ProducerContext = {
  adapter: 'fake-controlled-v2',
  complete: true,
  instructions: [{ name: 'synthetic', text: 'only immutable inputs' }],
  contract: 'no tools, no env, no IO',
  diagnostics: [],
};
const source = `import { describe, it as check, expect } from 'vitest';
import { first as run } from './barrel.js';
function second() { return 2; }
describe('suite', () => {
  check('first', () => expect(run()).toBe(1));
  check('second', () => expect(second()).toBe(2));
});`;

async function put(root: string, file: string, text: string) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}
async function fixture() {
  const directory = artifactPath(projectRoot, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: 'fixtures',
  });
  await mkdir(directory, { recursive: true });
  const root = await mkdtemp(path.join(directory, 'proof-'));
  roots.push(root);
  await put(root, 'package.json', '{"type":"module"}');
  await put(root, entry, source);
  await put(root, 'barrel.ts', "export { first } from './helper.js';");
  await put(
    root,
    'helper.ts',
    'export function first() { return 1; }\nexport function unused() { return 0; }',
  );
  return root;
}
function criterion(inventory: CriterionInventory, title: string) {
  const found = inventory.criteria.find((c) => c.intent.at(-1) === title);
  if (found === undefined) throw new Error(`missing ${title}`);
  return found;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  if (launches.agents !== 0) throw new Error(`unexpected real producer calls: ${launches.agents}`);
});
afterAll(async () => {
  const file = artifactPath(projectRoot, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: `checks/producer-counters-a-${randomUUID()}.json`,
  });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ ...counters, realAgentCalls: launches.agents }, null, 2));
  console.log(`producer counters: ${file}`);
});

describe('criterion parser and portable implementation proofs', () => {
  it('uses alias/reexport symbol closures, not whole-file bodies or sibling ordinals', async () => {
    const root = await fixture();
    const before = criterionInventory(root, entry);
    expect(before.criteria).toHaveLength(2);
    const first = criterion(before, 'first');
    expect(first.diagnostics).toEqual([]);
    expect(first.complete).toBe(true);
    await put(root, entry, source.replace('return 2', 'return 3'));
    const after = criterionInventory(root, entry);
    expect(criterion(after, 'first').input).toBe(first.input);
    expect(criterion(after, 'second').input).not.toBe(criterion(before, 'second').input);
    await put(
      root,
      entry,
      source.replace(
        "check('first'",
        "check('inserted', () => expect(0).toBe(0));\n  check('first'",
      ),
    );
    const inserted = criterionInventory(root, entry);
    expect(criterion(inserted, 'first').identity).toBe(first.identity);
    expect(criterion(inserted, 'first').input).toBe(first.input);
    expect(inserted.membership).not.toBe(before.membership);
    await put(
      root,
      'helper.ts',
      'export function first() { return 1; }\nexport function unused() { return 9; }',
    );
    expect(criterion(criterionInventory(root, entry), 'first').input).toBe(first.input);
    await put(root, 'helper.ts', 'export function first() { return 7; }');
    expect(criterion(criterionInventory(root, entry), 'first').input).not.toBe(first.input);
  });

  it('separates cold-root content portability, body/title and producer instruction authority', async () => {
    const a = await fixture();
    const b = await fixture();
    const one = criterion(criterionInventory(a, entry), 'first');
    const two = criterion(criterionInventory(b, entry), 'first');
    expect(one.input).toBe(two.input);
    const proof = implementationBinding(one, 'suite first', [], producer);
    expect(proof.complete).toBe(true);
    expect(implementationBinding(two, 'suite first', [], producer).input).toBe(proof.input);
    await put(a, entry, source.replace("'first'", "'renamed'"));
    expect(
      implementationBinding(
        criterion(criterionInventory(a, entry), 'renamed'),
        'suite renamed',
        [],
        producer,
      ).input,
    ).not.toBe(proof.input);
    expect(
      implementationBinding(one, 'suite first', [], { ...producer, contract: 'changed' }).input,
    ).not.toBe(proof.input);
    const unknown = await producerContext(a);
    expect(implementationBinding(one, 'suite first', [], unknown).complete).toBe(false);
  });

  it('diagnoses duplicate/table/factory/shared hooks and external IO without promoting hashes to completeness', async () => {
    const root = await fixture();
    await put(
      root,
      entry,
      source.replace(
        "check('first', () => expect(run()).toBe(1));",
        "check('first', () => expect(run()).toBe(1));\ncheck('first', () => expect(run()).toBe(1));",
      ),
    );
    const duplicates = criterionInventory(root, entry).criteria.filter(
      (c) => c.intent.at(-1) === 'first',
    );
    expect(duplicates).toHaveLength(2);
    expect(duplicates.every((c) => c.multiplicity === 2 && !c.complete)).toBe(true);
    await put(
      root,
      entry,
      `import { it, beforeEach } from 'vitest';\nimport { readFileSync } from 'node:fs';\nbeforeEach(() => undefined);\nit.each([1,2])('row %s', () => readFileSync('unknown'));`,
    );
    const table = criterionInventory(root, entry);
    expect(table.criteria).toHaveLength(1);
    expect(table.criteria[0]?.complete).toBe(false);
    expect(table.criteria[0]?.diagnostics.join(' ')).toContain('table');
    expect(table.criteria[0]?.diagnostics.join(' ')).toContain('effects');
    await put(
      root,
      entry,
      "import { it } from 'vitest'; function register(key: string) { it('generated', () => key); } register('one'); register('two');",
    );
    const factory = criterionInventory(root, entry);
    expect(factory.criteria).toHaveLength(1);
    expect(factory.criteria[0]?.complete).toBe(false);
    expect(factory.criteria[0]?.diagnostics.join(' ')).toContain('factory');
  });

  it('binds selected constructor fields and resolution config and detects missing symbols', async () => {
    const root = await fixture();
    await put(
      root,
      entry,
      `import { it } from 'vitest';\nclass Check { key = 'a'; run() { return this.key; } }\nconst check = new Check();\nit('instance', () => check.run());`,
    );
    const first = criterionInventory(root, entry);
    await put(root, entry, (await readFile(path.join(root, entry), 'utf8')).replace("'a'", "'b'"));
    expect(criterionInventory(root, entry).criteria[0]?.input).not.toBe(first.criteria[0]?.input);
    await put(root, 'tsconfig.json', '{"compilerOptions":{"strict":true}}');
    expect(criterionInventory(root, entry).generation).not.toBe(first.generation);
    await put(root, entry, "import { it } from 'vitest'; it('unknown', () => missing());");
    expect(criterionInventory(root, entry).criteria[0]?.complete).toBe(false);
  });

  it('maps source ranges without sibling ordinals and reconciles only unique lineage matches', async () => {
    const root = await fixture();
    const before = criterionInventory(root, entry);
    const first = criterion(before, 'first');
    expect(registrationInput(before, { file: entry, ...first.location })).toEqual(first);
    await put(root, entry, source.replace("'first'", "'renamed'"));
    const cold = criterionInventory(root, entry);
    const renamed = criterion(reconcileCriterionLineage(before, cold), 'renamed');
    expect(renamed.lineage).toBe(first.lineage);
    expect(renamed.input).not.toBe(first.input);
    expect(criterion(cold, 'renamed').identity).toBe(renamed.identity);
    await put(
      root,
      entry,
      "import { it } from 'vitest'; let shared = 0; it('mutator', () => shared++); it('consumer', () => shared);",
    );
    expect(criterionInventory(root, entry).criteria.every((c) => !c.complete)).toBe(true);
  });

  it('resolves static namespace members and fails closed on conflicting runtime targets and aliases', async () => {
    const root = await fixture();
    await put(
      root,
      entry,
      "import { it } from 'vitest'; import * as Checks from './helper.js'; it('namespace', () => Checks.first());",
    );
    const before = criterionInventory(root, entry);
    expect(before.criteria[0]?.complete).toBe(true);
    await put(root, 'helper.js', 'export function first() { return 99; }');
    const ambiguous = criterionInventory(root, entry);
    expect(ambiguous.criteria[0]?.complete).toBe(false);
    expect(ambiguous.criteria[0]?.diagnostics.join(' ')).toContain('runtime resolution');
    await put(root, 'tsconfig.json', '{"compilerOptions":{"paths":{"#selected":["./helper.ts"]}}}');
    expect(criterionInventory(root, entry).criteria[0]?.complete).toBe(false);
  });

  it('isolates independent static Check methods without ignoring class initialization effects', async () => {
    const root = await fixture();
    const methods =
      "import { it } from 'vitest'; class Check { static first() { return 1; } static second() { return 2; } } it('first', Check.first); it('second', Check.second);";
    await put(root, entry, methods);
    const before = criterionInventory(root, entry);
    expect(criterion(before, 'first').complete).toBe(true);
    expect(criterion(before, 'second').complete).toBe(true);
    await put(root, entry, methods.replace('return 2', 'return 3'));
    const after = criterionInventory(root, entry);
    expect(criterion(after, 'first').input).toBe(criterion(before, 'first').input);
    expect(criterion(after, 'second').input).not.toBe(criterion(before, 'second').input);
    await put(
      root,
      entry,
      methods.replace('class Check {', 'class Check { static state = unknown();'),
    );
    expect(criterionInventory(root, entry).criteria.every((criterion) => !criterion.complete)).toBe(
      true,
    );
  });
});

describe('immutable generation-bound prepare/apply', () => {
  it('executes exactly one controlled fake producer and reuses content proof across root/lineage without trusting legacy', async () => {
    const root = await fixture();
    const foreign = await fixture();
    vi.stubEnv('HARNESS_EXPECT_ROOT', root);
    vi.stubEnv('HARNESS_EXPECT_ENTRY', entry);
    const text = 'synthetic immutable quotation';
    await put(root, 'evidence.md', text);
    const selected = criterion(criterionInventory(root, entry), 'first');
    const binding = implementationBinding(
      selected,
      'suite first',
      [{ ref: 'evidence.md', sha: shaOf(text) }],
      producer,
    );
    const item = {
      id: 'first',
      question: 'suite first',
      evidence: [{ ref: 'evidence.md', sha: shaOf(text), bytes: text.length }],
      binding,
    };
    const capture = () => semanticGeneration(root, entry, ['evidence.md'], producer);
    const plan = await prepareBoundPlan(root, entry, { items: [item] }, capture);
    let fakeCalls = 0;
    const produce = async () => {
      fakeCalls++;
      counters.fakeSuccessExecutions++;
      return answerEnvelope(plan, item.id, binding.input, [
        { id: item.id, verdict: true, ref: 'evidence.md', quote: text, reason: 'synthetic' },
      ]);
    };
    const request = () => {
      counters.successfulRequests++;
      return runBoundProducer(root, entry, plan, item.id, binding.input, capture, produce);
    };
    const answers = await Promise.all([request(), request()]);
    const answer = answers[0];
    expect(answers[1]).toEqual(answer);
    expect(await request()).toEqual(answer);
    await applyBoundPlan(
      root,
      entry,
      plan,
      capture,
      async () => {
        const data = validateAnswerEnvelope(plan, item.id, binding.input, answer);
        const result = applyAnswers(
          [item],
          data,
          new Map([['evidence.md', text]]),
          new Date('2026-11-08'),
        );
        expect(result.rejected).toEqual([]);
        return { verdicts: result.accepted, lint: {} };
      },
      saveVerdicts,
    );
    const store = await loadVerdicts();
    const trusted = store.verdicts[item.id];
    if (trusted === undefined) throw new Error('missing proof');
    expect(
      findImplementationVerdict(
        { ...store, verdicts: { changed: { ...trusted, verdict: false } } },
        binding,
      ),
    ).toBeUndefined();
    const portable = implementationBinding(
      {
        ...criterion(criterionInventory(foreign, entry), 'first'),
        lineage: 'different local history',
      },
      'suite first',
      item.evidence,
      producer,
    );
    expect(findImplementationVerdict(store, portable)?.verdict).toBe(true);
    await put(root, entry, source.replace('return 2', 'return 99'));
    const unchanged = implementationBinding(
      criterion(criterionInventory(root, entry), 'first'),
      'suite first',
      item.evidence,
      producer,
    );
    expect(findImplementationVerdict(store, unchanged)?.verdict).toBe(true);
    expect(fakeCalls).toBe(1);
    expect(launches.agents).toBe(0);
    await saveVerdicts({ verdicts: { changed: { ...trusted, verdict: false } }, lint: {} });
    await expect(loadVerdicts()).rejects.toThrow('неверная форма');
  });

  it('snapshots every ref and rejects body/title/helper/membership/instruction/evidence changes before quote validation', async () => {
    const root = await fixture();
    vi.stubEnv('HARNESS_EXPECT_ROOT', root);
    await put(root, 'evidence.md', '# Section\nunchanged valid quotation text\n');
    let context = producer;
    const capture = () => semanticGeneration(root, entry, ['evidence.md'], context);
    const plan = await prepareBoundPlan(root, entry, { items: ['one'] }, capture);
    expect(plan.generation.evidence[0]?.text).toContain('unchanged valid');
    let quoteChecks = 0;
    let commits = 0;
    const apply = () =>
      applyBoundPlan(
        root,
        entry,
        plan,
        capture,
        async () => {
          quoteChecks++;
          return true;
        },
        async () => {
          commits++;
        },
      );
    for (const [file, content] of [
      [entry, source.replace('return 2', 'return 8')],
      [entry, source.replace("'first'", "'new title'")],
      ['helper.ts', 'export function first() { return 9; }'],
      [entry, `${source}\ncheck('new', () => undefined);`],
      ['evidence.md', '# Section\nunchanged valid quotation text\nnew content'],
    ]) {
      if (file === undefined || content === undefined) throw new Error('fixture');
      const old = await readFile(path.join(root, file), 'utf8');
      await put(root, file, content);
      await expect(apply()).rejects.toThrow('STALE_EXPECT_GENERATION');
      await put(root, file, old);
    }
    context = { ...producer, instructions: [{ name: 'synthetic', text: 'changed' }] };
    await expect(apply()).rejects.toThrow('STALE_EXPECT_GENERATION');
    expect(quoteChecks).toBe(0);
    expect(commits).toBe(0);
    context = producer;
    await apply();
    expect(commits).toBe(1);
    await expect(apply()).rejects.toThrow('FOREIGN_EXPECT_PLAN');
  });

  it('rejects foreign roots/entries, superseded prepares, bare answers and duplicate/missing/foreign items', async () => {
    const root = await fixture();
    const foreign = await fixture();
    vi.stubEnv('HARNESS_EXPECT_ROOT', root);
    const capture = () => semanticGeneration(root, entry, [], producer);
    const plan = await prepareBoundPlan(root, entry, {}, capture);
    const envelope = answerEnvelope(plan, 'one', 'input', { ok: true });
    expect(validateAnswerEnvelope(plan, 'one', 'input', envelope)).toEqual({ ok: true });
    for (const answer of [
      { ok: true },
      { ...envelope, input: 'foreign' },
      { ...envelope, binding: { ...plan.binding, entry: 'foreign.expect.ts' } },
    ])
      expect(() => validateAnswerEnvelope(plan, 'one', 'input', answer)).toThrow();
    await expect(
      applyBoundPlan(
        foreign,
        entry,
        plan,
        capture,
        async () => undefined,
        async () => undefined,
      ),
    ).rejects.toThrow('FOREIGN_EXPECT_PLAN');
    await prepareBoundPlan(root, entry, {}, capture);
    await expect(
      applyBoundPlan(
        root,
        entry,
        plan,
        capture,
        async () => undefined,
        async () => undefined,
      ),
    ).rejects.toThrow('FOREIGN_EXPECT_PLAN');
    const item = { id: 'one', question: 'q', evidence: [{ ref: 'file', sha: 's', bytes: 10 }] };
    const answer = { id: 'one', verdict: true, ref: 'file', quote: 'valid quotation', reason: '' };
    for (const answers of [[], [answer, answer], [{ ...answer, id: 'foreign' }]]) {
      const result = applyAnswers(
        [item],
        answers,
        new Map([['file', 'valid quotation']]),
        new Date(),
      );
      expect(result.accepted).toEqual({});
      expect(result.rejected.length).toBeGreaterThan(0);
    }
  });

  it('fails closed for unknown producer and concurrent prepare, preserves immutable bundles', async () => {
    const root = await fixture();
    const capture = () => semanticGeneration(root, entry, []);
    const plan = await prepareBoundPlan(root, entry, {}, capture);
    let checks = 0;
    await expect(
      applyBoundPlan(
        root,
        entry,
        plan,
        capture,
        async () => {
          checks++;
        },
        async () => undefined,
      ),
    ).rejects.toThrow('INCOMPLETE_EXPECT_PRODUCER');
    expect(checks).toBe(0);
    const attempts = await Promise.allSettled([
      prepareBoundPlan(root, entry, {}, capture),
      prepareBoundPlan(root, entry, {}, capture),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const saved: unknown = JSON.parse(
      await readFile(
        expectHelperPath(
          root,
          entry,
          `${expectHelperDir(entry)}/generations/${plan.binding.plan}/bundle.json`,
        ),
        'utf8',
      ),
    );
    expect(saved).toEqual(plan);
    const controlled = () => semanticGeneration(root, entry, [], producer);
    const failed = await prepareBoundPlan(root, entry, {}, controlled);
    let calls = 0;
    const fail = async () => {
      calls++;
      counters.fakeFailureExecutions++;
      throw new Error('synthetic failure');
    };
    await expect(
      runBoundProducer(root, entry, failed, 'one', 'input', controlled, fail),
    ).rejects.toThrow('synthetic failure');
    await expect(
      runBoundProducer(root, entry, failed, 'one', 'input', controlled, fail),
    ).rejects.toThrow('EXPECT_PRODUCER_NEW_RUN_REQUIRED');
    expect(calls).toBe(1);
  });

  it('rejects mutation during validation, corrupt immutable bytes and prepare races during fake production', async () => {
    const root = await fixture();
    const capture = () => semanticGeneration(root, entry, [], producer);
    const plan = await prepareBoundPlan(root, entry, {}, capture);
    let commits = 0;
    await expect(
      applyBoundPlan(
        root,
        entry,
        plan,
        capture,
        async () => {
          await put(root, 'helper.ts', 'export function first() { return 44; }');
        },
        async () => {
          commits++;
        },
      ),
    ).rejects.toThrow('STALE_EXPECT_GENERATION');
    expect(commits).toBe(0);
    const next = await prepareBoundPlan(root, entry, {}, capture);
    await expect(
      runBoundProducer(root, entry, next, 'one', 'input', capture, async () => {
        await prepareBoundPlan(root, entry, {}, capture);
        return answerEnvelope(next, 'one', 'input', []);
      }),
    ).rejects.toThrow('FOREIGN_EXPECT_PLAN');
    const corrupt = await prepareBoundPlan(root, entry, {}, capture);
    await put(
      root,
      `${expectHelperDir(entry)}/generations/${corrupt.binding.plan}/bundle.json`,
      '{}',
    );
    await expect(
      applyBoundPlan(
        root,
        entry,
        corrupt,
        capture,
        async () => undefined,
        async () => {
          commits++;
        },
      ),
    ).rejects.toThrow('CORRUPT_EXPECT_BUNDLE');
    expect(commits).toBe(0);
  });
});

describe('legacy retention and fresh reader scopes', () => {
  it('reads legacy quotes/reasons without trusted upgrading or query writes', async () => {
    const root = await fixture();
    vi.stubEnv('HARNESS_EXPECT_ROOT', root);
    vi.stubEnv('HARNESS_EXPECT_ENTRY', entry);
    const legacy = {
      question: 'q',
      evidence: { ref: 's' },
      verdict: true,
      quote: 'old quote',
      ref: 'ref',
      reason: 'historical reason',
      at: '2020-01-01',
    };
    await saveVerdicts({ verdicts: { old: legacy }, lint: {} });
    const before = await readFile(path.join(root, verdictsPath()), 'utf8');
    const loaded = await loadVerdicts();
    expect(loaded.verdicts['old']).toEqual(legacy);
    expect(verdictTrust(legacy)).toBe('legacy-unverified');
    expect(await readFile(path.join(root, verdictsPath()), 'utf8')).toBe(before);
  });

  it('does not memoize anchors across roots/generations or schemas across directories/membership', async () => {
    const a = await fixture();
    const b = await fixture();
    vi.stubEnv('HARNESS_EXPECT_ROOT', a);
    await put(a, 'first.md', '<!-- expect:probe -->\nfirst\n<!-- /expect:probe -->');
    expect((await allAnchors()).filter((r) => r.key === 'probe')).toHaveLength(1);
    await put(a, 'second.md', '<!-- expect:probe -->\nsecond\n<!-- /expect:probe -->');
    expect((await allAnchors()).filter((r) => r.key === 'probe')).toHaveLength(2);
    vi.stubEnv('HARNESS_EXPECT_ROOT', b);
    expect((await allAnchors()).filter((r) => r.key === 'probe')).toHaveLength(0);
    await put(b, 'a/value.schema.json', '{"type":"string"}');
    await put(b, 'b/value.schema.json', '{"type":"number"}');
    expect(await schemaErrors([{ name: 'x', data: 'ok' }], 'a/value.schema.json')).toEqual([]);
    expect(
      (await schemaErrors([{ name: 'x', data: 'ok' }], 'b/value.schema.json')).length,
    ).toBeGreaterThan(0);
    await put(b, 'a/value.schema.json', '{"type":"number"}');
    expect(
      (await schemaErrors([{ name: 'x', data: 'ok' }], 'a/value.schema.json')).length,
    ).toBeGreaterThan(0);
    await put(b, 'c/root.schema.json', '{"$ref":"part.schema.json"}');
    await expect(schemaErrors([{ name: 'x', data: 'ok' }], 'c/root.schema.json')).rejects.toThrow();
    await put(b, 'c/part.schema.json', '{"type":"string"}');
    expect(await schemaErrors([{ name: 'x', data: 'ok' }], 'c/root.schema.json')).toEqual([]);
  });

  it('binds selected sections and anchor multiplicity with explicit root, not process-global authority', async () => {
    const a = await fixture();
    const b = await fixture();
    await put(a, 'file.md', '# Selected\nselected quotation\n# Other\nother');
    await put(b, 'file.md', '# Selected\nforeign quotation\n# Other\nother');
    vi.stubEnv('HARNESS_EXPECT_ROOT', b);
    const before = await semanticGeneration(a, entry, ['file.md#Selected'], producer);
    expect(before.evidence[0]?.text).toContain('selected quotation');
    await put(a, 'file.md', '# Selected\nselected quotation\n# Other\nchanged');
    expect(await semanticGeneration(a, entry, ['file.md#Selected'], producer)).toEqual(before);
    await put(a, 'anchor.md', '<!-- expect:probe -->\nfirst\n<!-- /expect:probe -->');
    const anchor = await semanticGeneration(a, entry, ['@probe'], producer);
    await put(a, 'another.md', '<!-- expect:probe -->\nfirst\n<!-- /expect:probe -->');
    expect((await semanticGeneration(a, entry, ['@probe'], producer)).evidence).not.toEqual(
      anchor.evidence,
    );
    await put(
      a,
      `${expectHelperDir(entry)}/copied.md`,
      '<!-- expect:probe -->\nruntime copy\n<!-- /expect:probe -->',
    );
    expect((await allAnchors(a)).filter((r) => r.key === 'probe')).toHaveLength(2);
  });
});
