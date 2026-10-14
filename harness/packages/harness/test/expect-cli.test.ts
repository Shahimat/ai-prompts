import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.ts';

// Временный проект внутри пакета: vitest находится в node_modules репозитория.
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../.tmp/expect-cli');
const NOW = new Date('2026-10-13T12:00:00Z');
const out: string[] = [];

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(ROOT, rel)), { recursive: true });
  await writeFile(path.join(ROOT, rel), content, 'utf8');
}

beforeAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
  await put('package.json', '{"name":"fixture","private":true,"type":"module"}');
  await put(
    'expectations/vitest.config.ts',
    "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { include: ['expectations/**/*.expect.ts'] } });\n",
  );
  await put(
    'expectations/demo.expect.ts',
    "import { describe, it, expect } from 'vitest';\ndescribe('демо', () => {\n  it('два плюс два — четыре', () => expect(2 + 2).toBe(4));\n  it.todo('будущее ожидание');\n});\n",
  );
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    out.push(a.join(' '));
  });
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await rm(path.resolve(ROOT, '..'), { recursive: true, force: true });
});

describe('harness expect report | lint | judge', () => {
  it('lint: 0 — заголовки в порядке', async () => {
    expect(await main(['expect', 'lint', '--root', ROOT], NOW)).toBe(0);
  }, 60_000);

  it('report: 1 — нет свежей проверки заголовков; дерево со статусами', async () => {
    out.length = 0;
    expect(await main(['expect', 'report', '--root', ROOT], NOW)).toBe(1);
    const text = out.join('\n');
    expect(text).toContain('✓ два плюс два — четыре');
    expect(text).toContain('○ будущее ожидание');
    expect(text).toContain('смысловая проверка заголовков устарела');
  }, 60_000);

  it('judge: готовит проверку заголовков; --apply с ответом — report проходит', async () => {
    expect(await main(['expect', 'judge', '--root', ROOT], NOW)).toBe(1);
    const plan = JSON.parse(
      await readFile(path.join(ROOT, 'expectations/.judge/plan.json'), 'utf8'),
    ) as {
      lint: { answer: string }[];
    };
    expect(plan.lint).toHaveLength(1);
    await put(plan.lint[0]?.answer ?? '', '{"contradictions": [], "unmeasurable": []}');
    expect(await main(['expect', 'judge', '--apply', '--root', ROOT], NOW)).toBe(0);
    expect(await main(['expect', 'report', '--root', ROOT], NOW)).toBe(0);
    expect(await main(['expect', 'judge', '--root', ROOT], NOW)).toBe(0);
  }, 120_000);
});
