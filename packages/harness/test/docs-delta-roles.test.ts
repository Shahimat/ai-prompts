import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '@shahimat/cli';
import { openSession } from '#harnesses/core/store/session';
import { isRecord } from '@shahimat/ai-core';
import { FAKE_CLAUDE } from './fake-claude.ts';

const NOW = new Date('2026-10-28T12:00:00Z');

const RESULT = {
  status: 'done',
  changed: [],
  failed: [],
  questions: [],
  report: 'отчёт docs-keeper',
};

let root: string;
let home: string;
let fake: string;
const ENV = ['HARNESS_CLAUDE', 'FAKE_SUBMIT', 'FAKE_ARGS', 'FAKE_FILES'];
let saved: [string, string | undefined][];

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
}

const roleFile = (name: string, output: string, extra = ''): string =>
  `---\nname: ${name}\ndescription: Тестовая роль ${name} для проверки harness\n${extra}output: ${output}\n---\n\nИнструкции роли ${name}.\n`;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'harness-role-'));
  await mkdir(path.join(root, '.claude'));
  home = await mkdtemp(path.join(tmpdir(), 'harness-role-home-'));
  fake = path.join(home, 'fake-claude.mjs');
  await writeFile(fake, FAKE_CLAUDE, 'utf8');
  saved = ENV.map((k) => [k, process.env[k]]);
  process.env['HARNESS_CLAUDE'] = fake;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe('docs-delta: роли docs-keeper и judge', () => {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const DELTA =
    'summary: s\nitems:\n  - op: add\n    kind: rule\n    target: other\n    summary: новое\n    evidence: e\n';
  const KEEPER_FILES = {
    'context/.delta/naming.yml': DELTA,
    'context/conventions/other.yml': 'key: other\nsummary: snake_case\nrule: y\n',
  };
  const CONFLICT = {
    file_a: 'context/conventions/other.yml',
    quote_a: 'summary: snake_case',
    file_b: 'context/conventions/naming.yml',
    quote_b: 'summary: kebab-case',
    reason: 'два правила именования',
  };

  async function project(): Promise<void> {
    await put('context/ai-core.yml', 'checks:\n  context-index: {}\n');
    await put('context/project.yml', 'name: demo\nnamespaces:\n  core: ядро\n');
    await put('context/conventions/naming.yml', 'key: naming\nsummary: kebab-case\nrule: x\n');
    await put('.agents/agents/docs-keeper.md', roleFile('docs-keeper', 'result'));
    await put('.agents/agents/judge.md', roleFile('judge', 'verdict'));
    await put('intents.yml', '- kind: rule\n  summary: новое\n  evidence: e\n');
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  }

  const session = async () => {
    const id = (await readdir(path.join(home, 'sessions')))[0] ?? '';
    return openSession(home, id);
  };

  const calls = async (): Promise<{ message: string; prompt: string }[]> =>
    (await readFile(path.join(home, 'args.jsonl'), 'utf8'))
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => {
        const v: unknown = JSON.parse(l);
        return isRecord(v) && typeof v['message'] === 'string' && typeof v['prompt'] === 'string'
          ? { message: v['message'], prompt: v['prompt'] }
          : { message: '', prompt: '' };
      });

  const start = (...extra: string[]) =>
    main(
      ['docs-delta', 'start', '--name', 'naming', '--root', root, '--home', home, ...extra],
      NOW,
    );

  beforeEach(() => {
    process.env['FAKE_ARGS'] = path.join(home, 'args.jsonl');
    process.env['FAKE_FILES'] = JSON.stringify(KEEPER_FILES);
  });

  it('start --file: намерения по схеме хранятся в сессии; apply — docs-keeper, review — judge по изменённым файлам', async () => {
    await project();
    process.env['FAKE_SUBMIT'] = JSON.stringify({ result: RESULT, verdict: { conflicts: [] } });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      lines.push(a.join(' '));
    });
    expect(await start('--file', 'intents.yml')).toBe(0);
    const s = await session();
    expect(s.data.state).toBe('done');
    expect(lines).toContain(RESULT.report);
    expect(JSON.parse(s.data.request)).toEqual({
      intents: [{ kind: 'rule', summary: 'новое', evidence: 'e' }],
    });
    const [keeper, judge] = await calls();
    expect(keeper?.message).toBe('result');
    expect(keeper?.prompt).toContain('"summary":"новое"');
    expect(judge?.message).toBe('verdict');
    expect(judge?.prompt).toContain('- context/conventions/other.yml');
    expect(judge?.prompt).toContain('target: other');
  });

  it('намерения не по схеме intents — start отказывает и сессию не создаёт', async () => {
    await project();
    await put('bad.yml', '- kind: idea\n  summary: x\n');
    await expect(start('--file', 'bad.yml')).rejects.toThrow('не по схеме intents');
    expect(existsSync(path.join(home, 'sessions'))).toBe(false);
  });

  it('противоречие с дословными цитатами — возврат в apply с находками судьи, после трёх — failed', async () => {
    await project();
    process.env['FAKE_SUBMIT'] = JSON.stringify({
      result: RESULT,
      verdict: { conflicts: [CONFLICT] },
    });
    expect(await start('--file', 'intents.yml')).toBe(0);
    expect((await session()).data.state).toBe('failed');
    const keepers = (await calls()).filter((c) => c.message === 'result');
    expect(keepers).toHaveLength(4);
    expect(keepers[1]?.prompt).toContain('судья нашёл противоречия');
    expect(keepers[1]?.prompt).toContain('«summary: kebab-case»');
  });

  it('противоречие без дословной цитаты отклоняется — правка проходит', async () => {
    await project();
    process.env['FAKE_SUBMIT'] = JSON.stringify({
      result: RESULT,
      verdict: { conflicts: [{ ...CONFLICT, quote_b: 'summary: camelCase' }] },
    });
    expect(await start('--file', 'intents.yml')).toBe(0);
    expect((await session()).data.state).toBe('done');
  });

  it('роль не вернула результат — пауза в apply с заданием и намерениями для ручного handoff', async () => {
    await project();
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      lines.push(a.join(' '));
    });
    expect(await start('--file', 'intents.yml')).toBe(0);
    expect((await session()).data.state).toBe('apply');
    expect(lines.join('\n')).toMatch(/роль docs-keeper: .*не вернула результат.*docs-delta open/s);
    expect(lines.join('\n')).toContain('Намерения: {"intents"');
  });
});
