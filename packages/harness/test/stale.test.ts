import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '@shahimat/cli';
import { createSession, listSessions, machineFile } from '#harnesses/core/index';
import type { Session } from '#harnesses/core/index';

const DAY = 86_400_000;

let root: string;
let home: string;
let out: string[];

const makeSession = async (harness: string, title: string, at: Date): Promise<Session> => {
  const s = await createSession(home, {
    harness,
    title,
    request: '',
    project: root,
    initial: 'apply',
    now: at,
  });
  await writeFile(
    s.file('log.jsonl'),
    `${JSON.stringify({ at: at.toISOString(), event: 'start' })}\n`,
    'utf8',
  );
  return s;
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'stale-'));
  await mkdir(path.join(root, '.opencode'));
  home = await mkdtemp(path.join(tmpdir(), 'stale-home-'));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.join(' '));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe('docs-delta: протухшие сессии реестра', () => {
  it('list --stale: протухшие своего harness с возрастом; свежие и чужие не показываются', async () => {
    const old = await makeSession('docs-delta', 'delta', new Date(Date.now() - 8 * DAY));
    const fresh = await makeSession('docs-delta', 'другая', new Date());
    const foreign = await makeSession('ticket-work', 'job', new Date(Date.now() - 8 * DAY));
    expect(
      await main(['docs-delta', 'list', '--stale', '--root', root, '--home', home], new Date()),
    ).toBe(0);
    const text = out.join('\n');
    expect(text).toContain(old.short);
    expect(text).toContain('8 д');
    expect(text).not.toContain(fresh.short);
    expect(text).not.toContain(foreign.short);
  });

  it('--days двигает порог: 30 дней — протухших нет, 0 дней — даже свежая', async () => {
    const old = await makeSession('docs-delta', 'delta', new Date(Date.now() - 8 * DAY));
    const fresh = await makeSession('docs-delta', 'другая', new Date());
    const run = (...extra: string[]) =>
      main(['docs-delta', 'list', '--stale', '--root', root, '--home', home, ...extra], new Date());
    out.length = 0;
    expect(await run('--days', '30')).toBe(0);
    expect(out.join('\n')).not.toContain(old.short);
    out.length = 0;
    expect(await run('--days', '0')).toBe(0);
    const text = out.join('\n');
    expect(text).toContain(old.short);
    expect(text).toContain(fresh.short);
    out.length = 0;
    await expect(run('--days', 'нет')).rejects.toThrow('--days — число дней');
  });

  it('open --forget: снимает сессию с учёта — каталог реестра удалён', async () => {
    const old = await makeSession('docs-delta', 'delta', new Date(Date.now() - 8 * DAY));
    expect(
      await main(
        ['docs-delta', 'open', old.short, '--forget', '--root', root, '--home', home],
        new Date(),
      ),
    ).toBe(0);
    expect(out.join('\n')).toContain(`снята сессия ${old.short}`);
    expect(existsSync(old.dir)).toBe(false);
    expect((await listSessions(home)).map((s) => s.id)).not.toContain(old.id);
  });

  it('--forget отказывает, пока сессия исполняет роль', async () => {
    const s = await makeSession('docs-delta', 'delta', new Date());
    await mkdir(machineFile(home, 'slots'), { recursive: true });
    await writeFile(
      machineFile(home, 'slots', 'jobs-0.json'),
      JSON.stringify({
        pid: process.pid,
        token: 't',
        role: 'librarian',
        project: root,
        job: s.short,
        started: new Date().toISOString(),
        transcript: '',
      }),
      'utf8',
    );
    await expect(
      main(['docs-delta', 'open', s.short, '--forget', '--root', root, '--home', home], new Date()),
    ).rejects.toThrow('исполняет роль librarian');
    expect(existsSync(s.dir)).toBe(true);
  });
});
