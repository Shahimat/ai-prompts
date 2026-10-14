import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, run } from '../src/cli.ts';
import { promptOf, shellStep, splitWords } from '../src/commands/shell.ts';
import { childrenOf, COMMANDS, findCommand, renderUsage } from '../src/commands/tree.ts';

const NOW = new Date('2026-10-13T12:00:00Z');
const GOOD = '# Журнал\n\n- 2026-10-13 · [arch] a · b\n';
const BAD = '# Журнал\n\n- 2026-10-13 · a · b\n';

let root: string;
let stderr: string[];

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'harness-cli-'));
  stderr = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderr.push(args.join(' '));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('harness changelog lint', () => {
  it('0 — журнал корректен, без harness.yml', async () => {
    await put('CHANGELOG.md', GOOD);
    expect(await main(['changelog', 'lint', '--root', root], NOW)).toBe(0);
  });

  it('1 — нарушения, с путём и строкой', async () => {
    await put('CHANGELOG.md', BAD);
    expect(await main(['changelog', 'lint', '--root', root], NOW)).toBe(1);
    expect(stderr[0]).toMatch(/^CHANGELOG\.md:3: нет тега/);
  });

  it('1 — нет CHANGELOG.md', async () => {
    expect(await main(['changelog', 'lint', '--root', root], NOW)).toBe(1);
    expect(stderr[0]).toBe('CHANGELOG.md: файл не найден');
  });

  it('берёт параметры из harness.yml', async () => {
    await put('CHANGELOG.md', '- 2026-10-13 · [infra] a · b\n');
    await put('context/harness.yml', 'checks:\n  changelog:\n    tags: [infra]\n');
    expect(await main(['changelog', 'lint', '--root', root], NOW)).toBe(0);
  });
});

describe('harness check', () => {
  it('2 — нет harness.yml', async () => {
    expect(await run(['check', '--root', root])).toBe(2);
    expect(stderr[0]).toMatch(/harness в проекте не настроен/);
  });

  it('0 — ни одной проверки не включено', async () => {
    await put('context/harness.yml', 'version: 0.2.0\nchecks:\n  secrets: false\n');
    expect(await main(['check', '--root', root], NOW)).toBe(0);
  });

  it('1 — включённая проверка нашла нарушения', async () => {
    await put('context/harness.yml', 'checks:\n  changelog: {}\n');
    await put('CHANGELOG.md', BAD);
    expect(await main(['check', '--root', root], NOW)).toBe(1);
    expect(stderr.at(-1)).toBe('check (changelog, secrets): нарушений 1');
  });

  it('2 — ошибка в harness.yml', async () => {
    await put('context/harness.yml', 'checks:\n  nope: {}\n');
    expect(await run(['check', '--root', root])).toBe(2);
  });
});

describe('ошибки вызова', () => {
  it.each([[[]], [['nope']], [['changelog', 'fix']], [['index', 'build']], [['check', '--bogus']]])(
    '2 — %j',
    async (argv) => {
      expect(await run(argv)).toBe(2);
    },
  );
});

describe('справка', () => {
  it('строится из дерева команд: строка на каждую команду', async () => {
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.join(' '));
    });
    expect(await main(['--help'], NOW)).toBe(0);
    const usage = out.join('\n');
    for (const c of COMMANDS) expect(usage).toContain(`harness ${c.path.join(' ')}`);
    expect(renderUsage()).toBe(usage);
  });
});

describe('harness context index', () => {
  it('пишет индекс; check с context-index проходит', async () => {
    await put('context/project.yml', 'namespaces:\n  vpn: доступ\n');
    await put('docs/entities/srv.yml', 'id: srv\nnamespace: vpn\nsummary: сервер\n');
    await put('context/harness.yml', 'checks:\n  context-index: {}\n');
    expect(await main(['context', 'index', '--root', root], NOW)).toBe(0);
    expect(await main(['check', '--root', root], NOW)).toBe(0);
  });

  it('1 — при нарушениях, но индекс записан', async () => {
    await put('docs/entities/srv.yml', 'id: srv\nnamespace: vpn\n');
    expect(await main(['context', 'index', '--root', root], NOW)).toBe(1);
    expect(stderr.join('\n')).toMatch(/нет поля summary/);
  });
});

