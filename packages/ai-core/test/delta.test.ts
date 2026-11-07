import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCEPTED_FILE, checkDelta, matchesTarget, revisionLines } from '#commands/delta/delta';
import { main, run } from '@shahimat/cli';
import { digestOf, readJson, recoverLease } from '#lib/local-store';
import { isRecord } from '#shared/guards';

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
  await put('.oc3/project.yml', 'name: demo\nnamespaces:\n  core: ядро\n');
  await put(
    '.oc3/conventions/naming.yml',
    'key: naming\nsummary: kebab-case\nrule: имена в kebab-case\n',
  );
  await put('CHANGELOG.md', '- 2026-10-01 · [arch] монолит · проще\n');
  await put('.oc3/modules/analysis.yml', 'provides:\n  layers: [analysis/claims/]\n');
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
    await put('.oc3/conventions/new.yml', 'key: new\nsummary: новое\nrule: x\n');
    await put(
      '.oc3/conventions/naming.yml',
      'key: naming\nsummary: kebab-case\nrule: имена в kebab-case\nreason: читаемость\n',
    );
    expect(await main(['delta', 'check', '--root', root], NOW)).toBe(0);
  });

  it('1 — изменённое значение без revise', async () => {
    await put(
      '.oc3/conventions/naming.yml',
      'key: naming\nsummary: snake_case\nrule: имена в snake_case\n',
    );
    expect(await main(['delta', 'check', '--root', root], NOW)).toBe(1);
    expect(stderr[0]).toMatch(
      /^\.oc3\/conventions\/naming\.yml: изменено существующее знание без пункта revise в дельте: summary; rule/,
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
      '.oc3/conventions/naming.yml',
      'key: naming\nsummary: snake_case\nrule: имена в snake_case\n',
    );
    await put('.oc3/.delta/naming.yml', REVISE);
    expect(await main(['delta', 'check', '--root', root], NOW)).toBe(0);
    expect(stdout[0]).toBe(
      'revise naming: было «имена в kebab-case» → имена в snake_case; почему: совместимость с внешним API',
    );
  });

  it('1 — revise без was и why не проходит схему, путь до поля в сообщении', async () => {
    await put(
      '.oc3/.delta/bad.yml',
      'summary: s\nitems:\n  - op: revise\n    kind: rule\n    target: naming\n    summary: s\n    evidence: e\n',
    );
    expect(await main(['delta', 'check', '--root', root], NOW)).toBe(1);
    expect(
      stderr.some((l) =>
        l.startsWith(".oc3/.delta/bad.yml: /items/0 must have required property 'was'"),
      ),
    ).toBe(true);
  });

  it('конфиг harness, manifest модулей — не документация', async () => {
    await put('.oc3/modules/analysis.yml', 'provides:\n  layers: []\n');
    const { revisions } = await checkDelta(root);
    expect(revisions).toEqual([]);
  });

  it('2 — не git-репозиторий', async () => {
    await rm(path.join(root, '.git'), { recursive: true, force: true });
    expect(await run(['delta', 'check', '--root', root])).toBe(2);
  });
});

