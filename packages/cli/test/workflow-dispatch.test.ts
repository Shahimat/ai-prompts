import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authorityHash,
  loadTaskPacket,
  pendingKnowledge,
  recordTaskAcceptance,
} from '@shahimat/ai-core';
import { main, run } from '#cli';

let root: string;
let stdout: string[];
async function put(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}
function git(...args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('synthetic Git fixture failed');
  return result.stdout.trim();
}
const packetFile = '.oc3/reports/dispatch/task-packet.json';
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'workflow-cli-dispatch-'));
  stdout = [];
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    stdout.push(parts.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function fixture(): Promise<void> {
  await put('source.ts', 'export const synthetic = true;\n');
  await put('DoD.md', 'Synthetic approved criterion P1\n');
  await put('package.json', '{"engines":{"node":">=24"}}');
  await put('package-lock.json', '{}');
  await put('.gitignore', '.oc3/locks/\n.oc3/bundles/\n');
  await put('.oc3/project.yml', 'runtime: full\n');
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
  const authority = {
    file: 'DoD.md',
    digest: '',
    criteria: { P1: 'Synthetic approved criterion' },
  };
  authority.digest = await authorityHash(root, { authority });
  await put(
    packetFile,
    JSON.stringify({
      version: 1,
      ticket: 'dispatch',
      project_root: '.',
      baseline_head: git('rev-parse', 'HEAD'),
      authority,
      scope: { included: ['synthetic dispatch'], excluded: ['external writes'] },
      repair_budget: {
        ordinary_attempts: 3,
        identical_failure_without_new_diagnosis: 2,
        existing_fsm_limits_take_precedence: true,
      },
      owners: {
        code: 'executor',
        source: 'operator',
        docs: 'librarian',
        verification: 'executor',
        acceptance: 'judge',
      },
      checks: {
        targeted: {
          argv: [
            'node',
            '-e',
            'require("node:fs").writeFileSync(".oc3/reports/dispatch/executed.json",JSON.stringify({synthetic:true}))',
          ],
          cwd: '.',
        },
        full: { argv: ['node', '-e', 'process.exit(0)'], cwd: '.' },
      },
      classification: [
        { path: '*.ts', class: 'source', owner: 'executor' },
        { path: '*.md', class: 'source', owner: 'operator' },
        { path: 'package*.json', class: 'source', owner: 'executor' },
        { path: '.gitignore', class: 'source', owner: 'executor' },
        { path: '.oc3/project.yml', class: 'source', owner: 'operator' },
        { path: '.oc3/reports/**', class: 'durable-evidence', owner: 'runtime' },
        { path: '.oc3/locks/**', class: 'runtime', owner: 'runtime' },
      ],
      fingerprint_excludes: [],
      prerequisites: ['package.json', 'package-lock.json'],
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
      phase_evidence: { 'docs-derived': ['.oc3/reports/dispatch/docs-confirmation.json'] },
    }),
  );
  await put(
    '.oc3/reports/dispatch/docs-confirmation.json',
    '{"approved":"synthetic no-docs-needed fixture"}',
  );
}

describe('workflow CLI dispatch', () => {
  it('memory inbox batch dispatch freezes a real CLI-enqueued bounded selection', async () => {
    await put(
      'input.json',
      JSON.stringify({
        knowledge_delta: [
          {
            subject: 'synthetic topic',
            property: 'pending',
            value: [1, true],
            kind: 'candidate',
            evidence: ['fixture:dispatch'],
          },
        ],
      }),
    );
    expect(await main(['memory', 'inbox', 'enqueue', '--file', 'input.json', '--root', root])).toBe(
      0,
    );
    const first = (await pendingKnowledge(root))[0];
    if (first === undefined) throw new Error('entry missing');
    await put(
      'selection.json',
      JSON.stringify({ subject: 'synthetic topic', scope: first.scope, limit: 1 }),
    );
    expect(
      await main(['memory', 'inbox', 'batch', '--file', 'selection.json', '--root', root]),
    ).toBe(0);
    const names = await readdir(path.join(root, '.oc3/inbox/knowledge/batches'));
    expect(names).toHaveLength(1);
    const batch: unknown = JSON.parse(
      await readFile(path.join(root, '.oc3/inbox/knowledge/batches', names[0] ?? ''), 'utf8'),
    );
    expect(batch).toMatchObject({ entries: [{ id: first.id, hash: first.hash }] });
    expect(stdout.at(-1)).toContain('docs-delta start --batch');
  });
  it('operator preflight dispatch validates packet and writes an actual receipt', async () => {
    await fixture();
    expect(await main(['operator', 'preflight', '--file', packetFile, '--root', root])).toBe(0);
    expect(
      JSON.parse(
        await readFile(path.join(root, '.oc3/reports/dispatch/checks/preflight.json'), 'utf8'),
      ),
    ).toMatchObject({ kind: 'preflight', ticket: 'dispatch' });
    expect(stdout.at(-1)).toContain('fingerprint');
  });
  it('operator verify <name> dispatch selects and executes the declared argv', async () => {
    await fixture();
    expect(
      await main(['operator', 'verify', 'targeted', '--file', packetFile, '--root', root]),
    ).toBe(0);
    expect(
      JSON.parse(await readFile(path.join(root, '.oc3/reports/dispatch/executed.json'), 'utf8')),
    ).toEqual({ synthetic: true });
    expect(
      JSON.parse(
        await readFile(path.join(root, '.oc3/reports/dispatch/checks/targeted.json'), 'utf8'),
      ),
    ).toMatchObject({
      name: 'targeted',
      status: 'pass',
      actor: 'operator/manual-cli',
      owner: 'executor',
    });
    expect(
      await run(['operator', 'verify', 'unknown-check', '--file', packetFile, '--root', root]),
    ).toBe(1);
  });
  it('operator ready dispatch enforces acceptance and is read-only on a successful synthetic pipeline', async () => {
    await fixture();
    for (const name of ['targeted', 'code-source-stable', 'docs-derived', 'full'])
      expect(await main(['operator', 'verify', name, '--file', packetFile, '--root', root])).toBe(
        0,
      );
    expect(await run(['operator', 'ready', '--file', packetFile, '--root', root])).toBe(1);
    await put('.oc3/reports/dispatch/verdict.json', '{"synthetic_criterion_P1":true}');
    const packet = await loadTaskPacket(root, packetFile);
    await recordTaskAcceptance(root, packet, 'judge', { P1: true }, [
      '.oc3/reports/dispatch/verdict.json',
    ]);
    const before = await readFile(
      path.join(root, '.oc3/reports/dispatch/checks/full.json'),
      'utf8',
    );
    expect(await main(['operator', 'ready', '--ticket', 'dispatch', '--root', root])).toBe(0);
    expect(stdout.at(-1)).toContain('"ready":true');
    expect(await readFile(path.join(root, '.oc3/reports/dispatch/checks/full.json'), 'utf8')).toBe(
      before,
    );
  }, 20000);
});