describe('harness context check', () => {
  it('сверяет индекс без записи: нет индекса — 1, после context index — 0', async () => {
    await put('context/project.yml', 'namespaces:\n  vpn: доступ\n');
    await put('docs/entities/srv.yml', 'id: srv\nnamespace: vpn\nsummary: сервер\n');
    expect(await main(['context', 'check', '--root', root], NOW)).toBe(1);
    expect(existsSync(path.join(root, 'context/index.yml'))).toBe(false);
    expect(await main(['context', 'index', '--root', root], NOW)).toBe(0);
    expect(await main(['context', 'check', '--root', root], NOW)).toBe(0);
  });
});

describe('harness adapters sync', () => {
  it('2 — нет harness.yml', async () => {
    expect(await run(['adapters', 'sync', '--root', root])).toBe(2);
  });

  it('генерирует, check с adapters проходит; ручной CLAUDE.md — 1', async () => {
    await put('AGENTS.md', '# x\n');
    await put('context/harness.yml', 'adapters: [claude-code]\nchecks:\n  adapters: {}\n');
    expect(await main(['adapters', 'sync', '--root', root], NOW)).toBe(0);
    expect(await main(['check', '--root', root], NOW)).toBe(0);

    await put('CLAUDE.md', 'ручной\n');
    expect(await main(['adapters', 'sync', '--root', root], NOW)).toBe(1);
    expect(await main(['check', '--root', root], NOW)).toBe(1);
  });
});

describe('harness adapters check', () => {
  it('2 — нет harness.yml', async () => {
    expect(await run(['adapters', 'check', '--root', root])).toBe(2);
  });

  it('сверяет адаптеры без записи: до sync — 1, после — 0', async () => {
    await put('AGENTS.md', '# x\n');
    await put('context/harness.yml', 'adapters: [claude-code]\n');
    expect(await main(['adapters', 'check', '--root', root], NOW)).toBe(1);
    expect(existsSync(path.join(root, 'CLAUDE.md'))).toBe(false);
    expect(await main(['adapters', 'sync', '--root', root], NOW)).toBe(0);
    expect(await main(['adapters', 'check', '--root', root], NOW)).toBe(0);
  });
});

describe('harness expect init', () => {
  it('создаёт каркас, дописывает скрипты и .gitignore, повтор ничего не меняет', async () => {
    await put('package.json', '{"name":"demo","scripts":{"test":"x"}}');
    await put('.gitignore', 'node_modules/');
    expect(await main(['expect', 'init', '--root', root], NOW)).toBe(0);
    const { readFile } = await import('node:fs/promises');
    const pkg: unknown = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    expect(pkg).toMatchObject({
      scripts: { test: 'x', expect: 'harness expect report --root .' },
    });
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules/\nexpectations/.judge/\n',
    );
    const example = await readFile(
      path.join(root, `expectations/${path.basename(root)}.expect.ts`),
      'utf8',
    );
    expect(example).toContain('budget({ crit: 0, warn: 0 });');
    const before = await readFile(path.join(root, 'package.json'), 'utf8');
    expect(await main(['expect', 'init', '--root', root], NOW)).toBe(0);
    expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(before);
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules/\nexpectations/.judge/\n',
    );
  });
});