describe('ai delta close', () => {
  it.each(['rename', 'after-publication'])(
    '%s failure leaves the active delta recoverable without duplicate cache tuples',
    async (fault) => {
      await put('.oc3/.delta/naming.yml', REVISE);
      await put('.oc3/conventions/naming.yml', 'key: naming\nsummary: snake_case\nrule: x\n');
      const module = pathToFileURL(
        path.join(path.dirname(import.meta.dirname), 'src/commands/delta/index.ts'),
      ).href;
      const injection =
        fault === 'rename'
          ? `const rename=fs.rename;fs.rename=async(a,b)=>{if(b.endsWith('/delta-accepted.json'))throw new Error('synthetic rename fault');return rename(a,b)}`
          : `const rm=fs.rm;fs.rm=async(file,...args)=>{if(file.endsWith('/.delta/naming.yml'))process.kill(process.pid,'SIGKILL');return rm(file,...args)}`;
      const code = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';${injection};syncBuiltinESMExports();const{runDelta}=await import(${JSON.stringify(module)});try{await runDelta('close',{root:${JSON.stringify(root)},now:new Date('2026-10-14T12:00:00Z')});process.exitCode=4}catch{process.exitCode=1}`;
      const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          const child = spawn(
            process.execPath,
            ['--conditions=source', '--input-type=module', '-e', code],
            { stdio: 'ignore' },
          );
          child.once('error', reject);
          child.once('exit', (code, signal) => resolve({ code, signal }));
        },
      );
      expect(fault === 'rename' ? outcome.code : outcome.signal).toBe(
        fault === 'rename' ? 1 : 'SIGKILL',
      );
      expect(existsSync(path.join(root, '.oc3/.delta/naming.yml'))).toBe(true);
      expect(existsSync(path.join(root, ACCEPTED_FILE))).toBe(fault !== 'rename');
      const lease = await readJson(path.join(root, '.oc3/locks/delta-close.json'));
      if (isRecord(lease) && typeof lease['token'] === 'string')
        await recoverLease(root, 'delta-close', lease['token'], 'runtime');
      expect(await main(['delta', 'close', '--root', root], NOW)).toBe(0);
      expect(existsSync(path.join(root, '.oc3/.delta/naming.yml'))).toBe(false);
      const cache = await readJson(path.join(root, ACCEPTED_FILE));
      if (!isRecord(cache)) throw new Error('cache missing');
      expect(cache['items']).toHaveLength(1);
    },
  );
  it.each(['root', 'worktree', 'head'])(
    'accepted %s binding cannot be copied or reused',
    async (field) => {
      await put('.oc3/.delta/naming.yml', REVISE);
      await put('.oc3/conventions/naming.yml', 'key: naming\nsummary: snake_case\nrule: x\n');
      expect(await main(['delta', 'close', '--root', root], NOW)).toBe(0);
      const ledger = await readJson(path.join(root, ACCEPTED_FILE));
      if (!isRecord(ledger)) throw new Error('ledger missing');
      const { digest, ...body } = ledger;
      expect(typeof digest).toBe('string');
      const changed = { ...body, [field]: 'foreign' };
      await put(ACCEPTED_FILE, JSON.stringify({ ...changed, digest: digestOf(changed) }));
      expect((await checkDelta(root)).diagnostics).not.toEqual([]);
    },
  );
  it('retirement is narrow and preserves durable queue evidence', async () => {
    await put('.oc3/reports/queue/sentinel.json', '{"synthetic":"durable"}');
    await put('.oc3/.delta/.accepted.json', '{"v":1,"items":[]}');
    await put('.oc3/.delta/naming.yml', REVISE);
    await put('.oc3/conventions/naming.yml', 'key: naming\nsummary: snake_case\nrule: x\n');
    expect(await main(['delta', 'close', '--root', root], NOW)).toBe(0);
    expect(existsSync(path.join(root, '.oc3/.delta/.accepted.json'))).toBe(false);
    expect(await readFile(path.join(root, '.oc3/reports/queue/sentinel.json'), 'utf8')).toBe(
      '{"synthetic":"durable"}',
    );
  });
  it('exact accepted content expires on same-target edits and HEAD changes; legacy grants nothing', async () => {
    await put('.oc3/.delta/naming.yml', REVISE);
    await put('.oc3/conventions/naming.yml', 'key: naming\nsummary: snake_case\nrule: x\n');
    expect(await main(['delta', 'close', '--root', root], NOW)).toBe(0);
    expect((await checkDelta(root)).diagnostics).toEqual([]);
    expect(await main(['delta', 'close', '--name', 'naming', '--root', root], NOW)).toBe(0);
    await put('.oc3/conventions/naming.yml', 'key: naming\nsummary: another\nrule: y\n');
    expect((await checkDelta(root)).diagnostics.some((d) => d.file.endsWith('naming.yml'))).toBe(
      true,
    );
    await put(
      '.oc3/.delta/.accepted.json',
      JSON.stringify({
        v: 1,
        items: [{ delta: 'old', target: 'naming', summary: 'old', was: 'old', why: 'old' }],
      }),
    );
    expect((await checkDelta(root)).diagnostics).not.toEqual([]);
    await put('.oc3/conventions/naming.yml', 'key: naming\nsummary: snake_case\nrule: x\n');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'new head');
    expect((await checkDelta(root)).diagnostics).not.toEqual([]);
  });
  it('exact deletion sentinel works and ambiguous targets do not close', async () => {
    await put('.oc3/.delta/naming.yml', REVISE);
    await rm(path.join(root, '.oc3/conventions/naming.yml'));
    expect(await main(['delta', 'close', '--root', root], NOW)).toBe(0);
    expect((await checkDelta(root)).diagnostics).toEqual([]);
    await put('.oc3/conventions/naming.yml', 'key: naming\nrule: resurrected\n');
    expect((await checkDelta(root)).diagnostics).not.toEqual([]);
    await put('.oc3/data/entities/naming.yml', 'id: naming\nsummary: first\n');
    git('add', '.oc3/data');
    git('commit', '-qm', 'other naming');
    await put('.oc3/data/entities/naming.yml', 'id: naming\nsummary: second\n');
    await put('.oc3/.delta/naming.yml', REVISE);
    await expect(main(['delta', 'close', '--root', root], NOW)).rejects.toThrow('неоднозначная');
    expect(existsSync(path.join(root, '.oc3/.delta/naming.yml'))).toBe(true);
  });
  it('1 — пункт не выполнен: дельта остаётся', async () => {
    await put('.oc3/.delta/naming.yml', REVISE);
    expect(await main(['delta', 'close', '--root', root], NOW)).toBe(1);
    expect(stderr[0]).toBe('.oc3/.delta/naming.yml: пункт 1 (revise naming) не выполнен');
    expect(existsSync(path.join(root, '.oc3/.delta/naming.yml'))).toBe(true);
  });

  it('0 — приёмка пройдена: дельта удалена, пересмотры в выводе', async () => {
    await put(
      '.oc3/conventions/naming.yml',
      'key: naming\nsummary: snake_case\nrule: имена в snake_case\n',
    );
    await put('.oc3/.delta/naming.yml', REVISE);
    expect(await main(['delta', 'close', '--root', root], NOW)).toBe(0);
    expect(existsSync(path.join(root, '.oc3/.delta/naming.yml'))).toBe(false);
    expect(revisionLines((await checkDelta(root)).deltas)).toEqual([]);
    expect(stdout[0]).toMatch(/^revise naming: /);
  });
});

