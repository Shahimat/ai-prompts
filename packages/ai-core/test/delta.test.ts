import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContextIndex } from '#commands/context/context-index';
import { ACCEPTED_FILE, checkDelta, matchesTarget, revisionLines } from '#commands/delta/delta';
import { main, run } from '@shahimat/cli';

const NOW = new Date('2026-10-14T12:00:00Z');

let root: string;
let stderr: string[];
let stdout: string[];

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
}

function git(...args: string[]): void {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}

const REVISE = `summary: пересмотр правила именования
items:
  - op: revise
    kind: rule
    target: naming
    summary: имена в snake_case
    evidence: разбор analysis/analyses/naming
    was: имена в kebab-case
    why: совместимость с внешним API
`;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'harness-delta-'));
  stderr = [];
  stdout = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(' '));
  });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  await put('context/project.yml', 'name: demo\nnamespaces:\n  core: ядро\n');
  await put(
    'context/conventions/naming.yml',
    'key: naming\nsummary: kebab-case\nrule: имена в kebab-case\n',
  );
  await put('CHANGELOG.md', '- 2026-10-01 · [arch] монолит · проще\n');
  await put('context/modules/analysis.yml', 'provides:\n  layers: [analysis/claims/]\n');
  await put('analysis/claims/a.yml', 'id: a\nsummary: тезис\n');
  git('add', '.');
  git('commit', '-qm', 'init');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('ai delta check', () => {
  it('0 — только добавления, без дельты', async () => {
    await put('context/conventions/new.yml', 'key: new\nsummary: новое\nrule: x\n');
    await put(
      'context/conventions/naming.yml',
      'key: naming\nsummary: kebab-case\nrule: имена в kebab-case\nreason: читаемость\n',
    );
    expect(await main(['delta', 'check', '--root', root], NOW)).toBe(0);
  });

  it('1 — изменённое значение без revise', async () => {
    await put(
      'context/conventions/naming.yml',
      'key: naming\nsummary: snake_case\nrule: имена в snake_case\n',
    );
    expect(await main(['delta', 'check', '--root', root], NOW)).toBe(1);
    expect(stderr[0]).toMatch(
      /^context\/conventions\/naming\.yml: изменено существующее знание без пункта revise в дельте: summary; rule/,
    );
  });

  it('1 — удалённый файл слоя модуля и строка журнала без revise', async () => {
    await rm(path.join(root, 'analysis/claims/a.yml'));
    await put('CHANGELOG.md', '');
    expect(await main(['delta', 'check', '--root', root], NOW)).toBe(1);
    expect(stderr.slice(0, 2).sort()).toEqual([
      'CHANGELOG.md: изменено существующее знание без пункта revise в дельте: - 2026-10-01 · [arch] монолит · проще',
      'analysis/claims/a.yml: удалено существующее знание без пункта revise в дельте',
    ]);
  });

  it('0 — изменение покрыто revise по id; строка пересмотра в выводе', async () => {
    await put(
      'context/conventions/naming.yml',
      'key: naming\nsummary: snake_case\nrule: имена в snake_case\n',
    );
    await put('context/.delta/naming.yml', REVISE);
    expect(await main(['delta', 'check', '--root', root], NOW)).toBe(0);
    expect(stdout[0]).toBe(
      'revise naming: было «имена в kebab-case» → имена в snake_case; почему: совместимость с внешним API',
    );
  });

  it('1 — revise без was и why не проходит схему, путь до поля в сообщении', async () => {
    await put(
      'context/.delta/bad.yml',
      'summary: s\nitems:\n  - op: revise\n    kind: rule\n    target: naming\n    summary: s\n    evidence: e\n',
    );
    expect(await main(['delta', 'check', '--root', root], NOW)).toBe(1);
    expect(
      stderr.some((l) =>
        l.startsWith("context/.delta/bad.yml: /items/0 must have required property 'was'"),
      ),
    ).toBe(true);
  });

  it('конфиг harness, manifest модулей и index.yml — не документация', async () => {
    await put('context/modules/analysis.yml', 'provides:\n  layers: []\n');
    const { revisions } = await checkDelta(root);
    expect(revisions).toEqual([]);
  });

  it('2 — не git-репозиторий', async () => {
    await rm(path.join(root, '.git'), { recursive: true, force: true });
    expect(await run(['delta', 'check', '--root', root])).toBe(2);
  });
});