describe('harness outdated', async () => {
  const { changelogBetween, compareVersions, runOutdated } =
    await import('../src/commands/outdated.ts');
  const LOG = '# Журнал\n\n## 0.5.0\n\n- outdated\n\n## 0.4.0\n\n- якоря\n\n## 0.3.0\n\n- expect\n';
  const fetcher = (latest: string) => async (url: string) => ({
    ok: true,
    status: 200,
    text: async () =>
      url.includes('registry') ? JSON.stringify({ 'dist-tags': { latest } }) : LOG,
  });
  const logs: string[] = [];

  it('сравнение версий и записи журнала между ними', () => {
    expect(compareVersions('0.10.0', '0.9.1')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(changelogBetween(LOG, '0.3.0', '0.5.0').map((e) => e.split('\n')[0])).toEqual([
      '0.5.0',
      '0.4.0',
    ]);
  });

  it('0 — актуально, 1 — есть новее с журналом', async () => {
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    await put('context/harness.yml', 'version: 0.3.0\n');
    expect(await runOutdated({ root, now: NOW }, fetcher('0.3.0'))).toBe(0);
    expect(await runOutdated({ root, now: NOW }, fetcher('0.5.0'))).toBe(1);
    expect(logs.join('\n')).toContain('harness: 0.3.0 → 0.5.0');
    expect(logs.join('\n')).toContain('- якоря');
  });

  it('2 — нет version в harness.yml', async () => {
    await put('context/harness.yml', 'checks: {}\n');
    await expect(runOutdated({ root, now: NOW }, fetcher('0.5.0'))).rejects.toThrow(/нет version/);
  });
});

describe('harness index build | check', () => {
  const RAW = 'https://raw.example/repo/main';
  it('build пишет индекс, check: 0 — актуален, 1 — устарел', async () => {
    await put('prompts/a.md', '---\nkey: a\nkind: prompt\n---\n');
    expect(await main(['index', 'build', '--root', root, '--raw-base', RAW], NOW)).toBe(0);
    expect(await main(['index', 'check', '--root', root, '--raw-base', RAW], NOW)).toBe(0);
    await put('prompts/b.md', '---\nkey: b\nkind: prompt\n---\n');
    expect(await main(['index', 'check', '--root', root, '--raw-base', RAW], NOW)).toBe(1);
  });
});

describe('дерево команд: уровни, list, help, оболочка', () => {
  let out: string[];
  beforeEach(() => {
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.join(' '));
    });
  });

  it('параметры пути и приоритет литералов', () => {
    expect(findCommand(['session', 'list'])?.params).toEqual({});
    expect(findCommand(['session', 'x-1', 'status'])?.params).toEqual({ session: 'x-1' });
    expect(findCommand(['plan', 'iter', 'start'])?.params).toEqual({ harness: 'iter' });
    expect(findCommand(['session', 'x', 'clone', '*'])?.command.path.at(-1)).toBe('*');
    expect(findCommand(['check', 'extra'])).toBeUndefined();
  });

  it('list и help на каждом уровне', async () => {
    expect(await main(['list'], NOW)).toBe(0);
    expect(out.at(-1)).toContain('plan');
    expect(await main(['plan', 'iter', 'list'], NOW)).toBe(0);
    expect(out.at(-1)?.split('\n')).toEqual(['start', 'validate', 'graph']);
    expect(await main(['session', 'x', 'help'], NOW)).toBe(0);
    expect(out.at(-1)).toContain('harness session <session> status');
    expect(out.at(-1)).not.toContain('harness check');
    expect(childrenOf(['session', 'x', 'clone'])).toEqual(['*', 'md']);
    expect(await run(['plan'])).toBe(2);
  });

  it('оболочка: вход в уровень, .., list, help, запуск команды относительно уровня', () => {
    expect(splitWords(`start --name "два слова" '*'`)).toEqual([
      'start',
      '--name',
      'два слова',
      '*',
    ]);
    expect(shellStep([], 'plan')).toEqual({ cwd: ['plan'] });
    expect(shellStep(['plan'], 'iter')).toEqual({ cwd: ['plan', 'iter'] });
    expect(shellStep(['plan', 'iter'], '..')).toEqual({ cwd: ['plan'] });
    expect(shellStep(['plan', 'iter'], 'list').output).toBe('start\nvalidate\ngraph');
    expect(shellStep(['plan', 'iter'], 'help').output).toContain('harness plan <harness> start');
    expect(shellStep(['plan', 'iter'], 'start --name x')).toEqual({
      cwd: ['plan', 'iter'],
      run: ['plan', 'iter', 'start', '--name', 'x'],
    });
    expect(shellStep(['plan'], 'list')).toEqual({ cwd: ['plan'], run: ['plan', 'list'] });
    expect(shellStep(['session'], 'demo-1')).toEqual({ cwd: ['session', 'demo-1'] });
    expect(shellStep([], 'exit').exit).toBe(true);
    expect(promptOf(['plan', 'iter'])).toBe('/harness/plan/iter> ');
  });

  it('любая команда — одной строкой из шелла; .ts-плагин грузится голым Node без сборки', async () => {
    const home = path.join(root, 'home');
    await put(
      'home/harnesses/plan/iter/handlers/extra.ts',
      'const yes = (_c: unknown): boolean => true;\nexport default { guards: { yes } };\n',
    );
    const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url));
    const r = spawnSync(process.execPath, [bin, 'plan', 'iter', 'validate', '--home', home], {
      encoding: 'utf8',
    });
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('plan/iter: ok (плагины: extra.ts)');
    expect(r.status).toBe(0);
  });
});
