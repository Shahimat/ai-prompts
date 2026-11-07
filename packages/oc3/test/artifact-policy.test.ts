import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { main } from '#cli';
import { GITIGNORE_LINES } from '#templates';
import { docsGuard } from '#guards';
import { appendBridgeEvent } from '#plan-bridge';
import { submitResult } from '#submit';
import { ensureLock } from '#install';
import { ackPath, markBriefingAcked, isBriefingAcked } from '#briefing-gate';
let root: string;
it('install lock and briefing ack writers/readers reject parent and final symlinks', async () => {
  await put('sentinel', 'unchanged');
  await mkdir(path.join(root, '.oc3/locks'), { recursive: true });
  await symlink(path.join(root, 'sentinel'), path.join(root, '.oc3/locks/install'));
  await expect(ensureLock(root)).rejects.toThrow('ARTIFACT_SYMLINK');
  await mkdir(path.join(root, '.oc3/sessions'), { recursive: true });
  await symlink(path.join(root, 'sentinel'), path.join(root, '.oc3/sessions/ses_probe.briefing'));
  await expect(markBriefingAcked(root, 'ses_probe', new Date(0))).rejects.toThrow(
    'ARTIFACT_SYMLINK',
  );
  expect(() => isBriefingAcked(root, 'ses_probe')).toThrow('ARTIFACT_SYMLINK');
  expect(() => ackPath(root, '../probe')).toThrow('ARTIFACT_ID_INVALID');
  await rm(path.join(root, '.oc3/sessions'), { recursive: true });
  await symlink(path.join(root, '.oc3/locks'), path.join(root, '.oc3/sessions'));
  await expect(markBriefingAcked(root, 'ses_probe', new Date(0))).rejects.toThrow(
    'ARTIFACT_SYMLINK',
  );
  expect(await readFile(path.join(root, 'sentinel'), 'utf8')).toBe('unchanged');
});
async function put(file: string, text: string) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oc3-artifact-policy-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
it('retention ignores execution kinds without hiding semantic cache, canonical knowledge, goals or inbox', async () => {
  spawnSync('git', ['init', '-q'], { cwd: root });
  await put('.gitignore', GITIGNORE_LINES.join('\n') + '\n');
  for (const file of [
    '.oc3/reports/task/proof.json',
    '.oc3/research/task/draft.md',
    '.oc3/verdicts/runs/task/1.json',
    '.oc3/sessions/s/raw.json',
  ]) {
    await put(file, 'synthetic');
    expect(spawnSync('git', ['check-ignore', '--', file], { cwd: root }).status).toBe(0);
  }
  for (const file of [
    '.oc3/knowledge/fact.md',
    '.oc3/goals/a.expect.ts',
    '.oc3/goals/a.expect.json',
    '.oc3/inbox/knowledge/project.json',
    '.oc3/verdicts/expect/key/verdicts.json',
  ]) {
    await put(file, 'synthetic');
    expect(spawnSync('git', ['check-ignore', '--', file], { cwd: root }).status).toBe(1);
  }
});
it('real migrate CLI dispatch preserves historical bytes and leaves the staged index untouched', async () => {
  spawnSync('git', ['init', '-q'], { cwd: root });
  await put('.ops/demo/checks/full.json', '{"historical":"pass","snapshot":"old"}\n');
  spawnSync('git', ['add', '.'], { cwd: root });
  const index = spawnSync('git', ['ls-files', '--stage', '-z'], { cwd: root }).stdout;
  expect(await main(['migrate', '--root', root])).toBe(0);
  expect(
    await readFile(
      path.join(root, '.oc3/reports/artifact-history/ops/demo/checks/full.json'),
      'utf8',
    ),
  ).toBe('{"historical":"pass","snapshot":"old"}\n');
  expect(spawnSync('git', ['ls-files', '--stage', '-z'], { cwd: root }).stdout.equals(index)).toBe(
    true,
  );
  expect(await main(['migrate', '--root', root])).toBe(0);
});
it('all agents including librarian are denied external namespaces and symlink escapes', async () => {
  for (const agent of ['librarian', 'executor', 'judge'])
    for (const file of [
      '.ops/new/report.json',
      'arbitrary/.judge/plan.json',
      'arbitrary/.verdicts.json',
      'arbitrary/a.expect.json',
      '.opencode/artifacts/bridge.json',
    ])
      expect(await docsGuard(agent, [file], root)).toContain('artifact namespace');
  await mkdir(path.join(root, '.oc3'), { recursive: true });
  await symlink(tmpdir(), path.join(root, '.oc3/reports'));
  expect(await docsGuard('librarian', ['.oc3/reports/escape.json'], root)).toContain(
    'artifact namespace',
  );
});
it('native bridge cannot append an external or foreign-scope events file', async () => {
  await expect(
    appendBridgeEvent(
      {
        root,
        events: path.join(root, 'external/events.jsonl'),
        plan: 'a.expect.ts',
        report: 'synthetic',
      },
      { kind: 'prompt' },
    ),
  ).rejects.toThrow('ARTIFACT_NAMESPACE');
});
it('historical archives cannot be edited through role tools, even by librarian', async () => {
  expect(
    await docsGuard('librarian', ['.oc3/reports/artifact-history/external/old.json'], root),
  ).toContain('runtime-owned immutable history');
});
it('raw traversal and absolute canonical paths do not bypass namespace/docs guards', async () => {
  expect(await docsGuard('executor', ['.oc3/reports/../knowledge/fact.md'], root)).toContain(
    'artifact namespace',
  );
  expect(await docsGuard('executor', [path.join(root, '.oc3/knowledge/fact.md')], root)).toContain(
    'docs guard',
  );
});
it('native submission override rejects external and symlink destinations rather than publishing them', async () => {
  await put(
    'agents/executor.md',
    '---\nname: executor\ndescription: synthetic\noutput: result\n---\nSynthetic role\n',
  );
  const call = {
    root,
    agent: 'executor',
    sessionID: 'ses_synthetic',
    input: {
      message: 'result',
      data: { status: 'done', changed: [], failed: [], questions: [], report: 'synthetic' },
    },
  };
  vi.stubEnv('HARNESS_SUBMIT_OUT', path.join(tmpdir(), 'forbidden-artifact-layout-output.json'));
  await expect(submitResult(call)).rejects.toThrow('ARTIFACT_PATH_INVALID');
  await mkdir(path.join(root, '.oc3/submit'), { recursive: true });
  await symlink(path.join(root, 'missing'), path.join(root, '.oc3/submit/answer.json'));
  vi.stubEnv('HARNESS_SUBMIT_OUT', path.join(root, '.oc3/submit/answer.json'));
  await expect(submitResult(call)).rejects.toThrow('ARTIFACT_SYMLINK');
});
