import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { main } from '#cli';
import { isRecord } from '#shared/guards';

const TMP = path.join(import.meta.dirname, '.tmp');
const ROOT = path.join(TMP, 'expect-cli');
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
  await rm(TMP, { recursive: true, force: true });
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

  it('serve: страница отчёта с 127.0.0.1; SIGINT — код 0', async () => {
    out.length = 0;
    const running = main(['expect', 'serve', '--root', ROOT, '--port', '0'], NOW);
    let url: string | undefined;
    for (let i = 0; i < 200 && url === undefined; i++) {
      url = /http:\/\/127\.0\.0\.1:\d+\//.exec(out.join('\n'))?.[0];
      if (url === undefined) await new Promise((r) => setTimeout(r, 50));
    }
    if (url === undefined) throw new Error(`serve не напечатал адрес: ${out.join('\n')}`);
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('два плюс два — четыре');
    expect((await fetch(`${url}other`)).status).toBe(404);
    process.emit('SIGINT');
    expect(await running).toBe(0);
  }, 60_000);

  it('judge: готовит проверку заголовков; --apply с ответом — report проходит', async () => {
    expect(await main(['expect', 'judge', '--root', ROOT], NOW)).toBe(1);
    const plan: unknown = JSON.parse(
      await readFile(path.join(ROOT, 'expectations/.judge/plan.json'), 'utf8'),
    );
    const lint = isRecord(plan) && Array.isArray(plan['lint']) ? plan['lint'] : [];
    expect(lint).toHaveLength(1);
    const answer: unknown = isRecord(lint[0]) ? lint[0]['answer'] : undefined;
    if (typeof answer !== 'string') throw new Error('в плане нет файла ответа');
    await put(answer, '{"contradictions": [], "unmeasurable": []}');
    expect(await main(['expect', 'judge', '--apply', '--root', ROOT], NOW)).toBe(0);
    expect(await main(['expect', 'report', '--root', ROOT], NOW)).toBe(0);
    expect(await main(['expect', 'judge', '--root', ROOT], NOW)).toBe(0);
  }, 120_000);
});
