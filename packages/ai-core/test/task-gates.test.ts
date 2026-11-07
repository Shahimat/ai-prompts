import { spawn, spawnSync } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLease, contentHash, gitRead, readJson, recoverLease } from '#lib/local-store';
import { isRecord } from '#shared/guards';
import {
  attestTaskPhase,
  acceptTaskVerdict,
  authorityHash,
  currentCheck,
  launchPreflight,
  loadTaskPacket,
  recordTaskAcceptance,
  taskPacketOf,
  taskPreflight,
  taskReady,
  taskSnapshot,
  verifyTask,
  type TaskPacket,
} from '#lib/task-gates';

let root: string;
let packet: TaskPacket;
async function put(file: string, text: string) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}
function git(...args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'task-gates-'));
  await put('source.ts', 'export const synthetic = 1;\n');
  await put('DoD.md', 'approved: criterion P1\n');
  await put('package.json', '{"engines":{"node":">=24"}}');
  await put('package-lock.json', '{}');
  await put('.oc3/project.yml', 'runtime: full\n');
  await put('.gitignore', '.oc3/locks/\n.oc3/bundles/\n');
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
  const head = gitRead(root, ['rev-parse', 'HEAD']);
  if (head === null) throw new Error('HEAD unavailable');
  packet = taskPacketOf({
    version: 1,
    scope: { included: ['fixture'], excluded: ['external writes'] },
    repair_budget: {
      ordinary_attempts: 3,
      identical_failure_without_new_diagnosis: 2,
      existing_fsm_limits_take_precedence: true,
    },
    ticket: 'fixture',
    project_root: '.',
    baseline_head: head,
    authority: {
      file: 'DoD.md',
      digest: await authorityHash(root, {
        authority: { file: 'DoD.md', digest: '', criteria: {} },
      }),
      criteria: { P1: 'approved' },
    },
    owners: {
      code: 'executor',
      source: 'operator',
      docs: 'librarian',
      verification: 'executor',
      acceptance: 'judge',
    },
    checks: {
      targeted: { argv: ['node', '-e', 'process.exit(0)'], cwd: '.' },
      full: { argv: ['node', '-e', 'process.exit(0)'], cwd: '.' },
    },
    classification: [
      { path: '*.ts', class: 'source', owner: 'executor' },
      { path: 'DoD.md', class: 'source', owner: 'operator' },
      { path: '.gitignore', class: 'source', owner: 'executor' },
      { path: 'package*.json', class: 'source', owner: 'executor' },
      { path: '.oc3/project.yml', class: 'source', owner: 'operator' },
      { path: '.oc3/reports/**', class: 'durable-evidence', owner: 'runtime' },
      { path: '.oc3/verdicts/**', class: 'durable-evidence', owner: 'judge' },
      { path: '.oc3/locks/**', class: 'runtime', owner: 'runtime' },
      { path: '.oc3/bundles/**', class: 'generated', owner: 'runtime' },
    ],
    fingerprint_excludes: ['.oc3/bundles/pending/**'],
    prerequisites: ['package.json'],
    launch_inputs: ['source.ts'],
    launch_paths: [
      'native',
      'role',
      'ops',
      'expect',
      'plan-review',
      'expect-script',
      'manual-docs',
    ],
    required_checks: ['full'],
    no_docs_needed: true,
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('task packet and snapshot gates', () => {
  it('arbitrary external evidence and managed areas are rejected before classification, even when labelled source', async () => {
    const bypass: TaskPacket = {
      ...packet,
      classification: [{ path: '**', class: 'source', owner: 'executor' }],
      managed_areas: ['arbitrary-output'],
    };
    await expect(taskPreflight(root, bypass)).rejects.toThrow('ARTIFACT_NAMESPACE');
    await expect(
      taskPreflight(root, {
        ...bypass,
        managed_areas: [],
        phase_evidence: { 'docs-derived': ['arbitrary-proof.json'] },
      }),
    ).rejects.toThrow('ARTIFACT_NAMESPACE');
    await expect(
      attestTaskPhase(root, packet, 'docs-derived', 'librarian', ['source.ts']),
    ).rejects.toThrow('ARTIFACT_NAMESPACE');
  });
  it('classification, source labels and wildcard exclusions cannot authorize external artifacts', async () => {
    await put('.ops/forbidden/report.json', '{"synthetic":true}');
    const bypass: TaskPacket = {
      ...packet,
      classification: [{ path: '**', class: 'source', owner: 'operator' }],
      fingerprint_excludes: ['**'],
    };
    await expect(taskPreflight(root, bypass)).rejects.toThrow('ARTIFACT_NAMESPACE');
    await expect(launchPreflight(root, { purpose: 'research' })).rejects.toThrow(
      'ARTIFACT_NAMESPACE',
    );
    await expect(taskReady(root, bypass)).rejects.toThrow('ARTIFACT_NAMESPACE');
  });
  it('native docs completion is operator-confirmed evidence plus fresh checks, never a fabricated harness lifecycle', async () => {
    await put('docs.md', 'synthetic completed documentation\n');
    const docHash = await contentHash(root, 'docs.md');
    if (docHash === null) throw new Error('document missing');
    const evidence = '.oc3/reports/fixture/native-docs.json';
    await put(
      evidence,
      JSON.stringify({
        version: 1,
        kind: 'operator-confirmed-native-docs',
        session: 'ses_synthetic',
        owner: 'librarian',
        status: 'completed',
        confirmation: 'Synthetic operator confirms completed native session',
        targets: [{ file: 'docs.md', hash: docHash }],
      }),
    );
    const digest = await contentHash(root, evidence);
    if (digest === null) throw new Error('confirmation missing');
    packet = {
      ...packet,
      no_docs_needed: false,
      classification: [
        ...packet.classification,
        { path: 'docs.md', class: 'source', owner: 'librarian' },
      ],
      checks: { ...packet.checks, docs: { argv: ['node', '-e', 'process.exit(0)'], cwd: '.' } },
      completed_docs: { session: 'ses_synthetic', evidence, digest, checks: ['docs'] },
    };
    await verifyTask(root, packet, 'targeted', 'executor');
    await attestTaskPhase(root, packet, 'code-source-stable', 'executor', []);
    await expect(
      attestTaskPhase(root, packet, 'docs-derived', 'librarian', [evidence]),
    ).rejects.toThrow('MISSING_RECEIPT: docs');
    await verifyTask(root, packet, 'docs', 'executor');
    await expect(
      attestTaskPhase(
        root,
        {
          ...packet,
          completed_docs: {
            ...packet.completed_docs,
            session: 'ses_other',
            evidence,
            digest,
            checks: ['docs'],
          },
        },
        'docs-derived',
        'librarian',
        [evidence],
      ),
    ).rejects.toThrow('INVALID_NATIVE_DOCS_COMPLETION');
    const phase = await attestTaskPhase(root, packet, 'docs-derived', 'librarian', [evidence]);
    expect(phase['native_completion']).toMatchObject({
      mode: 'operator-confirmed-native',
      session: 'ses_synthetic',
      targets: [{ file: 'docs.md', hash: docHash }],
    });
    expect(phase['stages']).toBeUndefined();
    expect((await verifyTask(root, packet, 'full', 'executor'))['status']).toBe('pass');
    await put('docs.md', 'changed after the confirmed completion');
    await expect(
      attestTaskPhase(root, packet, 'docs-derived', 'librarian', [evidence]),
    ).rejects.toThrow('NATIVE_DOCS_TARGET_STALE');
  }, 20000);
  it('authoritative ticket acceptance binds exact criterion evidence after current full; helpers do not demand future full', async () => {
    const file = '.oc3/reports/fixture/task-packet.json';
    await put(file, JSON.stringify(packet));
    packet = await loadTaskPacket(root, file);
    await expect(
      launchPreflight(root, { packet: file, purpose: 'docs-review' }),
    ).resolves.toBeDefined();
    await expect(
      launchPreflight(root, { packet: file, purpose: 'ticket-acceptance' }),
    ).rejects.toThrow('MISSING_RECEIPT');
    await verifyTask(root, packet, 'targeted', 'executor');
    await attestTaskPhase(root, packet, 'code-source-stable', 'executor', []);
    await put('.oc3/reports/fixture/docs-proof.json', '{"approved":"no-docs-needed fixture"}');
    await attestTaskPhase(root, packet, 'docs-derived', 'librarian', [
      '.oc3/reports/fixture/docs-proof.json',
    ]);
    await verifyTask(root, packet, 'full', 'executor');
    const verdict = {
      answers: [
        {
          id: 'P1',
          verdict: true,
          ref: 'source.ts:1',
          quote: 'export const synthetic = 1;',
          reason: 'synthetic verified criterion',
        },
      ],
    };
    await expect(acceptTaskVerdict(root, file, 'executor', 'run', verdict)).rejects.toThrow(
      'OWNER_MISMATCH',
    );
    await expect(
      acceptTaskVerdict(root, file, 'judge', 'invalid', {
        answers: [{ ...verdict.answers[0], quote: 'missing quote' }],
      }),
    ).rejects.toThrow('CRITERION_EVIDENCE_INVALID');
    await acceptTaskVerdict(root, file, 'judge', 'run', verdict);
    await acceptTaskVerdict(root, file, 'judge', 'run', verdict);
    expect((await taskReady(root, packet)).ready).toBe(true);
    await put('source.ts', 'changed after acceptance');
    await expect(
      launchPreflight(root, { packet: file, purpose: 'ticket-acceptance' }),
    ).rejects.toThrow('STALE_CHECK');
    await expect(
      launchPreflight(root, { packet: file, purpose: 'expect-helper' }),
    ).resolves.toBeDefined();
  });
  it('complete preflight passes without running a command; missing prerequisites, owner, authority, check fail', async () => {
    const preflight = await taskPreflight(root, packet);
    expect(preflight['kind']).toBe('preflight');
    await expect(
      taskPreflight(root, { ...packet, prerequisites: ['missing-bin'] }),
    ).rejects.toThrow();
    await expect(
      taskPreflight(root, {
        ...packet,
        authority: { ...packet.authority, digest: '0'.repeat(64) },
      }),
    ).rejects.toThrow('DOD_UNBOUND');
    expect(() => taskPacketOf({ ...packet, owners: {} })).toThrow('INVALID_TASK_PACKET');
    expect(() => taskPacketOf({ ...packet, checks: {} })).toThrow('INVALID_TASK_PACKET');
    expect(() =>
      taskPacketOf({ ...packet, launch_paths: Array.from({ length: 7 }, () => 'native') }),
    ).toThrow('INCOMPLETE_LAUNCH');
    await expect(taskPreflight(root, { ...packet, required_checks: ['absent'] })).rejects.toThrow(
      'MISSING_CHECK',
    );
  });
  it.each([
    'implementation',
    'ticket-acceptance',
    'docs-review',
    'expect-helper',
    'planning',
    'research',
  ] as const)(
    'legacy/helper purpose %s has minimal root context without fictitious readiness',
    async (purpose) => {
      const minimal = await launchPreflight(root, { purpose });
      expect(minimal.purpose).toBe(purpose);
      expect(minimal.ticket_ready).toBe(false);
      expect(minimal.worktree).toContain('task-gates-');
    },
  );
  it('content, untracked, launch artifact, DoD, dependency and staged changes invalidate receipts; logs do not', async () => {
    await verifyTask(root, packet, 'targeted', 'executor');
    await put('.oc3/verdicts/runs/fixture/1.yml', 'pass: true');
    await put('.oc3/bundles/pending/index.md', 'pending');
    await expect(currentCheck(root, packet, 'targeted')).resolves.toBeDefined();
    await put('untracked.ts', 'new source');
    await expect(currentCheck(root, packet, 'targeted')).rejects.toThrow('STALE_CHECK');
    await rm(path.join(root, 'untracked.ts'));
    await put('source.ts', 'changed');
    await expect(currentCheck(root, packet, 'targeted')).rejects.toThrow('STALE_CHECK');
    git('add', 'source.ts');
    await put('source.ts', 'export const synthetic = 1;\n');
    await expect(currentCheck(root, packet, 'targeted')).rejects.toThrow('STALE_CHECK');
    git('reset', '-q', 'HEAD', '--', 'source.ts');
    await put('package.json', '{"changed":true}');
    await expect(currentCheck(root, packet, 'targeted')).rejects.toThrow('STALE_CHECK');
  });
  it('ordinary failure is evidence; local repair can pass without extra role spawns', async () => {
    const failed = {
      ...packet,
      checks: { ...packet.checks, targeted: { argv: ['node', '-e', 'process.exit(1)'], cwd: '.' } },
    };
    expect((await verifyTask(root, failed, 'targeted', 'executor'))['status']).toBe('fail');
    expect((await verifyTask(root, packet, 'targeted', 'executor'))['status']).toBe('pass');
    await expect(verifyTask(root, packet, 'targeted', 'judge')).rejects.toThrow('OWNER_MISMATCH');
  });
  it('check evidence persists only safe summaries/full-stream digest, and log tampering blocks reuse', async () => {
    const configured = {
      ...packet,
      checks: {
        ...packet.checks,
        targeted: { argv: ['node', '-e', 'process.stdout.write("sk-"+"x".repeat(32))'], cwd: '.' },
      },
    };
    const receipt = await verifyTask(
      root,
      configured,
      'targeted',
      'executor',
      'operator/manual-cli',
    );
    expect(receipt['actor']).toBe('operator/manual-cli');
    expect(receipt['owner']).toBe('executor');
    const locator = receipt['log_locator'];
    if (typeof locator !== 'string') throw new Error('log locator missing');
    const log = await readFile(path.join(root, locator), 'utf8');
    expect(log).not.toContain(`sk-${'x'.repeat(32)}`);
    expect(log).toContain('"raw_output_persisted": false');
    await currentCheck(root, configured, 'targeted');
    await put(locator, '{}');
    await expect(currentCheck(root, configured, 'targeted')).rejects.toThrow('CORRUPT_CHECK_LOG');
  });
  it('a check changing source is STALE even at exit zero', async () => {
    const changing = {
      ...packet,
      checks: {
        ...packet.checks,
        targeted: {
          argv: ['node', '-e', 'require("node:fs").writeFileSync("source.ts","changed")'],
          cwd: '.',
        },
      },
    };
    expect((await verifyTask(root, changing, 'targeted', 'executor'))['status']).toBe('stale');
  });
  it('full and ticket acceptance obey barriers, current evidence and authoritative criteria', async () => {
    await put('.oc3/reports/fixture/docs-proof.json', '{"approved":"no-docs-needed fixture"}');
    await expect(verifyTask(root, packet, 'full', 'executor')).rejects.toThrow('MISSING_RECEIPT');
    await verifyTask(root, packet, 'targeted', 'executor');
    await attestTaskPhase(root, packet, 'code-source-stable', 'executor', []);
    await attestTaskPhase(root, packet, 'docs-derived', 'librarian', [
      '.oc3/reports/fixture/docs-proof.json',
    ]);
    expect((await verifyTask(root, packet, 'full', 'executor'))['status']).toBe('pass');
    await put('.oc3/reports/fixture/task-packet.json', JSON.stringify(packet));
    await expect(
      launchPreflight(root, {
        purpose: 'docs-review',
        packet: '.oc3/reports/fixture/task-packet.json',
      }),
    ).resolves.toBeDefined();
    await put('.oc3/verdicts/runs/fixture/1.yml', 'criterion: P1\npass: true');
    await recordTaskAcceptance(root, packet, 'judge', { P1: false }, [
      '.oc3/verdicts/runs/fixture/1.yml',
    ]);
    await expect(taskReady(root, packet)).rejects.toThrow('DOD_INCOMPLETE');
    await recordTaskAcceptance(root, packet, 'judge', { P1: true }, [
      '.oc3/verdicts/runs/fixture/1.yml',
    ]);
    expect((await taskReady(root, packet)).ready).toBe(true);
    const before = await readFile(path.join(root, '.oc3/reports/fixture/checks/full.json'), 'utf8');
    await taskReady(root, packet);
    expect(await readFile(path.join(root, '.oc3/reports/fixture/checks/full.json'), 'utf8')).toBe(
      before,
    );
    await put('cache.json', '{}');
    await expect(taskReady(root, packet)).rejects.toThrow('STALE_PHASE');
  });
  it('lease prevents concurrent managed owners, cannot release another token, and does not lock another root', async () => {
    const lease = await acquireLease(root, 'verification', 'executor', {
      caller: 'native:executor:session',
      run: 'bound-run',
    });
    const metadata = await readJson(lease.file);
    expect(isRecord(metadata) ? metadata['context'] : undefined).toEqual({
      caller: 'native:executor:session',
      run: 'bound-run',
    });
    await expect(acquireLease(root, 'verification', 'executor')).rejects.toThrow('LOCK_BUSY');
    const other = await mkdtemp(path.join(tmpdir(), 'task-other-'));
    try {
      const independent = await acquireLease(other, 'verification', 'executor');
      await independent.release();
    } finally {
      await rm(other, { recursive: true, force: true });
    }
    await writeFile(lease.file, '{"token":"foreign"}');
    await expect(lease.release()).rejects.toThrow('LEASE_OWNER_MISMATCH');
  });
  it('independent subprocess cannot acquire held worktree lease', async () => {
    const lease = await acquireLease(root, 'verification', 'executor');
    const module = pathToFileURL(
      path.join(path.dirname(import.meta.dirname), 'src/lib/local-store.ts'),
    ).href;
    try {
      const exit = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            '--conditions=source',
            '--input-type=module',
            '-e',
            `import {acquireLease} from ${JSON.stringify(module)}; try { await acquireLease(${JSON.stringify(root)},'verification','other'); process.exitCode=4; } catch(e) { process.exitCode=e.message.includes('LOCK_BUSY')?0:5; }`,
          ],
          { stdio: 'ignore' },
        );
        child.once('error', reject);
        child.once('exit', resolve);
      });
      expect(exit).toBe(0);
    } finally {
      await lease.release();
    }
  });
  it('two managed check processes cannot run the same worktree resource concurrently', async () => {
    const configured = {
      ...packet,
      checks: {
        ...packet.checks,
        targeted: {
          argv: [
            'node',
            '-e',
            'const fs=require("node:fs");fs.writeFileSync(".oc3/reports/fixture/check-started","synthetic");const t=setInterval(()=>{if(fs.existsSync(".oc3/reports/fixture/release")){clearInterval(t);process.exit(0)}},10)',
          ],
          cwd: '.',
          timeout_ms: 10000,
        },
      },
    };
    await put('.oc3/reports/fixture/task-packet.json', JSON.stringify(configured));
    const module = pathToFileURL(
      path.join(path.dirname(import.meta.dirname), 'src/lib/task-gates.ts'),
    ).href;
    const worker = () =>
      new Promise<{ code: number | null; error: string }>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            '--conditions=source',
            '--input-type=module',
            '-e',
            `import {loadTaskPacket,verifyTask} from ${JSON.stringify(module)};try{const p=await loadTaskPacket(${JSON.stringify(root)},'.oc3/reports/fixture/task-packet.json');const r=await verifyTask(${JSON.stringify(root)},p,'targeted','executor');process.exitCode=r.status==='pass'?0:2;}catch(e){console.error(e.message);process.exitCode=1}`,
          ],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let error = '';
        child.stderr.on('data', (chunk: Buffer) => {
          error += chunk.toString();
        });
        child.once('error', reject);
        child.once('exit', (code) => resolve({ code, error }));
      });
    let dispose: () => void = () => undefined;
    const started = new Promise<void>((resolve, reject) => {
      const watcher = watch(path.join(root, '.oc3/reports/fixture'), (_event, name) => {
        if (name === 'check-started') {
          clearTimeout(timer);
          watcher.close();
          resolve();
        }
      });
      const timer = setTimeout(() => {
        watcher.close();
        reject(new Error('check did not start'));
      }, 5000);
      dispose = () => {
        clearTimeout(timer);
        watcher.close();
      };
    });
    const first = worker();
    try {
      await started;
      const second = await worker();
      expect(second.code).toBe(1);
      expect(second.error).toContain('LOCK_BUSY');
    } finally {
      dispose();
      await put('.oc3/reports/fixture/release', 'release');
    }
    expect((await first).code).toBe(0);
  }, 20000);
  it('declared generated outputs have a producer binding and are still validated by content', async () => {
    const generated = {
      ...packet,
      launch_inputs: [...packet.launch_inputs, '.oc3/reports/generated/output.js'],
      classification: [
        ...packet.classification,
        { path: '.oc3/reports/generated/**', class: 'generated', owner: 'executor' },
      ],
      checks: {
        ...packet.checks,
        targeted: {
          argv: [
            'node',
            '-e',
            'const fs=require("node:fs");fs.mkdirSync(".oc3/reports/generated",{recursive:true});fs.writeFileSync(".oc3/reports/generated/output.js","synthetic output")',
          ],
          cwd: '.',
          outputs: ['.oc3/reports/generated/output.js'],
        },
      },
    };
    const configured = taskPacketOf(generated);
    expect((await verifyTask(root, configured, 'targeted', 'executor'))['status']).toBe('pass');
    const before = await taskSnapshot(root, configured);
    await put('.oc3/reports/generated/output.js', 'tampered output');
    expect((await taskSnapshot(root, configured)).fingerprint).toBe(before.fingerprint);
    await expect(currentCheck(root, configured, 'targeted')).rejects.toThrow('STALE_OUTPUT');
  });
  it('an exited lease owner is not stolen; explicit exact-token recovery is required', async () => {
    const module = pathToFileURL(
      path.join(path.dirname(import.meta.dirname), 'src/lib/local-store.ts'),
    ).href;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--conditions=source',
          '--input-type=module',
          '-e',
          `import {acquireLease} from ${JSON.stringify(module)}; await acquireLease(${JSON.stringify(root)},'verification','executor');`,
        ],
        { stdio: 'ignore' },
      );
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('lease fixture failed')),
      );
    });
    await expect(acquireLease(root, 'verification', 'executor')).rejects.toThrow('LOCK_BUSY');
    const record = await readJson(path.join(root, '.oc3/locks/verification.json'));
    if (!isRecord(record) || typeof record['token'] !== 'string') throw new Error('lease missing');
    await expect(recoverLease(root, 'verification', 'wrong-token', 'executor')).rejects.toThrow(
      'OWNER_MISMATCH',
    );
    await recoverLease(root, 'verification', record['token'], 'executor');
    const next = await acquireLease(root, 'verification', 'executor');
    await expect(recoverLease(root, 'verification', next.token, 'executor')).rejects.toThrow(
      'OWNER_ALIVE',
    );
    await next.release();
  });
  it('query hygiene rejects empty durable sidecars and undeclared ignored managed outputs without cleanup', async () => {
    packet = {
      ...packet,
      managed_areas: ['.oc3/locks'],
      classification: [
        ...packet.classification,
        {
          path: '.oc3/.delta/.accepted.json',
          class: 'runtime',
          owner: 'runtime',
          disposition: 'retire',
        },
      ],
    };
    await put('.oc3/reports/fixture/docs-proof.json', '{"approved":"no-docs-needed fixture"}');
    await verifyTask(root, packet, 'targeted', 'executor');
    await attestTaskPhase(root, packet, 'code-source-stable', 'executor', []);
    await attestTaskPhase(root, packet, 'docs-derived', 'librarian', [
      '.oc3/reports/fixture/docs-proof.json',
    ]);
    await verifyTask(root, packet, 'full', 'executor');
    await put('.oc3/verdicts/runs/fixture/1.yml', 'P1: true');
    await recordTaskAcceptance(root, packet, 'judge', { P1: true }, [
      '.oc3/verdicts/runs/fixture/1.yml',
    ]);
    await put('.oc3/reports/fixture/reports/empty.json', '{}');
    await expect(taskReady(root, packet)).rejects.toThrow('HYGIENE_EMPTY');
    expect(await readFile(path.join(root, '.oc3/reports/fixture/reports/empty.json'), 'utf8')).toBe(
      '{}',
    );
    await rm(path.join(root, '.oc3/reports/fixture/reports/empty.json'));
    await put('.oc3/locks/delta-accepted.json', '{"version":1}');
    await expect(taskReady(root, packet)).rejects.toThrow('HYGIENE_STALE_LEDGER');
    await rm(path.join(root, '.oc3/locks/delta-accepted.json'));
    await put('.oc3/locks/unknown.cache', 'synthetic cache');
    await expect(taskReady(root, packet)).rejects.toThrow('HYGIENE_UNKNOWN_RUNTIME');
    expect(await readFile(path.join(root, '.oc3/locks/unknown.cache'), 'utf8')).toBe(
      'synthetic cache',
    );
    await rm(path.join(root, '.oc3/locks/unknown.cache'));
    expect((await taskReady(root, packet)).ready).toBe(true);
  });
  it('source and authority hashes are content bound, not mtimes', async () => {
    const before = await taskSnapshot(root, packet);
    await put('DoD.md', 'different approved criteria');
    expect((await taskSnapshot(root, packet)).fingerprint).not.toBe(before.fingerprint);
    expect(await contentHash(root, 'source.ts')).not.toBeNull();
  });
});