describe('delta: предложения из проектов', () => {
  const ADD_RULE = (target: string): string =>
    `summary: новое правило\nitems:\n  - op: add\n    kind: rule\n    target: ${target}\n    summary: s\n    evidence: e\n`;
  const close = (name?: string) =>
    main(['delta', 'close', '--root', root, ...(name === undefined ? [] : ['--name', name])], NOW);

  it('revise с якорем target#поле засчитывается по файлу', async () => {
    await put('.oc3/.delta/naming.yml', REVISE.replace('target: naming', 'target: naming#rule'));
    await put('.oc3/conventions/naming.yml', 'key: naming\nsummary: snake_case\nrule: x\n');
    expect(await close('naming')).toBe(0);
    expect(matchesTarget('AGENTS.md#skills', 'AGENTS.md')).toBe(true);
  });

  it('close --name закрывает только свою дельту: чужая невыполненная не мешает', async () => {
    await put('.oc3/.delta/mine.yml', ADD_RULE('.oc3/conventions/mine.yml'));
    await put('.oc3/.delta/other.yml', ADD_RULE('.oc3/conventions/other.yml'));
    await put('.oc3/conventions/mine.yml', 'key: mine\nsummary: s\nrule: r\n');
    expect(await close('mine')).toBe(0);
    expect(existsSync(path.join(root, '.oc3/.delta/mine.yml'))).toBe(false);
    expect(existsSync(path.join(root, '.oc3/.delta/other.yml'))).toBe(true);
    expect(await close('nope')).toBe(1);
  });

  it('принятый revise помнится до коммита: следующая сессия не падает «знание без revise»', async () => {
    await put('.oc3/.delta/naming.yml', REVISE);
    await put('.oc3/conventions/naming.yml', 'key: naming\nsummary: snake_case\nrule: x\n');
    expect(await close('naming')).toBe(0);
    expect(existsSync(path.join(root, ACCEPTED_FILE))).toBe(true);
    await put('.oc3/.delta/next.yml', ADD_RULE('.oc3/conventions/next.yml'));
    await put('.oc3/conventions/next.yml', 'key: next\nsummary: s\nrule: r\n');
    expect((await checkDelta(root)).diagnostics).toEqual([]);
    expect(await close('next')).toBe(0);
    git('add', '.');
    git('commit', '-qm', 'принято');
    await put('.oc3/.delta/last.yml', ADD_RULE('.oc3/conventions/last.yml'));
    await put('.oc3/conventions/last.yml', 'key: last\nsummary: s\nrule: r\n');
    expect(await close('last')).toBe(0);
    expect(existsSync(path.join(root, ACCEPTED_FILE))).toBe(false);
  });

  it('пункт о файле внутри .oc3/.delta считается выполненным', async () => {
    await put('.oc3/.delta/fix.yml', ADD_RULE('.oc3/.delta/other.yml'));
    expect(await close('fix')).toBe(0);
  });
});

