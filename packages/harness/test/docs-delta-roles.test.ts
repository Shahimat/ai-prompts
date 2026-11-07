import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, prepare, run } from '@shahimat/cli';
import { openSession } from '#harnesses/core/store/session';
import {
  contentHash,
  enqueueKnowledge,
  isRecord,
  pendingKnowledge,
  prepareKnowledgeBatch,
} from '@shahimat/ai-core';
import { DOCS_DELTA } from '#harnesses/docs-delta/index';
import { FAKE_OPENCODE_ROLES } from './fake-opencode-roles.ts';

const NOW = new Date('2026-10-28T12:00:00Z');

const RESULT = {
  status: 'done',
  changed: [],
  failed: [],
  questions: [],
  report: 'отчёт librarian',
};

let root: string;
let home: string;
let fake: string;
const ENV = ['HARNESS_OPENCODE', 'FAKE_SUBMIT', 'FAKE_ARGS', 'FAKE_FILES'];
let saved: [string, string | undefined][];

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
}

const roleFile = (name: string, output: string, extra = ''): string =>
  `---\nname: ${name}\ndescription: Тестовая роль ${name} для проверки harness\n${extra}output: ${output}\n---\n\nИнструкции роли ${name}.\n`;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'harness-role-'));
  await mkdir(path.join(root, '.opencode'));
  home = await mkdtemp(path.join(tmpdir(), 'harness-role-home-'));
  fake = path.join(home, 'fake-opencode.mjs');
  await writeFile(fake, FAKE_OPENCODE_ROLES, 'utf8');
  saved = ENV.map((k) => [k, process.env[k]]);
  process.env['HARNESS_OPENCODE'] = fake;
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