describe('ai delta close', () => {
  it('1 — пункт не выполнен: дельта остаётся', async () => {
    await put('context/.delta/naming.yml', REVISE);
    expect(await main(['delta', 'close', '--root', root], NOW)).toBe(1);
    expect(stderr[0]).toBe('context/.delta/naming.yml: пункт 1 (revise naming) не выполнен');
    expect(existsSync(path.join(root, 'context/.delta/naming.yml'))).toBe(true);
  });

  it('0 — приёмка пройдена: дельта удалена, пересмотры в выводе', async () => {
    await put(
      'context/conventions/naming.yml',
      'key: naming\nsummary: snake_case\nrule: имена в snake_case\n',
    );
    await put('context/.delta/naming.yml', REVISE);
    expect(await main(['delta', 'close', '--root', root], NOW)).toBe(0);
    expect(existsSync(path.join(root, 'context/.delta/naming.yml'))).toBe(false);
    expect(revisionLines((await checkDelta(root)).deltas)).toEqual([]);
    expect(stdout[0]).toMatch(/^revise naming: /);
  });
});

describe('context index и .delta', () => {
  it('файлы context/.delta/ не попадают в индекс', async () => {
    await put(
      'context/modules/analysis.yml',
      'provides:\n  index_layers:\n    - { section: drafts, dir: context, format: yml }\n',
    );
    await put(
      'context/.delta/naming.yml',
      'id: leak\nnamespace: core\nsummary: не должно попасть\n',
    );
    const { text } = await buildContextIndex(root);
    expect(text).not.toContain('leak');
  });
});

describe('delta: предложения из проектов', () => {
  const ADD_RULE = (target: string): string =>
    `summary: новое правило\nitems:\n  - op: add\n    kind: rule\n    target: ${target}\n    summary: s\n    evidence: e\n`;
  const close = (name?: string) =>
    main(['delta', 'close', '--root', root, ...(name === undefined ? [] : ['--name', name])], NOW);

  it('revise с якорем target#поле засчитывается по файлу', async () => {
    await put('context/.delta/naming.yml', REVISE.replace('target: naming', 'target: naming#rule'));
    await put('context/conventions/naming.yml', 'key: naming\nsummary: snake_case\nrule: x\n');
    expect(await close('naming')).toBe(0);
    expect(matchesTarget('AGENTS.md#skills', 'AGENTS.md')).toBe(true);
  });

  it('close --name закрывает только свою дельту: чужая невыполненная не мешает', async () => {
    await put('context/.delta/mine.yml', ADD_RULE('context/conventions/mine.yml'));
    await put('context/.delta/other.yml', ADD_RULE('context/conventions/other.yml'));
    await put('context/conventions/mine.yml', 'key: mine\nsummary: s\nrule: r\n');
    expect(await close('mine')).toBe(0);
    expect(existsSync(path.join(root, 'context/.delta/mine.yml'))).toBe(false);
    expect(existsSync(path.join(root, 'context/.delta/other.yml'))).toBe(true);
    expect(await close('nope')).toBe(1);
  });

  it('принятый revise помнится до коммита: следующая сессия не падает «знание без revise»', async () => {
    await put('context/.delta/naming.yml', REVISE);
    await put('context/conventions/naming.yml', 'key: naming\nsummary: snake_case\nrule: x\n');
    expect(await close('naming')).toBe(0);
    expect(existsSync(path.join(root, ACCEPTED_FILE))).toBe(true);
    await put('context/.delta/next.yml', ADD_RULE('context/conventions/next.yml'));
    await put('context/conventions/next.yml', 'key: next\nsummary: s\nrule: r\n');
    expect((await checkDelta(root)).diagnostics).toEqual([]);
    expect(await close('next')).toBe(0);
    git('add', '.');
    git('commit', '-qm', 'принято');
    await put('context/.delta/last.yml', ADD_RULE('context/conventions/last.yml'));
    await put('context/conventions/last.yml', 'key: last\nsummary: s\nrule: r\n');
    expect(await close('last')).toBe(0);
    expect(existsSync(path.join(root, ACCEPTED_FILE))).toBe(false);
  });

  it('пункт о файле внутри context/.delta считается выполненным', async () => {
    await put('context/.delta/fix.yml', ADD_RULE('context/.delta/other.yml'));
    expect(await close('fix')).toBe(0);
  });
});