describe('delta: дельты прошлых сессий и закоммиченные дельты', () => {
  const ADD = (target: string): string =>
    `summary: новое правило\nitems:\n  - op: add\n    kind: rule\n    target: ${target}\n    summary: s\n    evidence: e\n`;
  const LONG = REVISE.replace(
    'summary: пересмотр правила именования',
    `summary: ${'x'.repeat(201)}`,
  );
  const naming = 'key: naming\nsummary: snake_case\nrule: имена в snake_case\n';

  it('дельта, попавшая в коммит вместе с правкой, закрывается: пункт засчитан по коммиту', async () => {
    await put('.oc3/.delta/naming.yml', REVISE);
    await put('.oc3/conventions/naming.yml', naming);
    git('add', '.');
    git('commit', '-qm', 'сбой сессии');
    expect(await main(['delta', 'check', '--root', root], NOW)).toBe(0);
    expect(stderr[0]).toMatch(
      /^предупреждение: \.oc3\/\.delta\/naming\.yml: дельта попала в коммит — закрой её: ai delta close --name naming/,
    );
    expect(await main(['delta', 'close', '--root', root, '--name', 'naming'], NOW)).toBe(0);
    expect(existsSync(path.join(root, '.oc3/.delta/naming.yml'))).toBe(false);
  });

  it('закоммиченная дельта без правки цели не закрывается', async () => {
    await put('.oc3/.delta/naming.yml', REVISE);
    git('add', '.');
    git('commit', '-qm', 'только дельта');
    expect(await main(['delta', 'close', '--root', root, '--name', 'naming'], NOW)).toBe(1);
    expect(stderr).toContain('.oc3/.delta/naming.yml: пункт 1 (revise naming) не выполнен');
  });

  it('check и close --name: нарушения чужой дельты — предупреждение, сессию не валят', async () => {
    await put('.oc3/.delta/old.yml', 'summary: [сломано\n');
    await put('.oc3/.delta/mine.yml', ADD('.oc3/conventions/mine.yml'));
    await put('.oc3/conventions/mine.yml', 'key: mine\nsummary: s\nrule: r\n');
    expect(await main(['delta', 'check', '--root', root], NOW)).toBe(1);
    stderr = [];
    expect(await main(['delta', 'check', '--root', root, '--name', 'mine'], NOW)).toBe(0);
    expect(stderr[0]).toMatch(/^предупреждение: \.oc3\/\.delta\/old\.yml: невалидный YAML/);
    expect(stderr[1]).toMatch(/^дельты прошлых сессий с нарушениями \(1\)/);
    expect(await main(['delta', 'close', '--root', root, '--name', 'mine'], NOW)).toBe(0);
    expect(existsSync(path.join(root, '.oc3/.delta/old.yml'))).toBe(true);
  });

  it('check --name: «без revise» вне целей своей дельты — предупреждение, по своим целям — нарушение', async () => {
    await put('.oc3/.delta/mine.yml', ADD('.oc3/conventions/mine.yml'));
    await put('.oc3/conventions/mine.yml', 'key: mine\nsummary: s\nrule: r\n');
    await put('.oc3/conventions/naming.yml', naming);
    expect(await main(['delta', 'check', '--root', root], NOW)).toBe(1);
    stderr = [];
    expect(await main(['delta', 'check', '--root', root, '--name', 'mine'], NOW)).toBe(0);
    expect(stderr[0]).toMatch(
      /^предупреждение: \.oc3\/conventions\/naming\.yml: изменено существующее знание без пункта revise/,
    );
    expect(stderr[1]).toMatch(/^изменения вне целей дельты mine без пункта revise \(1\)/);
    await put('.oc3/.delta/mine.yml', ADD('naming'));
    stderr = [];
    expect(await main(['delta', 'check', '--root', root, '--name', 'mine'], NOW)).toBe(1);
    expect(stderr[0]).toMatch(/^\.oc3\/conventions\/naming\.yml: изменено существующее знание/);
  });

  it('своя дельта не прошла схему: close --name сообщает ошибку схемы, а не «дельты нет»', async () => {
    await put('.oc3/.delta/naming.yml', LONG);
    expect(await main(['delta', 'close', '--root', root, '--name', 'naming'], NOW)).toBe(1);
    expect(stderr[0]).toBe(
      '.oc3/.delta/naming.yml: /summary must NOT have more than 200 characters',
    );
  });

  it('дельта не прошла схему: первой — ошибка схемы, производные «без revise» свёрнуты', async () => {
    await put('.oc3/.delta/naming.yml', LONG);
    await put('.oc3/conventions/naming.yml', naming);
    expect(await main(['delta', 'check', '--root', root], NOW)).toBe(1);
    expect(stderr).toEqual([
      '.oc3/.delta/naming.yml: /summary must NOT have more than 200 characters',
      '.oc3/.delta/naming.yml: дельта не прошла схему — нарушения «без revise» по её целям (1) скрыты как следствие; исправь схему',
      'delta check: нарушений 2',
    ]);
  });
});
