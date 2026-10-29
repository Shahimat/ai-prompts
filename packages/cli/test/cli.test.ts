import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, prepare, projectOf, run } from '#cli';
import { promptOf, shellStep, splitWords } from '#shell';
import { BUILTIN_TREE } from '#tree';
const { childrenOf, commands: COMMANDS, findCommand } = BUILTIN_TREE;

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

describe('ai changelog lint', () => {
  it('0 — журнал корректен, без ai-core.yml', async () => {
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

  it('берёт параметры из ai-core.yml', async () => {
    await put('CHANGELOG.md', '- 2026-10-13 · [infra] a · b\n');
    await put('context/ai-core.yml', 'checks:\n  changelog:\n    tags: [infra]\n');
    expect(await main(['changelog', 'lint', '--root', root], NOW)).toBe(0);
  });
});

describe('ai check', () => {
  it('2 — нет ai-core.yml', async () => {
    expect(await run(['check', '--root', root])).toBe(2);
    expect(stderr[0]).toMatch(/harness в проекте не настроен/);
  });

  it('0 — ни одной проверки не включено', async () => {
    await put('context/ai-core.yml', 'checks:\n  secrets: false\n');
    expect(await main(['check', '--root', root], NOW)).toBe(0);
  });

  it('1 — включённая проверка нашла нарушения', async () => {
    await put('context/ai-core.yml', 'checks:\n  changelog: {}\n');
    await put('CHANGELOG.md', BAD);
    expect(await main(['check', '--root', root], NOW)).toBe(1);
    expect(stderr.at(-1)).toBe('check (changelog lint, secrets scan): есть нарушения');
  });

  it('2 — ошибка в ai-core.yml', async () => {
    await put('context/ai-core.yml', 'checks:\n  nope: {}\n');
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
    for (const c of COMMANDS) expect(usage).toContain(`ai ${c.path.join(' ')}`);
    expect((await prepare([])).renderUsage()).toBe(usage);
  });
});

describe('ai context index', () => {
  it('пишет индекс; check с context-index проходит', async () => {
    await put('context/project.yml', 'namespaces:\n  vpn: доступ\n');
    await put('docs/entities/srv.yml', 'id: srv\nnamespace: vpn\nsummary: сервер\n');
    await put('context/ai-core.yml', 'checks:\n  context-index: {}\n');
    expect(await main(['context', 'index', '--root', root], NOW)).toBe(0);
    expect(await main(['check', '--root', root], NOW)).toBe(0);
  });

  it('1 — при нарушениях, но индекс записан', async () => {
    await put('docs/entities/srv.yml', 'id: srv\nnamespace: vpn\n');
    expect(await main(['context', 'index', '--root', root], NOW)).toBe(1);
    expect(stderr.join('\n')).toMatch(/нет поля summary/);
  });
});

describe('ai context check', () => {
  it('сверяет индекс без записи: нет индекса — 1, после context index — 0', async () => {
    await put('context/project.yml', 'namespaces:\n  vpn: доступ\n');
    await put('docs/entities/srv.yml', 'id: srv\nnamespace: vpn\nsummary: сервер\n');
    expect(await main(['context', 'check', '--root', root], NOW)).toBe(1);
    expect(existsSync(path.join(root, 'context/index.yml'))).toBe(false);
    expect(await main(['context', 'index', '--root', root], NOW)).toBe(0);
    expect(await main(['context', 'check', '--root', root], NOW)).toBe(0);
  });
});

describe('ai adapters sync', () => {
  it('2 — нет ai-core.yml', async () => {
    expect(await run(['adapters', 'sync', '--root', root])).toBe(2);
  });

  it('генерирует, check с adapters проходит; ручной CLAUDE.md — 1', async () => {
    await put('AGENTS.md', '# x\n');
    await put('context/ai-core.yml', 'adapters: [claude-code]\nchecks:\n  adapters: {}\n');
    expect(await main(['adapters', 'sync', '--root', root], NOW)).toBe(0);
    expect(await main(['check', '--root', root], NOW)).toBe(0);

    await put('CLAUDE.md', 'ручной\n');
    expect(await main(['adapters', 'sync', '--root', root], NOW)).toBe(1);
    expect(await main(['check', '--root', root], NOW)).toBe(1);
  });
});

describe('ai adapters check', () => {
  it('2 — нет ai-core.yml', async () => {
    expect(await run(['adapters', 'check', '--root', root])).toBe(2);
  });

  it('сверяет адаптеры без записи: до sync — 1, после — 0', async () => {
    await put('AGENTS.md', '# x\n');
    await put('context/ai-core.yml', 'adapters: [claude-code]\n');
    expect(await main(['adapters', 'check', '--root', root], NOW)).toBe(1);
    expect(existsSync(path.join(root, 'CLAUDE.md'))).toBe(false);
    expect(await main(['adapters', 'sync', '--root', root], NOW)).toBe(0);
    expect(await main(['adapters', 'check', '--root', root], NOW)).toBe(0);
  });
});

describe('корень проекта harness', () => {
  it('ищет .claude вверх от места вызова; домашний каталог проектом не считается', async () => {
    await mkdir(path.join(root, '.claude'));
    await mkdir(path.join(root, 'a/b'), { recursive: true });
    expect(projectOf(path.join(root, 'a/b'))).toBe(root);
    const keys = ['HOME', 'USERPROFILE'];
    const saved = keys.map((k) => [k, process.env[k]] as const);
    for (const k of keys) process.env[k] = root;
    try {
      expect(projectOf(path.join(root, 'a/b'))).toBeUndefined();
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe('ai expect init', () => {
  it('создаёт каркас, дописывает скрипты и .gitignore, повтор ничего не меняет', async () => {
    await put('package.json', '{"name":"demo","scripts":{"test":"x"}}');
    await put('.gitignore', 'node_modules/');
    expect(await main(['expect', 'init', '--root', root], NOW)).toBe(0);
    const { readFile } = await import('node:fs/promises');
    const pkg: unknown = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    expect(pkg).toMatchObject({
      scripts: { test: 'x', expect: 'ai expect report expectations/index.expect.ts --root .' },
    });
    expect(await readFile(path.join(root, 'expectations/index.expect.ts'), 'utf8')).toBe(
      `import './${path.basename(root)}.expect.ts';\n`,
    );
    expect(existsSync(path.join(root, 'expectations/vitest.config.ts'))).toBe(false);
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

describe('ai outdated', async () => {
  const { changelogBetween, compareVersions, runOutdated } = await import('@shahimat/ai-core');
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
    await put(
      'package.json',
      JSON.stringify({
        devDependencies: { '@shahimat/ai-core': '0.3.0', '@shahimat/harness': '^0.3.0' },
      }),
    );
    expect(await runOutdated({ root, now: NOW }, fetcher('0.3.0'))).toBe(0);
    expect(await runOutdated({ root, now: NOW }, fetcher('0.5.0'))).toBe(1);
    expect(logs.join('\n')).toContain('@shahimat/ai-core: 0.3.0 → 0.5.0');
    expect(logs.join('\n')).toContain('@shahimat/harness: 0.3.0 → 0.5.0');
    expect(logs.join('\n')).toContain('- якоря');
  });

  it('2 — нет package.json или в нём нет @shahimat/ai-core', async () => {
    await expect(runOutdated({ root, now: NOW }, fetcher('0.5.0'))).rejects.toThrow(
      /нет package\.json/,
    );
    await put('package.json', '{"devDependencies":{}}');
    await expect(runOutdated({ root, now: NOW }, fetcher('0.5.0'))).rejects.toThrow(
      /нет @shahimat\/ai-core/,
    );
  });
});

describe('ai index build | check', () => {
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
    expect(findCommand(['expect', 'report', 'x.expect.ts'])?.params).toEqual({
      file: 'x.expect.ts',
    });
    expect(findCommand(['role', 'run', 'judge'])?.params).toEqual({ name: 'judge' });
    expect(findCommand(['check', 'extra'])).toBeUndefined();
    expect(findCommand(['docs-delta', 'list'])).toBeUndefined();
  });

  it('list и help на каждом уровне', async () => {
    expect(await main(['list'], NOW)).toBe(0);
    expect(out.at(-1)).toContain('role');
    expect(await main(['role', 'list'], NOW)).toBe(0);
    expect(await main(['role', 'help'], NOW)).toBe(0);
    expect(out.at(-1)).toContain('ai role run <name>');
    expect(out.at(-1)).not.toContain('ai check');
    expect(childrenOf(['role'])).toEqual(['run', 'channel']);
    expect(await run(['role'])).toBe(2);
  });

  it('оболочка: вход в уровень, .., list, help, запуск команды относительно уровня', () => {
    expect(splitWords(`run --file "два слова" '*'`)).toEqual(['run', '--file', 'два слова', '*']);
    expect(shellStep([], 'expect', BUILTIN_TREE)).toEqual({ cwd: ['expect'] });
    expect(shellStep(['expect'], '..', BUILTIN_TREE)).toEqual({ cwd: [] });
    expect(shellStep(['expect'], 'help', BUILTIN_TREE).output).toContain('ai expect init');
    expect(shellStep(['expect'], 'init', BUILTIN_TREE)).toEqual({
      cwd: ['expect'],
      run: ['expect', 'init'],
    });
    expect(shellStep([], 'exit', BUILTIN_TREE).exit).toBe(true);
    expect(promptOf(['expect'])).toBe('/ai/expect> ');
  });
});