describe('docs-delta: роли librarian и judge', () => {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const DELTA =
    'summary: s\nitems:\n  - op: add\n    kind: rule\n    target: other\n    summary: новое\n    evidence: e\n';
  const KEEPER_FILES = {
    '.oc3/.delta/naming.yml': DELTA,
    '.oc3/conventions/other.yml': 'key: other\nsummary: snake_case\nrule: y\n',
  };
  const CONFLICT = {
    file_a: '.oc3/conventions/other.yml',
    quote_a: 'summary: snake_case',
    file_b: '.oc3/conventions/naming.yml',
    quote_b: 'summary: kebab-case',
    reason: 'два правила именования',
  };

  async function project(): Promise<void> {
    await put('.oc3/ai-core.yml', 'checks:\n  context: {}\n');
    await put('.oc3/project.yml', 'name: demo\nnamespaces:\n  core: ядро\n');
    await put('.oc3/conventions/naming.yml', 'key: naming\nsummary: kebab-case\nrule: x\n');
    await put('.agents/agents/librarian.md', roleFile('librarian', 'result'));
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

  const calls = async (): Promise<{ role: string; prompt: string }[]> =>
    (await readFile(path.join(home, 'args.jsonl'), 'utf8'))
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => {
        const v: unknown = JSON.parse(l);
        return isRecord(v) && typeof v['role'] === 'string' && typeof v['prompt'] === 'string'
          ? { role: v['role'], prompt: v['prompt'] }
          : { role: '', prompt: '' };
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

  it('explicit frozen batch uses one librarian/review/close and acknowledges exact IDs, not later arrivals', async () => {
    await project();
    await put('.oc3/reports/fixture/expected.yml', KEEPER_FILES['.oc3/conventions/other.yml']);
    const canonicalHash = await contentHash(root, '.oc3/reports/fixture/expected.yml');
    await enqueueKnowledge(
      { root, actor: 'executor', channel: 'fixture', execution: 'initial' },
      ['A', 'B'].map((value) => ({
        subject: 'topic',
        property: 'pending',
        value,
        kind: 'candidate',
        evidence: ['fixture:initial'],
      })),
    );
    const first = (await pendingKnowledge(root))[0];
    if (first === undefined) throw new Error('entry missing');
    const batch = await prepareKnowledgeBatch(root, {
      subject: 'topic',
      scope: first.scope,
      limit: 32,
    });
    await prepare(['--root', root]);
    const s = await DOCS_DELTA.start({ root, home, name: 'naming', batch: batch.id, now: NOW });
    const dispositions = batch.entries.map((entry) => ({
      id: entry.id,
      hash: entry.hash,
      status: 'applied',
      target: '.oc3/conventions/other.yml',
      content_hash: canonicalHash,
      reason: 'synthetic verified consolidation',
      evidence: ['.oc3/conventions/other.yml'],
    }));
    process.env['FAKE_FILES'] = JSON.stringify({
      ...KEEPER_FILES,
      [path.join('.oc3/reports/docs-proposals', s.short, 'dispositions.json')]:
        JSON.stringify(dispositions),
    });
    process.env['FAKE_SUBMIT'] = JSON.stringify({
      librarian: {
        ...RESULT,
        knowledge_delta: [
          {
            subject: 'topic',
            property: 'pending',
            value: 'C',
            kind: 'candidate',
            evidence: ['fixture:later'],
          },
        ],
      },
      judge: { conflicts: [] },
    });
    await DOCS_DELTA.drive(s, home);
    expect(s.data.state).toBe('done');
    expect((await pendingKnowledge(root)).map((entry) => entry.item.value)).toEqual(['C']);
    expect((await calls()).map((call) => call.role)).toEqual(['librarian', 'judge']);
    expect(
      existsSync(path.join(root, '.oc3/inbox/knowledge/resolutions', `${batch.id}.json`)),
    ).toBe(true);
    expect(existsSync(path.join(root, '.oc3/.delta/naming.yml'))).toBe(false);
  });

  it('start --file: намерения по схеме хранятся в сессии; apply — librarian, review — judge по изменённым файлам', async () => {
    await project();
    process.env['FAKE_SUBMIT'] = JSON.stringify({ librarian: RESULT, judge: { conflicts: [] } });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      lines.push(a.join(' '));
    });
    expect(await start('--file', 'intents.yml')).toBe(0);
    const s = await session();
    expect(s.data.state).toBe('done');
    expect(lines).not.toContain(RESULT.report);
    expect(await readFile((await session()).file('log.jsonl'), 'utf8')).toContain(RESULT.report);
    expect(JSON.parse(s.data.request)).toEqual({
      intents: [{ kind: 'rule', summary: 'новое', evidence: 'e' }],
    });
    const [keeper, judge] = await calls();
    expect(keeper?.role).toBe('librarian');
    expect(keeper?.prompt).toContain('"summary":"новое"');
    expect(judge?.role).toBe('judge');
    const runs = path.join(root, '.oc3/reports', s.short, 'roles');
    expect((await readdir(runs)).sort()).toEqual(['judge-1.jsonl', 'librarian-1.jsonl']);
    expect(await readFile(path.join(runs, 'librarian-1.jsonl'), 'utf8')).toContain(
      '"type":"step_finish"',
    );
    expect(await readFile(s.file('progress.log'), 'utf8')).toContain('роль librarian: запущена');
    expect(judge?.prompt).toContain('- .oc3/conventions/other.yml');
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
      librarian: RESULT,
      judge: { conflicts: [CONFLICT] },
    });
    expect(await start('--file', 'intents.yml')).toBe(0);
    expect((await session()).data.state).toBe('failed');
    const keepers = (await calls()).filter((c) => c.role === 'librarian');
    expect(keepers).toHaveLength(4);
    expect(keepers[1]?.prompt).toContain('судья нашёл противоречия');
    expect(keepers[1]?.prompt).toContain('«summary: kebab-case»');
  });

  it('провал verify: повторный apply дополняет существующую дельту и получает нарушения; failed — ai docs-delta open и подсказка оператору', async () => {
    await project();
    process.env['FAKE_FILES'] = JSON.stringify({
      '.oc3/.delta/naming.yml': DELTA.replace('target: other', 'target: naming'),
      '.oc3/conventions/naming.yml': 'key: naming\nsummary: snake_case\nrule: x\n',
    });
    process.env['FAKE_SUBMIT'] = JSON.stringify({ librarian: RESULT, judge: { conflicts: [] } });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      lines.push(a.join(' '));
    });
    expect(await start('--file', 'intents.yml')).toBe(0);
    const s = await session();
    expect(s.data.state).toBe('failed');
    const keepers = (await calls()).filter((c) => c.role === 'librarian');
    expect(keepers).toHaveLength(4);
    expect(keepers[0]?.prompt).toContain('собери дельту .oc3/.delta/naming.yml');
    expect(keepers[1]?.prompt).toContain('уже есть — дополни её, а не пересобирай');
    expect(keepers[1]?.prompt).toContain('включая ручные revise');
    expect(keepers[1]?.prompt).toMatch(
      /исправь нарушения:\n(- .*\n)*- \.oc3\/conventions\/naming\.yml: изменено существующее знание без пункта revise/,
    );
    const pause = lines.join('\n');
    expect(pause).toContain(`ai docs-delta open ${s.short}`);
    expect(pause).not.toContain('harness docs-delta open');
    expect(pause).toContain('спроси пользователя');
    expect(pause).toContain('не закрывай дельту вручную');
  });

  it('review: судья получает только файлы — цели своей дельты', async () => {
    await project();
    await put('.oc3/conventions/foreign.yml', 'key: foreign\nsummary: s\nrule: r\n');
    process.env['FAKE_SUBMIT'] = JSON.stringify({ librarian: RESULT, judge: { conflicts: [] } });
    expect(await start('--file', 'intents.yml')).toBe(0);
    expect((await session()).data.state).toBe('done');
    const judge = (await calls()).find((c) => c.role === 'judge');
    expect(judge?.prompt).toContain('- .oc3/conventions/other.yml');
    expect(judge?.prompt).toContain('Верни вердикт последним блоком сообщения — строго JSON');
    expect(judge?.prompt).not.toContain('foreign.yml');
  });

  it('--file не по схеме: короткая ошибка с ожидаемой формой, код 2, без полной справки', async () => {
    await project();
    await put('bad.yml', '- kind: idea\n  summary: x\n');
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a.join(' '));
    });
    expect(
      await run([
        'docs-delta',
        'start',
        '--name',
        'naming',
        '--root',
        root,
        '--home',
        home,
        '--file',
        'bad.yml',
      ]),
    ).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ожидается: intents: [{kind, summary, evidence}]');
    expect(existsSync(path.join(home, 'sessions'))).toBe(false);
  });

  it('противоречие без дословной цитаты отклоняется — правка проходит', async () => {
    await project();
    process.env['FAKE_SUBMIT'] = JSON.stringify({
      librarian: RESULT,
      judge: { conflicts: [{ ...CONFLICT, quote_b: 'summary: camelCase' }] },
    });
    expect(await start('--file', 'intents.yml')).toBe(0);
    expect((await session()).data.state).toBe('done');
  });

  it('роль не вернула итог — пауза в apply с заданием и намерениями для ручного handoff', async () => {
    await project();
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      lines.push(a.join(' '));
    });
    expect(await start('--file', 'intents.yml')).toBe(0);
    expect((await session()).data.state).toBe('apply');
    expect(lines.join('\n')).toMatch(/роль librarian: .*не вернула итог.*docs-delta open/s);
    expect(lines.join('\n')).toContain('Намерения: {"intents"');
  });

  it('start --file -: молчащий stdin — быстрая ошибка с таймаутом и подсказкой, код 2', async () => {
    await project();
    const pkg = createRequire(import.meta.url).resolve('@shahimat/cli/package.json');
    const bin = path.join(path.dirname(pkg), 'dist', 'bin.js');
    const child = spawn(
      process.execPath,
      [
        bin,
        'docs-delta',
        'start',
        '--name',
        'naming',
        '--file',
        '-',
        '--root',
        root,
        '--home',
        home,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, HARNESS_STDIN_TIMEOUT_S: '1' } },
    );
    const stderr: string[] = [];
    child.stderr?.on('data', (d: Buffer) => stderr.push(d.toString('utf8')));
    const code = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('start висит: stdin не отвалился по таймауту')),
        30_000,
      );
      child.on('close', (c) => {
        clearTimeout(timer);
        resolve(c ?? 1);
      });
    });
    expect(code).toBe(2);
    const text = stderr.join('');
    expect(text).toContain('stdin молчит');
    expect(text).toContain('HARNESS_STDIN_TIMEOUT_S');
    expect(existsSync(path.join(home, 'sessions'))).toBe(false);
  }, 60_000);
});
