import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beginProofRun, joinProofRun, proofRunEnvironment } from '#lib/proof/transport';
import { ensureProof, inspectProof } from '#lib/proof/runner';
import { canonicalJson, proofDigest, resolveProofInputs } from '#lib/proof/inputs';
import { proofFile } from '#lib/proof/store';
import type { ProofDeclaration, ProofNode, ProofPolicy } from '#lib/proof/model';

let root: string;
const policy: ProofPolicy = { owner: 'synthetic', scope: ['*'], force: false, allowJudge: false };
let calls = 0;
let declaration: ProofDeclaration;
const node = (
  execute: ProofNode['execute'] = async () => {
    calls++;
    return { status: 'pass', code: 0, diagnostics: [] };
  },
): ProofNode => ({ id: 'synthetic-checker', declaration, execute });

beforeEach(async () => {
  const parent = path.join(import.meta.dirname, '.tmp');
  await mkdir(parent, { recursive: true });
  root = await mkdtemp(path.join(parent, 'proof-'));
  await mkdir(path.join(root, 'fixtures'));
  for (const file of ['input', 'checker', 'dependency', 'config', 'unrelated', 'fixtures/a'])
    await writeFile(path.join(root, file), file);
  calls = 0;
  declaration = {
    cacheability: 'runtime-bound',
    files: ['input', 'dependency', 'config'],
    implementation: ['checker'],
    membership: ['fixtures'],
    complete: true,
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('content proofs and current-run policy', () => {
  it.each([
    'sparse',
    'signed-zero',
    'symbol',
    'accessor',
    'non-enumerable',
    'array-extra',
    'null-prototype',
    'alias',
    'cycle',
    'frozen',
    'proxy',
  ])('rejects actual %s payloads before key lookup or checker execution', async (kind) => {
    let getterCalls = 0;
    let invalid: unknown;
    if (kind === 'sparse') invalid = Array(1);
    else if (kind === 'signed-zero') invalid = -0;
    else if (kind === 'symbol') invalid = { [Symbol('synthetic')]: 'hidden' };
    else if (kind === 'accessor')
      invalid = Object.defineProperty({}, 'payload', {
        enumerable: true,
        configurable: true,
        get: () => {
          getterCalls++;
          return 'hidden';
        },
      });
    else if (kind === 'non-enumerable')
      invalid = Object.defineProperty({}, 'payload', {
        value: 'hidden',
        writable: true,
        configurable: true,
        enumerable: false,
      });
    else if (kind === 'array-extra') invalid = Object.assign([], { payload: 'hidden' });
    else if (kind === 'null-prototype') invalid = Object.create(null);
    else if (kind === 'alias') {
      const shared = { payload: 1 };
      invalid = { first: shared, second: shared };
    } else if (kind === 'cycle') {
      const cyclic: Record<string, unknown> = {};
      cyclic['self'] = cyclic;
      invalid = cyclic;
    } else if (kind === 'proxy')
      invalid = new Proxy(
        {},
        {
          ownKeys: () => {
            getterCalls++;
            return [];
          },
        },
      );
    else invalid = Object.freeze({ payload: 1 });
    declaration = {
      ...declaration,
      config: kind === 'signed-zero' ? 0 : kind === 'sparse' || kind === 'array-extra' ? [] : {},
    };
    const run = await beginProofRun(root, policy);
    expect((await ensureProof(run, node())).status).toBe('pass');
    expect(() => canonicalJson(invalid)).toThrow('PROOF_NON_CANONICAL_INPUT');
    expect(() => proofDigest(invalid)).toThrow('PROOF_NON_CANONICAL_INPUT');
    declaration = { ...declaration, config: invalid };
    await expect(ensureProof(run, node())).rejects.toThrow('PROOF_NON_CANONICAL_INPUT');
    await expect(ensureProof(await beginProofRun(root, policy), node())).rejects.toThrow(
      'PROOF_NON_CANONICAL_INPUT',
    );
    expect(calls).toBe(1);
    expect(getterCalls).toBe(0);
  });
  it('canonical keys sort maps but preserve ordered inputs and runtime compatibility', async () => {
    expect(canonicalJson({ b: 1, a: { z: 2, y: 3 } })).toBe(
      canonicalJson({ a: { y: 3, z: 2 }, b: 1 }),
    );
    expect(proofDigest(['a', 'b'])).not.toBe(proofDigest(['b', 'a']));
    const inputs = await resolveProofInputs(root, declaration);
    expect(inputs.cacheable).toBe(true);
    expect(inputs.manifest.runtime.node).toBe(process.version);
    expect(inputs.manifest.runtime.executable).toMatch(/^[a-f0-9]{64}$/);
  });

  it('config absence, explicit null and unsupported undefined/accessors do not collapse into one reusable input', async () => {
    const absent = await resolveProofInputs(root, declaration);
    const check = async (): Promise<{
      status: 'pass' | 'fail';
      code: number;
      diagnostics: string[];
    }> => {
      calls++;
      const code = Object.hasOwn(declaration, 'config') ? 7 : 0;
      return { status: code === 0 ? 'pass' : 'fail', code, diagnostics: [] };
    };
    const run = await beginProofRun(root, policy);
    expect((await ensureProof(run, node(check))).status).toBe('pass');
    declaration = { ...declaration, config: null };
    expect((await resolveProofInputs(root, declaration)).key).not.toBe(absent.key);
    expect((await ensureProof(run, node(check))).status).toBe('stale');
    expect(calls).toBe(1);
    expect((await ensureProof(await beginProofRun(root, policy), node(check))).status).toBe('fail');
    declaration = { ...declaration, config: undefined };
    await expect(ensureProof(await beginProofRun(root, policy), node(check))).rejects.toThrow(
      'PROOF_NON_CANONICAL_INPUT',
    );
    let getters = 0;
    Object.defineProperty(declaration, 'config', {
      enumerable: true,
      configurable: true,
      get: () => {
        getters++;
        return null;
      },
    });
    await expect(ensureProof(await beginProofRun(root, policy), node(check))).rejects.toThrow(
      'PROOF_NON_CANONICAL_INPUT',
    );
    expect(getters).toBe(0);
    expect(calls).toBe(2);
  });

  it('cold/warm/force use one current result and unrelated changes keep the baseline', async () => {
    expect((await ensureProof(await beginProofRun(root, policy), node())).origin).toBe('executed');
    await writeFile(path.join(root, 'unrelated'), 'changed');
    expect((await ensureProof(await beginProofRun(root, policy), node())).origin).toBe('baseline');
    const forced = await beginProofRun(root, { ...policy, force: true });
    const results = await Promise.all([
      ensureProof(forced, node()),
      ensureProof(forced, node()),
      ensureProof(forced, node()),
    ]);
    expect(results.every((result) => result.status === 'pass')).toBe(true);
    expect(results.filter((result) => result.origin === 'executed')).toHaveLength(1);
    expect(results.filter((result) => result.origin === 'current-run')).toHaveLength(2);
    expect(calls).toBe(2);
    await ensureProof(forced, node());
    expect(calls).toBe(2);
    expect(forced.allowJudge).toBe(false);
  });

  it.each(['incomplete', 'unknown-environment', 'secret-dependent'])(
    '%s cannot reuse current PASS even when the available key is unchanged',
    async (kind) => {
      const name = 'OC3_REVIEW_SYNTHETIC_STATE';
      const previous = process.env[name];
      declaration = {
        ...declaration,
        ...(kind === 'incomplete'
          ? { cacheability: 'run-only', complete: false }
          : kind === 'unknown-environment'
            ? { environment: { [name]: [] } }
            : { secretDependent: true }),
      };
      const check = node(async () => {
        calls++;
        const code = process.env[name] === 'synthetic-pass' ? 0 : 7;
        return { status: code === 0 ? 'pass' : 'fail', code, diagnostics: [] };
      });
      try {
        process.env[name] = 'synthetic-pass';
        const run = await beginProofRun(root, { ...policy, force: true });
        const before = await resolveProofInputs(root, declaration);
        expect(before.currentReusable).toBe(false);
        expect((await ensureProof(run, check)).status).toBe('pass');
        process.env[name] = 'synthetic-fail';
        const after = await resolveProofInputs(root, declaration);
        expect(after.key).toBe(before.key);
        const result = await ensureProof(run, check);
        expect(result.status).toBe('stale');
        expect(result.currentReusable).toBe(false);
        expect(result.code).not.toBe(0);
        expect(result.origin).not.toBe('current-run');
        expect(result.diagnostics).toContain('current compatibility unproven: new run required');
        expect(JSON.stringify(after)).not.toContain('synthetic-fail');
        expect(calls).toBe(1);
        expect((await ensureProof(await beginProofRun(root, policy), check)).status).toBe('fail');
        expect(calls).toBe(2);
      } finally {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      }
    },
  );

  it('incomplete in-flight execution runs once but does not confer a current-run PASS on waiters', async () => {
    declaration = { ...declaration, cacheability: 'run-only', complete: false };
    const run = await beginProofRun(root, policy);
    const results = await Promise.all([ensureProof(run, node()), ensureProof(run, node())]);
    expect(results.filter((result) => result.status === 'pass')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'stale')).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it('complete run-only policy permits current force dedup but not cross-run baseline reuse', async () => {
    declaration = { ...declaration, cacheability: 'run-only' };
    const inputs = await resolveProofInputs(root, declaration);
    expect(inputs.currentReusable).toBe(true);
    expect(inputs.cacheable).toBe(false);
    const run = await beginProofRun(root, { ...policy, force: true });
    expect((await ensureProof(run, node())).status).toBe('pass');
    expect((await ensureProof(run, node())).origin).toBe('current-run');
    expect(calls).toBe(1);
    expect((await ensureProof(await beginProofRun(root, policy), node())).origin).toBe('executed');
    expect(calls).toBe(2);
  });

  it('changed declared compatibility makes a sound current receipt stale rather than executing again', async () => {
    declaration = { ...declaration, environment: { OC3_REVIEW_SYNTHETIC_MODE: ['one', 'two'] } };
    const previous = process.env['OC3_REVIEW_SYNTHETIC_MODE'];
    try {
      process.env['OC3_REVIEW_SYNTHETIC_MODE'] = 'one';
      const run = await beginProofRun(root, policy);
      expect((await ensureProof(run, node())).status).toBe('pass');
      process.env['OC3_REVIEW_SYNTHETIC_MODE'] = 'two';
      expect((await ensureProof(run, node())).status).toBe('stale');
      expect(calls).toBe(1);
    } finally {
      if (previous === undefined) delete process.env['OC3_REVIEW_SYNTHETIC_MODE'];
      else process.env['OC3_REVIEW_SYNTHETIC_MODE'] = previous;
    }
  });

  it.each(['input', 'dependency', 'checker', 'config', 'fixtures/a', 'fixtures/new'])(
    '%s content/membership invalidates a previous success',
    async (file) => {
      await ensureProof(await beginProofRun(root, policy), node());
      await writeFile(path.join(root, file), 'mutation');
      expect((await ensureProof(await beginProofRun(root, policy), node())).origin).toBe(
        'executed',
      );
      expect(calls).toBe(2);
    },
  );

  it('declared safe env invalidates while secret/unmodelled env is run-only and never persisted', async () => {
    declaration = { ...declaration, environment: { OC3_SYNTHETIC_MODE: ['one', 'two'] } };
    const original = process.env['OC3_SYNTHETIC_MODE'];
    try {
      process.env['OC3_SYNTHETIC_MODE'] = 'one';
      await ensureProof(await beginProofRun(root, policy), node());
      process.env['OC3_SYNTHETIC_MODE'] = 'two';
      await ensureProof(await beginProofRun(root, policy), node());
      expect(calls).toBe(2);
      process.env['OC3_SYNTHETIC_MODE'] = 'synthetic-sensitive-value';
      const inputs = await resolveProofInputs(root, declaration);
      expect(inputs.cacheable).toBe(false);
      expect(JSON.stringify(inputs)).not.toContain('synthetic-sensitive-value');
      await ensureProof(await beginProofRun(root, policy), node());
      await ensureProof(await beginProofRun(root, policy), node());
      expect(calls).toBe(4);
      expect(
        (await resolveProofInputs(root, { ...declaration, secretDependent: true })).cacheable,
      ).toBe(false);
    } finally {
      if (original === undefined) delete process.env['OC3_SYNTHETIC_MODE'];
      else process.env['OC3_SYNTHETIC_MODE'] = original;
    }
  });

  it.each(['missing', 'ambiguous', 'unknown'])(
    '%s dependencies never grant baseline reuse',
    async (reason) => {
      declaration = {
        ...declaration,
        ...(reason === 'missing'
          ? { files: ['absent'] }
          : { complete: false, diagnostics: [reason] }),
      };
      for (let i = 0; i < 2; i++) {
        const result = await ensureProof(await beginProofRun(root, policy), node());
        expect(result.origin).toBe('executed');
        expect(result.diagnostics.length).toBeGreaterThan(0);
      }
      expect(calls).toBe(2);
    },
  );

  it('FAIL is current-run single-flight, not a reusable baseline', async () => {
    const fail = node(async () => {
      calls++;
      return { status: 'fail', code: 7, diagnostics: ['synthetic failure'] };
    });
    const run = await beginProofRun(root, { ...policy, force: true });
    const results = await Promise.all([ensureProof(run, fail), ensureProof(run, fail)]);
    expect(results.map((result) => result.code)).toEqual([7, 7]);
    expect(calls).toBe(1);
    await ensureProof(await beginProofRun(root, policy), fail);
    expect(calls).toBe(2);
  });

  it('mutation during/after execution is stale and never executes the node twice', async () => {
    const run = await beginProofRun(root, policy);
    const mutating = node(async () => {
      calls++;
      await writeFile(path.join(root, 'input'), 'changed while executing');
      return { status: 'pass', code: 0, diagnostics: [] };
    });
    expect((await ensureProof(run, mutating)).status).toBe('stale');
    expect((await ensureProof(run, node())).status).toBe('stale');
    expect(calls).toBe(1);
    await ensureProof(await beginProofRun(root, policy), node());
    expect(calls).toBe(2);
    await writeFile(path.join(root, 'input'), 'changed after execution');
    expect((await ensureProof(run, node())).status).toBe('stale');
  });

  it('corrupt baseline recomputes with a diagnostic without replacing corrupt evidence', async () => {
    const first = await ensureProof(await beginProofRun(root, policy), node());
    const file = path.join(
      root,
      proofFile(`proofs/${proofDigest({ node: first.node, input: first.input })}.json`),
    );
    await writeFile(file, '{broken');
    const result = await ensureProof(await beginProofRun(root, policy), node());
    expect(result.origin).toBe('executed');
    expect(result.diagnostics).toContain('corrupt baseline: executed without reuse');
    expect(await readFile(file, 'utf8')).toBe('{broken');
    expect(calls).toBe(2);
  });

  it('inspection is read-only; unknown schemas/integrity and sensitive or ambiguous inputs never grant a baseline PASS', async () => {
    const first = await ensureProof(await beginProofRun(root, policy), node());
    const before = await readdir(path.join(root, '.oc3'), { recursive: true });
    expect((await inspectProof(root, node())).status).toBe('pass');
    expect(await readdir(path.join(root, '.oc3'), { recursive: true })).toEqual(before);
    const file = path.join(
      root,
      proofFile(`proofs/${proofDigest({ node: first.node, input: first.input })}.json`),
    );
    for (const body of [
      { version: 999, node: first.node, input: first.input, status: 'pass', code: 0 },
      { version: 1, node: first.node, input: first.input, status: 'pass', code: 0 },
    ]) {
      await writeFile(file, JSON.stringify({ body, integrity: proofDigest(body) }));
      expect((await inspectProof(root, node())).status).toBe('pending');
      const result = await ensureProof(await beginProofRun(root, policy), node());
      expect(result.origin).toBe('executed');
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
    await writeFile(file, JSON.stringify({ body: { status: 'pass' }, integrity: 'broken' }));
    expect((await inspectProof(root, node())).status).toBe('pending');
    await writeFile(path.join(root, '.env'), 'synthetic-private-value');
    const sensitive = await resolveProofInputs(root, { ...declaration, files: ['.env'] });
    expect(sensitive.cacheable).toBe(false);
    expect(sensitive.manifest.files.map((entry) => entry.file)).toEqual(['checker', 'fixtures/a']);
    expect(JSON.stringify(sensitive)).not.toContain('synthetic-private-value');
    await symlink(path.join(root, 'input'), path.join(root, 'fixtures/ambiguous'));
    expect((await resolveProofInputs(root, declaration)).cacheable).toBe(false);
  });

  it('membership removal and explicit run-only policy are conservative', async () => {
    expect(
      (
        await resolveProofInputs(root, {
          ...declaration,
          files: ['absent'],
          optionalFiles: ['absent'],
        })
      ).cacheable,
    ).toBe(false);
    await ensureProof(await beginProofRun(root, policy), node());
    await rm(path.join(root, 'fixtures/a'));
    expect((await ensureProof(await beginProofRun(root, policy), node())).origin).toBe('executed');
    declaration = { ...declaration, cacheability: 'run-only' };
    expect((await ensureProof(await beginProofRun(root, policy), node())).origin).toBe('executed');
    expect((await ensureProof(await beginProofRun(root, policy), node())).origin).toBe('executed');
    expect(calls).toBe(4);
  });

  it('transport rejects foreign root/token/owner/scope/force/capability and forged run IDs', async () => {
    const run = await beginProofRun(root, policy);
    expect(await joinProofRun(root, JSON.stringify(run), policy)).toEqual(run);
    for (const mutation of [
      { token: 'a'.repeat(64) },
      { owner: 'other' },
      { scope: ['other'] },
      { force: true },
      { allowJudge: true },
      { id: 'b'.repeat(36) },
    ])
      await expect(joinProofRun(root, JSON.stringify({ ...run, ...mutation }))).rejects.toThrow();
    await mkdir(path.join(root, 'other'));
    await expect(joinProofRun(path.join(root, 'other'), JSON.stringify(run))).rejects.toThrow(
      'PROOF_TRANSPORT_REJECTED',
    );
    const scoped = await beginProofRun(root, { ...policy, scope: ['other'] });
    await expect(ensureProof(scoped, node())).rejects.toThrow('PROOF_SCOPE_REJECTED');
  });

  it('subprocess callers share a root-bound claim and actual result, without a global verification lease', async () => {
    const run = await beginProofRun(root, { ...policy, force: true });
    const runner = new URL(
      `file://${path.join(path.dirname(import.meta.dirname), 'src/lib/proof/runner.ts')}`,
    ).href;
    const transport = new URL(
      `file://${path.join(path.dirname(import.meta.dirname), 'src/lib/proof/transport.ts')}`,
    ).href;
    const driver = `import {appendFile} from 'node:fs/promises';import {setTimeout} from 'node:timers/promises';import {ensureProof} from ${JSON.stringify(runner)};import {joinProofRun,PROOF_TRANSPORT} from ${JSON.stringify(transport)};const run=await joinProofRun(process.cwd(),process.env[PROOF_TRANSPORT]); const result=await ensureProof(run,{id:'synthetic-checker',declaration:${JSON.stringify(declaration)},execute:async()=>{await appendFile('counter','x');await setTimeout(150);return {status:'fail',code:4,diagnostics:[]}}});console.log(result.status);`;
    const file = path.join(root, 'child.mjs');
    await writeFile(file, driver);
    const launch = () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ['--conditions=source', file], {
          cwd: root,
          env: proofRunEnvironment(run),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.once('error', reject);
        child.once('close', (code) => (code === 0 ? resolve(output) : reject(new Error(output))));
      });
    expect(
      (await Promise.all([launch(), launch()])).every((output) => output.includes('fail')),
    ).toBe(true);
    expect(await readFile(path.join(root, 'counter'), 'utf8')).toBe('x');
  });
});
