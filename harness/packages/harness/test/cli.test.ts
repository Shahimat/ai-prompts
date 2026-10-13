import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, run } from '../src/cli.ts';

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
    await put('context/harness.yml', 'version: 0.2.0\n');
    expect(await main(['check', '--root', root], NOW)).toBe(0);
  });

  it('1 — включённая проверка нашла нарушения', async () => {
    await put('context/harness.yml', 'checks:\n  changelog: {}\n');
    await put('CHANGELOG.md', BAD);
    expect(await main(['check', '--root', root], NOW)).toBe(1);
    expect(stderr.at(-1)).toBe('check (changelog): нарушений 1');
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

describe('harness expect init', () => {
  it('создаёт каркас, дописывает скрипты и .gitignore, повтор ничего не меняет', async () => {
    await put('package.json', '{"name":"demo","scripts":{"test":"x"}}');
    await put('.gitignore', 'node_modules/');
    expect(await main(['expect', 'init', '--root', root], NOW)).toBe(0);
    const { readFile } = await import('node:fs/promises');
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts).toMatchObject({ test: 'x', expect: 'harness expect report --root .' });
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('node_modules/\nexpectations/.judge/\n');
    const example = await readFile(path.join(root, `expectations/${path.basename(root)}.expect.ts`), 'utf8');
    expect(example).toContain('budget({ crit: 0, warn: 0 });');
    const before = await readFile(path.join(root, 'package.json'), 'utf8');
    expect(await main(['expect', 'init', '--root', root], NOW)).toBe(0);
    expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(before);
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('node_modules/\nexpectations/.judge/\n');
  });
});
