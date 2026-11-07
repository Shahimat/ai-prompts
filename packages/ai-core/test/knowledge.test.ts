import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileSchema, schemaSet } from '#shared/schema';
import { isRecord } from '#shared/guards';
import {
  KNOWLEDGE_DELTA_SCHEMA,
  enqueueKnowledge,
  intakeSuccessfulResult,
  knowledgeDeltaOf,
  pendingKnowledge,
  pendingViewOf,
  prepareKnowledgeBatch,
  queryPendingKnowledge,
  resolveKnowledgeBatch,
  runKnowledgeBatchStage,
} from '#lib/knowledge';
import { digestOf, localSnapshot } from '#lib/local-store';
import { memoryPromptOf } from '#lib/role';
import { PROTOCOL } from '#lib/protocol';
import { main } from '@shahimat/cli';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'knowledge-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const item = (value: unknown = 'synthetic') => ({
  subject: 'topic',
  property: 'new-property',
  value,
  kind: 'candidate',
  evidence: ['unresolved:synthetic'],
});
const context = (root: string, execution = 'run') => ({
  root,
  actor: 'executor',
  execution,
  channel: 'test',
});
const result = (knowledge_delta: unknown) => ({
  status: 'done',
  changed: [],
  failed: [],
  questions: [],
  report: 'synthetic',
  knowledge_delta,
});

describe('knowledge contract', () => {
  it('formal and runtime delta shape are equivalent; legacy messages remain closed', async () => {
    const repository = path.dirname(path.dirname(path.dirname(import.meta.dirname)));
    const formal: unknown = JSON.parse(
      await readFile(
        path.join(repository, 'expectations/schemas/knowledge-delta.schema.json'),
        'utf8',
      ),
    );
    expect(formal).toEqual(KNOWLEDGE_DELTA_SCHEMA);
    const schemas: Record<string, object> = {};
    const schemaDir = path.join(repository, 'expectations/schemas');
    for (const name of (await readdir(schemaDir)).filter((name) => name.endsWith('.schema.json'))) {
      const schema: unknown = JSON.parse(await readFile(path.join(schemaDir, name), 'utf8'));
      if (!isRecord(schema)) throw new Error('schema missing');
      schemas[name] = schema;
    }
    const resolve = schemaSet(schemas);
    const report = resolve('report.schema.json');
    const message = resolve('message.schema.json');
    if (report === undefined || message === undefined) throw new Error('formal validators missing');
    expect(report({ done: [], checks: [] })).toEqual([]);
    const body = {
      done: ['synthetic'],
      checks: ['synthetic'],
      knowledge_delta: [item({ structured: true })],
    };
    expect(report(body)).toEqual([]);
    expect(
      message({
        id: 'synthetic',
        from: 'executor',
        to: 'operator',
        ticket: 'fixture',
        kind: 'report',
        summary: 'synthetic',
        created_at: '2026-10-14',
        body,
      }),
    ).toEqual([]);
    expect(compileSchema(PROTOCOL.result)(result([]))).toEqual([]);
    const { knowledge_delta, ...legacy } = result([]);
    expect(knowledge_delta).toEqual([]);
    expect(compileSchema(PROTOCOL.result)(legacy)).toEqual([]);
    expect(
      compileSchema(PROTOCOL.verdict)({ answers: [], knowledge_delta: [] }).length,
    ).toBeGreaterThan(0);
    expect(compileSchema(PROTOCOL.question)({ knowledge_delta: [] }).length).toBeGreaterThan(0);
  });
  it.each([null, true, 4, 'text', [1, false], { nested: ['value'] }])(
    'bounded JSON roundtrips %j',
    (value) => {
      expect(knowledgeDeltaOf([item(value)])[0]?.value).toEqual(value);
    },
  );
  it('rejects metadata, secrets, non-JSON, deep/large payloads without echoing values', () => {
    expect(() => knowledgeDeltaOf([{ ...item(), actor: 'spoof' }])).toThrow('INVALID_DELTA');
    const sensitive = `sk-${'x'.repeat(32)}`;
    expect(() => knowledgeDeltaOf([item(sensitive)])).toThrow(/^SECRET_INPUT$/);
    expect(() => knowledgeDeltaOf([item({ api_key: 'syntheticcredentialvalue' })])).toThrow(
      /^SECRET_INPUT$/,
    );
    expect(() => knowledgeDeltaOf([{ ...item(), value: undefined }])).toThrow();
    expect(() => knowledgeDeltaOf([item(Number.NaN)])).toThrow();
    expect(() => knowledgeDeltaOf([item('x'.repeat(9000))])).toThrow();
    expect(() => knowledgeDeltaOf(Array.from({ length: 33 }, () => item()))).toThrow();
    expect(() => knowledgeDeltaOf([item([[[[[[[[[1]]]]]]]]])])).toThrow('INVALID_JSON_VALUE');
  });
});

