import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '#cli';
import { openSession } from '#harnesses/core/store/session';
import { FAKE_CLAUDE } from './fake-claude.ts';

const NOW = new Date('2026-10-14T12:00:00Z');

let root: string;
let home: string;
let out: string[];

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
}

const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

async function project(): Promise<void> {
  await put('context/harness.yml', 'checks:\n  context-index: {}\n');
  await put('context/project.yml', 'name: demo\nnamespaces:\n  core: ядро\n');
  await put('context/conventions/naming.yml', 'key: naming\nsummary: kebab-case\nrule: x\n');
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
}

const sessionId = async (): Promise<string> =>
  (await readdir(path.join(home, 'sessions')))[0] ?? '';
const state = async (): Promise<string> => (await openSession(home, await sessionId())).data.state;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'harness-proc-'));
  await mkdir(path.join(root, '.claude'));
  home = await mkdtemp(path.join(tmpdir(), 'harness-proc-home-'));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe('harness refresh', () => {
  it('пересобирает context/index.yml и проверяет проект', async () => {
    await project();
    expect(await main(['refresh', '--root', root], NOW)).toBe(0);
    expect(existsSync(path.join(root, 'context/index.yml'))).toBe(true);
  });

  it('2 — нет harness.yml', async () => {
    await expect(main(['refresh', '--root', root], NOW)).rejects.toThrow(/harness\.yml/);
  });
});

describe('harness docs delta', () => {
  it('validate и graph: определение пригодно, Mermaid автомата', async () => {
    expect(await main(['docs-delta', 'validate', '--home', home], NOW)).toBe(0);
    expect(await main(['docs-delta', 'graph', '--home', home], NOW)).toBe(0);
    expect(out.join('\n')).toContain('apply --> verify');
  });

  it('start выдаёт задание; open проверяет, судья ревьюит, дельта закрывается', async () => {
    await project();
    await put(
      '.agents/agents/judge.md',
      '---\nname: judge\ndescription: Судья для теста процесса docs-delta\noutput: verdict\n---\n\nСудья.\n',
    );
    const fake = path.join(home, 'fake-claude.mjs');
    await writeFile(fake, FAKE_CLAUDE, 'utf8');
    vi.stubEnv('HARNESS_CLAUDE', fake);
    vi.stubEnv('FAKE_SUBMIT', JSON.stringify({ verdict: { conflicts: [] } }));
    const args = ['--root', root, '--home', home];
    expect(await main(['docs-delta', 'start', '--name', 'naming', ...args], NOW)).toBe(0);
    expect(await state()).toBe('apply');
    expect(out.join('\n')).toMatch(/context\/\.delta\/naming\.yml.*docs-delta open/);
    const short = (await sessionId()).slice(0, 7);
    out = [];
    expect(await main(['docs-delta', 'status', short.slice(0, 4), '--home', home], NOW)).toBe(0);
    expect(out.join('\n')).toContain(`сессия: ${short}`);
    expect(out.join('\n')).toContain('состояние: apply');

    await put(
      'context/.delta/naming.yml',
      'summary: s\nitems:\n  - op: add\n    kind: rule\n    target: other\n    summary: новое\n    evidence: e\n',
    );
    await put('context/conventions/other.yml', 'key: other\nsummary: новое\nrule: y\n');
    expect(await main(['docs-delta', 'open', await sessionId(), '--home', home], NOW)).toBe(0);
    expect(await state()).toBe('done');
    expect(existsSync(path.join(root, 'context/.delta/naming.yml'))).toBe(false);
    expect(existsSync(path.join(root, 'context/index.yml'))).toBe(true);
  });

  it('провал verify возвращает в apply, после трёх — failed; open из failed — снова apply', async () => {
    await project();
    const args = ['--root', root, '--home', home];
    expect(await main(['docs-delta', 'start', '--name', 'naming', ...args], NOW)).toBe(0);
    await put('context/conventions/naming.yml', 'key: naming\nsummary: snake_case\nrule: x\n');
    const id = await sessionId();
    for (let i = 0; i < 3; i++) {
      expect(await main(['docs-delta', 'open', id, '--home', home], NOW)).toBe(0);
      expect(await state()).toBe('apply');
    }
    expect(await main(['docs-delta', 'open', id, '--home', home], NOW)).toBe(0);
    expect(await state()).toBe('failed');
    expect(await main(['docs-delta', 'open', id, '--home', home], NOW)).toBe(0);
    expect(await state()).toBe('apply');
    const log = await readFile(path.join(home, 'sessions', id, 'log.jsonl'), 'utf8');
    expect(log).toContain('"to":"failed"');
  });
});

describe('harness source sync', () => {
  it('validate и graph', async () => {
    expect(await main(['source-sync', 'validate', '--home', home], NOW)).toBe(0);
    expect(await main(['source-sync', 'graph', '--home', home], NOW)).toBe(0);
    expect(out.join('\n')).toContain('update --> refresh');
  });

  it('start: версия без version — сведение пропускается, задание агенту; open — refresh', async () => {
    await project();
    expect(await main(['source-sync', 'start', '--root', root, '--home', home], NOW)).toBe(0);
    expect(await state()).toBe('update');
    const short = (await sessionId()).slice(0, 7);
    out = [];
    expect(await main(['source-sync', 'list', '--home', home], NOW)).toBe(0);
    expect(out).toEqual([`${short}\tupdate\tsync`]);
    expect(await main(['source-sync', 'status', short, '--home', home], NOW)).toBe(0);
    await expect(main(['docs-delta', 'status', short, '--home', home], NOW)).rejects.toThrow(
      'принадлежит source-sync',
    );
    expect(await main(['source-sync', 'open', await sessionId(), '--home', home], NOW)).toBe(0);
    expect(await state()).toBe('done');
    expect(existsSync(path.join(root, 'context/index.yml'))).toBe(true);
  });
});
