import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { artifactPath } from '@shahimat/ai-core';
import { type Session, createSession, openSession } from '#harnesses/core/store/session';
import {
  addFeedback,
  ask,
  jobFile,
  jobLog,
  pending,
  takeFeedback,
  markExternal,
} from '#harnesses/core/ops/jobs';
import { jobDir, jobFileAt, projectFile, machineFile, watchFile } from '#harnesses/core/ops/paths';
import { addWatch, listWatches, stopWatch } from '#harnesses/core/ops/watches';
import { emit, readEvents, writeCursor } from '#harnesses/core/ops/events';
import { loadRegistry, saveRegistry } from '#harnesses/core/ops/machine';
import { progressTo } from '#harnesses/core/process';
import { readPlannerEvents } from '#harnesses/plan-review/actions';

let base: string;
let root: string;
let home: string;
let outside: string;
let session: Session;
it('progress callback resolves the actual final job leaf on each append', async () => {
  await mkdir(jobDir(root, session.short), { recursive: true });
  const progress = progressTo(() => jobFile(session, 'progress.log'));
  await symlink(path.join(outside, 'sentinel'), jobFile(session, 'progress.log'));
  expect(() => progress('bad')).toThrow('ARTIFACT_SYMLINK');
  await sentinel();
});
it('planner event reader rejects final symlinks and wrong kind before reading', async () => {
  const file = artifactPath(root, { kind: 'bridge', key: 'synthetic', name: 'events.jsonl' });
  await mkdir(path.dirname(file), { recursive: true });
  await symlink(path.join(outside, 'sentinel'), file);
  await expect(readPlannerEvents(file, 0, root)).rejects.toThrow('ARTIFACT_SYMLINK');
  await expect(readPlannerEvents(path.join(outside, 'sentinel'), 0, root)).rejects.toThrow();
  await rm(file);
  await writeFile(file, '{}\n');
  expect((await readPlannerEvents(file, 0, root)).next).toBe(1);
  await sentinel();
});
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ops-confinement-'));
  root = path.join(base, 'project');
  home = path.join(base, 'machine');
  outside = path.join(base, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await writeFile(path.join(outside, 'sentinel'), 'unchanged');
  session = await createSession(home, {
    harness: 'ticket-work',
    project: root,
    title: 'synthetic',
    request: 'synthetic',
    initial: 'ready',
    now: new Date(0),
  });
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});
async function sentinel(): Promise<void> {
  expect(await readdir(outside)).toEqual(['sentinel']);
  expect(await readFile(path.join(outside, 'sentinel'), 'utf8')).toBe('unchanged');
}
it('actual compiled addFeedback rejects the D2 traversal and writes valid legacy keys', async () => {
  const script = `import {addFeedback} from './dist/harnesses/core/ops/jobs.js';
    let rejected=false;try{await addFeedback(process.argv[1],'../../../escaped','synthetic');}catch{rejected=true;}
    if(!rejected)throw Error('traversal accepted');
    await addFeedback(process.argv[1],'abc1234','valid');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, root], {
    encoding: 'utf8',
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(await readFile(jobFileAt(root, 'abc1234', 'feedback.md'), 'utf8')).toContain('valid');
  expect(await readdir(base)).toEqual(['machine', 'outside', 'project']);
  await sentinel();
});
it('job feedback/state/logs and watch state preserve valid behavior', async () => {
  await addFeedback(root, session.short, 'feedback');
  expect(await takeFeedback(session)).toBe('feedback');
  await ask(session, ['question']);
  expect(await pending(session)).toEqual({ state: 'ready', questions: ['question'] });
  await jobLog(session, 'log');
  expect(await readFile(jobFile(session, 'log.md'), 'utf8')).toContain('log');
  const watch = await addWatch(
    root,
    { iface: 'review', query: '123', every: 5, job: session.short },
    new Date(0),
  );
  expect(await listWatches(root)).toEqual([watch]);
  expect(await stopWatch(root, watch.id)).toBe(true);
  await emit(home, root, 'done', 'event', session.short);
  expect((await readEvents(home, 0)).events).toHaveLength(1);
  await sentinel();
});
it.each(['../../../outside', '../outside', '/outside', 'a/b', 'a\\b', '..'])(
  'job/watch keys and leaves reject %s before writes or reads',
  async (key) => {
    await expect(addFeedback(root, key, 'bad')).rejects.toThrow();
    await expect(markExternal(root, key, 'bad')).rejects.toThrow();
    expect(() => jobDir(root, key)).toThrow();
    await expect(
      addWatch(root, { iface: 'review', query: '123', every: 5, job: key }, new Date(0)),
    ).rejects.toThrow();
    await expect(stopWatch(root, key)).rejects.toThrow();
    expect(() => writeCursor(home, key, 0)).toThrow();
    await sentinel();
  },
);
it.each(['../../../outside', '../outside', '/outside', '..'])('leaves reject %s', async (leaf) => {
  expect(() => jobFileAt(root, session.short, leaf)).toThrow();
  expect(() => machineFile(home, leaf)).toThrow();
  await sentinel();
});
it.each([
  { leaf: 'feedback.md', run: async () => addFeedback(root, session.short, 'bad') },
  { leaf: 'feedback.md', run: async () => takeFeedback(session) },
  { leaf: 'questions.json', run: async () => ask(session, ['bad']) },
  { leaf: 'questions.json', run: async () => pending(session) },
  { leaf: 'log.md', run: async () => jobLog(session, 'bad') },
  { leaf: 'events.jsonl', run: async () => jobLog(session, 'bad') },
])('job reader/writer rejects final symlink %s', async ({ leaf, run }) => {
  await mkdir(jobDir(root, session.short), { recursive: true });
  await symlink(path.join(outside, 'sentinel'), path.join(jobDir(root, session.short), leaf));
  await expect(run()).rejects.toThrow('ARTIFACT_SYMLINK');
  await sentinel();
});
it.each([
  { area: 'jobs', run: async () => addFeedback(root, session.short, 'bad') },
  { area: 'jobs', run: async () => ask(session, ['bad']) },
  { area: 'jobs', run: async () => jobLog(session, 'bad') },
  { area: 'jobs', run: async () => pending(session) },
  {
    area: 'watches',
    run: async () => addWatch(root, { iface: 'review', query: '123', every: 5 }, new Date(0)),
  },
  { area: 'watches', run: async () => listWatches(root) },
  { area: 'reports', run: async () => projectFile(root, 'suggest', 'note.md') },
])('project parent symlink %s rejects actual APIs', async ({ area, run }) => {
  await mkdir(path.join(root, '.oc3'), { recursive: true });
  await symlink(outside, path.join(root, '.oc3', area));
  await expect(run()).rejects.toThrow('ARTIFACT_SYMLINK');
  await sentinel();
});
it('watch final symlink, record/filename mismatch and linked job traversal reject without writes', async () => {
  const watch = await addWatch(root, { iface: 'review', query: '123', every: 5 }, new Date(0));
  const file = watchFile(root, watch.id);
  await writeFile(file, `id: other\ninterface: review\nquery: '123'\nevery: 5\nnext: now\n`);
  await expect(listWatches(root)).rejects.toThrow('WATCH_ID_MISMATCH');
  await writeFile(
    file,
    `id: ${watch.id}\ninterface: review\nquery: '123'\nevery: 5\nnext: now\njob: ../../../outside\n`,
  );
  await expect(listWatches(root)).rejects.toThrow('ARTIFACT_ID_INVALID');
  await rm(file);
  await symlink(path.join(outside, 'sentinel'), file);
  await expect(listWatches(root)).rejects.toThrow('ARTIFACT_SYMLINK');
  await expect(
    addWatch(root, { iface: 'review', query: '123', every: 5 }, new Date(0)),
  ).rejects.toThrow('ARTIFACT_SYMLINK');
  await expect(stopWatch(root, watch.id)).rejects.toThrow('ARTIFACT_SYMLINK');
  await sentinel();
});
it('explicit machine readers/writers reject parent/final symlinks and session traversal', async () => {
  await mkdir(machineFile(home), { recursive: true });
  await symlink(path.join(outside, 'sentinel'), machineFile(home, 'projects.yml'));
  expect(() => saveRegistry(home, { v: 1, projects: [] })).toThrow('ARTIFACT_SYMLINK');
  await expect(loadRegistry(home)).rejects.toThrow('ARTIFACT_SYMLINK');
  await symlink(outside, machineFile(home, 'cursors'));
  expect(() => writeCursor(home, 'valid', 0)).toThrow('ARTIFACT_SYMLINK');
  await symlink(path.join(outside, 'sentinel'), machineFile(home, 'events.jsonl'));
  await expect(emit(home, root, 'done', 'bad')).rejects.toThrow('ARTIFACT_SYMLINK');
  await expect(readEvents(home, 0)).rejects.toThrow('ARTIFACT_SYMLINK');
  await expect(openSession(home, '../outside')).rejects.toThrow('ARTIFACT_ID_INVALID');
  await symlink(path.join(outside, 'sentinel'), session.file('result.json'));
  expect(() => session.file('result.json')).toThrow('ARTIFACT_SYMLINK');
  expect(() =>
    artifactPath(root, { kind: 'job', key: session.short }, { root: outside, worktree: root }),
  ).toThrow('ARTIFACT_SCOPE_MISMATCH');
  expect(() => projectFile(root, '../outside')).toThrow();
  await sentinel();
});
it('machine sessions remain anchored when a session parent is replaced by a symlink', async () => {
  const sessions = path.join(home, 'sessions');
  await rm(sessions, { recursive: true });
  await mkdir(path.join(outside, session.id));
  await symlink(outside, sessions);
  await expect(session.save()).rejects.toThrow('ARTIFACT_SYMLINK');
  await expect(session.log({ event: 'bad' })).rejects.toThrow('ARTIFACT_SYMLINK');
  await expect(openSession(home, session.id)).rejects.toThrow('ARTIFACT_SYMLINK');
  expect(await readdir(path.join(outside, session.id))).toEqual([]);
  await rm(path.join(outside, session.id), { recursive: true });
  await sentinel();
});