describe('durable intake and projection', () => {
  it('manual operator CLI ingress enqueues without a runner, canonical mutation or network', async () => {
    await writeFile(path.join(root, 'canonical.md'), 'synthetic canonical');
    await writeFile(
      path.join(root, 'input.json'),
      JSON.stringify({ knowledge_delta: [item({ structured: true })] }),
    );
    expect(await main(['memory', 'inbox', 'enqueue', '--file', 'input.json', '--root', root])).toBe(
      0,
    );
    expect(await pendingKnowledge(root)).toHaveLength(1);
    expect(await readFile(path.join(root, 'canonical.md'), 'utf8')).toBe('synthetic canonical');
    expect(existsSync(path.join(root, 'agents'))).toBe(false);
    const before = await readdir(path.join(root, '.oc3/inbox/knowledge/submissions'));
    expect(await main(['memory', 'inbox', 'pending', '--root', root])).toBe(0);
    expect(await readdir(path.join(root, '.oc3/inbox/knowledge/submissions'))).toEqual(before);
  });
  it('idempotent retries and duplicate items retain one receipt; actor/project provenance is isolated', async () => {
    const first = await enqueueKnowledge(context(root), [item(), item()]);
    expect(first?.entry_ids).toHaveLength(1);
    expect(await enqueueKnowledge(context(root), [item()])).toEqual(first);
    await enqueueKnowledge({ ...context(root), actor: 'researcher' }, [item()]);
    expect(await pendingKnowledge(root)).toHaveLength(2);
    const other = await mkdtemp(path.join(tmpdir(), 'knowledge-other-'));
    try {
      const receipt = await enqueueKnowledge(context(other), [item()]);
      expect(receipt?.project_id).not.toBe(first?.project_id);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
  it('normalization ignores object field ordering without merging kinds or provenance', async () => {
    const first = await enqueueKnowledge(context(root), [item({ a: 1, b: 2 })]);
    const reversed = {
      evidence: ['unresolved:synthetic'],
      kind: 'candidate',
      value: { b: 2, a: 1 },
      property: 'new-property',
      subject: 'topic',
    };
    expect(await enqueueKnowledge(context(root), [reversed])).toEqual(first);
    await enqueueKnowledge(context(root), [{ ...reversed, kind: 'decision' }]);
    expect(await pendingKnowledge(root)).toHaveLength(2);
  });
  it.each(['link', 'sync'])(
    '%s failure publishes no accepted partial record and a safe retry preserves the logical submission',
    async (fault) => {
      const module = pathToFileURL(
        path.join(path.dirname(import.meta.dirname), 'src/lib/knowledge.ts'),
      ).href;
      const injection =
        fault === 'link'
          ? `const link=fs.link;fs.link=async(a,b)=>{if(b.includes('/submissions/'))throw new Error('synthetic publication fault');return link(a,b)}`
          : `const open=fs.open;fs.open=async(...args)=>{const h=await open(...args);if(String(args[0]).includes('knowledge-tmp/')&&!String(args[0]).includes('project.json'))h.sync=async()=>{throw new Error('synthetic sync fault')};return h}`;
      const code = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';${injection};syncBuiltinESMExports();const{enqueueKnowledge}=await import(${JSON.stringify(module)});try{await enqueueKnowledge(${JSON.stringify(context(root))},${JSON.stringify([item()])});process.exitCode=4}catch(e){console.error(e.message);process.exitCode=1}`;
      const result = await new Promise<{ code: number | null; error: string }>(
        (resolve, reject) => {
          const child = spawn(
            process.execPath,
            ['--conditions=source', '--input-type=module', '-e', code],
            { stdio: ['ignore', 'ignore', 'pipe'] },
          );
          let error = '';
          child.stderr.on('data', (chunk: Buffer) => {
            error += chunk.toString();
          });
          child.once('error', reject);
          child.once('exit', (code) => resolve({ code, error }));
        },
      );
      expect(result.code).toBe(1);
      expect(result.error).toContain('synthetic');
      expect(result.error).not.toContain('new-property');
      expect(await pendingKnowledge(root)).toHaveLength(0);
      await enqueueKnowledge(context(root), [item()]);
      expect(await pendingKnowledge(root)).toHaveLength(1);
    },
  );
  it('old/empty/failed/question/non-success output does not create a store', async () => {
    for (const data of [
      result([]),
      { ...result([item()]), status: 'failed' },
      { ...result([item()]), failed: ['check'] },
      { ...result([item()]), questions: ['question'] },
      { status: 'done' },
    ])
      expect(await intakeSuccessfulResult(context(root), data)).toBeUndefined();
    expect(existsSync(path.join(root, '.oc3/inbox'))).toBe(false);
  });
  it('query reads durable records, not cache; prompts are bounded and contain no raw evidence/value', async () => {
    const sentinel = 'RAW_EVIDENCE_SENTINEL';
    await enqueueKnowledge(context(root), [
      { ...item('RAW_VALUE_SENTINEL'), evidence: [sentinel] },
    ]);
    await writeFile(path.join(root, '.oc3/bundles/pending/index.md'), 'corrupt cache');
    const prompt = await memoryPromptOf(root, 'task');
    expect(prompt).toContain('items=1');
    expect(prompt).not.toContain(sentinel);
    expect(prompt).not.toContain('RAW_VALUE_SENTINEL');
    expect(prompt).not.toContain('corrupt cache');
    const before = await readFile(path.join(root, '.oc3/bundles/pending/index.md'), 'utf8');
    await pendingViewOf(root);
    expect(await readFile(path.join(root, '.oc3/bundles/pending/index.md'), 'utf8')).toBe(before);
  });
  it('overflow and critical/conflict flags are visible without choosing a truth', async () => {
    await enqueueKnowledge(context(root), [
      item('a'),
      item('b'),
      ...Array.from({ length: 25 }, (_, i) => ({ ...item(), subject: `topic-${i}` })),
      { ...item(), subject: 'privacy policy' },
    ]);
    const view = await pendingViewOf(root);
    expect(Buffer.byteLength(view)).toBeLessThanOrEqual(4096);
    expect(view).toContain('CRITICAL');
    expect(view).toContain('CONFLICT');
    expect(view).toContain('overflow=');
  });
  it('record corruption and symlink escapes fail closed', async () => {
    const receipt = await enqueueKnowledge(context(root), [item()]);
    if (receipt === undefined) throw new Error('receipt missing');
    const file = path.join(root, receipt.locator);
    const record: unknown = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ record, tamper: true }));
    await expect(pendingKnowledge(root)).rejects.toThrow('CORRUPT_RECORD');
    await rm(path.join(root, '.oc3/inbox'), { recursive: true });
    await symlink(tmpdir(), path.join(root, '.oc3/inbox'));
    await expect(enqueueKnowledge(context(root), [item()])).rejects.toThrow('symlink');
  });
  it('parallel independent processes publish complete unique records and same-key retries', async () => {
    const module = pathToFileURL(
      path.join(path.dirname(import.meta.dirname), 'src/lib/knowledge.ts'),
    ).href;
    const child = (execution: string, value: string) =>
      new Promise<void>((resolve, reject) => {
        const code = `import {enqueueKnowledge} from ${JSON.stringify(module)}; await enqueueKnowledge(${JSON.stringify(context(root, execution))},${JSON.stringify([item(value)])});`;
        const process = spawn(
          globalThis.process.execPath,
          ['--conditions=source', '--input-type=module', '-e', code],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let error = '';
        process.stderr.on('data', (chunk: Buffer) => {
          error += chunk.toString();
        });
        process.once('error', reject);
        process.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(error))));
      });
    await Promise.all([
      child('same', 'same'),
      child('same', 'same'),
      ...Array.from({ length: 6 }, (_, i) => child(`run-${i}`, `value-${i}`)),
    ]);
    expect(await pendingKnowledge(root)).toHaveLength(7);
    const files = await readdir(path.join(root, '.oc3/inbox/knowledge/submissions'));
    expect(files.filter((name) => name.endsWith('.json'))).toHaveLength(7);
    expect(files.some((name) => name.endsWith('.tmp'))).toBe(false);
  }, 20000);
  it.each(['before', 'after'])(
    'process crash %s immutable publication never creates a partial accepted record',
    async (point) => {
      const module = pathToFileURL(
        path.join(path.dirname(import.meta.dirname), 'src/lib/knowledge.ts'),
      ).href;
      const code = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; const link=fs.link; fs.link=async(a,b)=>{if(b.includes('/submissions/')){${point === 'after' ? 'await link(a,b);' : ''}process.kill(process.pid,'SIGKILL');}return link(a,b);}; syncBuiltinESMExports(); const {enqueueKnowledge}=await import(${JSON.stringify(module)}); await enqueueKnowledge(${JSON.stringify(context(root))},${JSON.stringify([item()])});`;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--conditions=source', '--input-type=module', '-e', code],
          { stdio: 'ignore' },
        );
        child.once('error', reject);
        child.once('exit', (_code, signal) =>
          signal === 'SIGKILL' ? resolve() : reject(new Error('fault not reached')),
        );
      });
      expect(await pendingKnowledge(root)).toHaveLength(point === 'after' ? 1 : 0);
      const receipt = await enqueueKnowledge(context(root), [item()]);
      expect(receipt?.entry_ids).toHaveLength(1);
      expect(await pendingKnowledge(root)).toHaveLength(1);
      const records = await readdir(path.join(root, '.oc3/inbox/knowledge/submissions'));
      expect(records).toHaveLength(1);
      expect(records[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    },
  );
  it('linked and detached worktrees use one project store but preserve exact origin scopes', async () => {
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    };
    await writeFile(path.join(root, 'source.ts'), 'synthetic');
    git('init', '-q');
    git('add', '.');
    git(
      '-c',
      'user.email=synthetic@example.test',
      '-c',
      'user.name=Synthetic',
      'commit',
      '-qm',
      'fixture',
    );
    const worktree = await mkdtemp(path.join(tmpdir(), 'knowledge-linked-'));
    try {
      git('worktree', 'add', '--detach', worktree, 'HEAD');
      const a = await enqueueKnowledge(context(root), [item()]);
      const b = await enqueueKnowledge(context(worktree, 'linked'), [item('different origin')]);
      expect(a?.project_id).toBe(b?.project_id);
      expect(await pendingKnowledge(worktree)).toHaveLength(2);
      expect(new Set((await pendingKnowledge(worktree)).map((entry) => entry.scope)).size).toBe(2);
      expect(existsSync(path.join(worktree, '.oc3/inbox'))).toBe(false);
    } finally {
      await rm(worktree, { recursive: true, force: true });
    }
  });
  it('a synced unpublished scratch file is not mistaken for accepted evidence', async () => {
    await mkdir(path.join(root, '.oc3/locks/knowledge-tmp'), { recursive: true });
    await writeFile(path.join(root, '.oc3/locks/knowledge-tmp/orphan.tmp'), '{partial');
    expect(await pendingKnowledge(root)).toEqual([]);
  });
});

describe('exact-ID consolidation', () => {
  it('explicit queries and frozen batches enforce byte/count caps with visible overflow', async () => {
    for (const [execution, count] of [
      ['first', 8],
      ['second', 4],
    ] as const)
      await enqueueKnowledge(
        context(root, execution),
        Array.from({ length: count }, (_, index) =>
          item(`${execution}-${index}:${'x'.repeat(7000)}`),
        ),
      );
    const first = (await pendingKnowledge(root))[0];
    if (first === undefined) throw new Error('entry missing');
    const selection = { subject: 'topic', scope: first.scope, limit: 32 };
    const query = await queryPendingKnowledge(root, selection);
    expect(Buffer.byteLength(JSON.stringify(query))).toBeLessThanOrEqual(65536);
    expect(query.overflow).toBeGreaterThan(0);
    const batch = await prepareKnowledgeBatch(root, selection);
    expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThanOrEqual(65536);
    expect(batch.entries.length).toBeLessThanOrEqual(query.entries.length);
    await expect(queryPendingKnowledge(root, { ...selection, actor: 'spoof' })).rejects.toThrow(
      'INVALID_BATCH_SELECTION',
    );
  });
  async function batch() {
    await enqueueKnowledge(context(root), [item('A'), item('B')]);
    const entries = await pendingKnowledge(root);
    const first = entries[0];
    if (first === undefined) throw new Error('entry missing');
    return prepareKnowledgeBatch(root, { subject: 'topic', scope: first.scope, limit: 32 });
  }
  async function close(id: string, run = 'run') {
    for (const stage of ['apply', 'verify', 'review', 'close'] as const)
      expect(await runKnowledgeBatchStage(root, id, run, stage, async () => true)).toBe(true);
  }
  it('freeze A/B then arrival C: partial exact-ID resolution leaves B/C pending and retry is idempotent', async () => {
    const snapshot = await batch();
    await enqueueKnowledge(context(root, 'later'), [item('C')]);
    await close(snapshot.id);
    const first = snapshot.entries[0];
    if (first === undefined) throw new Error('entry missing');
    const proposed = [
      {
        id: first.id,
        hash: first.hash,
        status: 'rejected',
        reason: 'synthetic decision',
        evidence: ['review:synthetic'],
      },
    ];
    await resolveKnowledgeBatch(root, snapshot.id, 'run', proposed);
    await resolveKnowledgeBatch(root, snapshot.id, 'run', proposed);
    const remaining = (await pendingKnowledge(root)).map((e) => e.item.value);
    expect(remaining).toHaveLength(2);
    expect(remaining).toContain(snapshot.entries[1]?.item.value);
    expect(remaining).toContain('C');
  });
  it('failed review cannot ack; missing/wrong run/foreign IDs and tampered hashes reject', async () => {
    const snapshot = await batch();
    await runKnowledgeBatchStage(root, snapshot.id, 'run', 'apply', async () => true);
    await runKnowledgeBatchStage(root, snapshot.id, 'run', 'verify', async () => true);
    await runKnowledgeBatchStage(root, snapshot.id, 'run', 'review', async () => false);
    await expect(resolveKnowledgeBatch(root, snapshot.id, 'run', [])).rejects.toThrow(
      'MISSING_CLOSE_PROOF',
    );
    expect(await pendingKnowledge(root)).toHaveLength(2);
    await close(snapshot.id);
    await expect(resolveKnowledgeBatch(root, snapshot.id, 'other', [])).rejects.toThrow();
    await expect(
      resolveKnowledgeBatch(root, snapshot.id, 'run', [
        {
          id: digestOf('foreign'),
          hash: digestOf('hash'),
          status: 'rejected',
          reason: 'no',
          evidence: ['e'],
        },
      ]),
    ).rejects.toThrow('FOREIGN');
  });
  it('applied requires an exact existing canonical content hash', async () => {
    const snapshot = await batch();
    await close(snapshot.id);
    const first = snapshot.entries[0];
    if (first === undefined) throw new Error('entry missing');
    await expect(
      resolveKnowledgeBatch(root, snapshot.id, 'run', [
        {
          id: first.id,
          hash: first.hash,
          status: 'applied',
          reason: 'existing',
          evidence: ['e'],
          target: 'missing',
          content_hash: digestOf('wrong'),
        },
      ]),
    ).rejects.toThrow('STALE_CANONICAL');
    expect((await localSnapshot(root)).scope).toBe(snapshot.base.scope);
  });
  it('no-op application is accepted only for a verified locator; failed ack and later changes preserve pending', async () => {
    const snapshot = await batch();
    await writeFile(path.join(root, 'canonical.md'), 'verified canonical locator');
    const first = snapshot.entries[0];
    if (first === undefined) throw new Error('entry missing');
    const { contentHash } = await import('#lib/local-store');
    const hash = await contentHash(root, 'canonical.md');
    await runKnowledgeBatchStage(root, snapshot.id, 'run', 'apply', async () => true);
    await runKnowledgeBatchStage(root, snapshot.id, 'run', 'verify', async () => true, {
      targets: ['canonical.md'],
    });
    await runKnowledgeBatchStage(root, snapshot.id, 'run', 'review', async () => true);
    await runKnowledgeBatchStage(root, snapshot.id, 'run', 'close', async () => true);
    const proposed = [
      {
        id: first.id,
        hash: first.hash,
        status: 'applied',
        target: 'canonical.md',
        content_hash: hash,
        reason: 'existing fact',
        evidence: ['canonical.md'],
      },
    ];
    await writeFile(path.join(root, 'canonical.md'), 'changed after review');
    await expect(resolveKnowledgeBatch(root, snapshot.id, 'run', proposed)).rejects.toThrow(
      'STALE_CANONICAL',
    );
    expect(await pendingKnowledge(root)).toHaveLength(2);
    await writeFile(path.join(root, 'canonical.md'), 'verified canonical locator');
    await resolveKnowledgeBatch(root, snapshot.id, 'run', proposed);
    expect(await pendingKnowledge(root)).toHaveLength(1);
  });
  it('failed immutable resolution publication cannot acknowledge any selected ID', async () => {
    const snapshot = await batch();
    await close(snapshot.id);
    const first = snapshot.entries[0];
    if (first === undefined) throw new Error('entry missing');
    const proposed = [
      {
        id: first.id,
        hash: first.hash,
        status: 'rejected',
        reason: 'synthetic',
        evidence: ['fixture:review'],
      },
    ];
    const module = pathToFileURL(
      path.join(path.dirname(import.meta.dirname), 'src/lib/knowledge.ts'),
    ).href;
    const code = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';const link=fs.link;fs.link=async(a,b)=>{if(b.includes('/resolutions/'))throw new Error('synthetic ack fault');return link(a,b)};syncBuiltinESMExports();const{resolveKnowledgeBatch}=await import(${JSON.stringify(module)});try{await resolveKnowledgeBatch(${JSON.stringify(root)},${JSON.stringify(snapshot.id)},'run',${JSON.stringify(proposed)});process.exitCode=4}catch(e){process.exitCode=e.message.includes('synthetic ack fault')?0:5}`;
    const exit = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--conditions=source', '--input-type=module', '-e', code],
        { stdio: 'ignore' },
      );
      child.once('error', reject);
      child.once('exit', resolve);
    });
    expect(exit).toBe(0);
    expect(await pendingKnowledge(root)).toHaveLength(2);
    await resolveKnowledgeBatch(root, snapshot.id, 'run', proposed);
    expect(await pendingKnowledge(root)).toHaveLength(1);
  });
});
