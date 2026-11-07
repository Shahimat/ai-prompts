import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expectHelperDir } from '#lib/artifacts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { main } from '@shahimat/cli';
import { isRecord } from '#shared/guards';
import { FAKE_OPENCODE } from './fake-opencode.ts';

const TMP = path.join(import.meta.dirname, '.tmp');
let ROOT: string;
const NOW = new Date('2026-10-13T12:00:00Z');
const out: string[] = [];
const ENTRY = 'expectations/demo.expect.ts';
const DEMO_ENTRY =
  "import { describe, it, expect } from 'vitest';\ndescribe('второй файл', () => {\n  it('шесть на семь — сорок два', () => expect(6 * 7).toBe(42));\n  it.todo('позже');\n});\n";

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(ROOT, rel)), { recursive: true });
  await writeFile(path.join(ROOT, rel), content, 'utf8');
}

beforeAll(async () => {
  await mkdir(TMP, { recursive: true });
  ROOT = await mkdtemp(path.join(TMP, 'expect-cli-'));
  await put('package.json', '{"name":"fixture","private":true,"type":"module"}');
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
  await rm(ROOT, { recursive: true, force: true });
});

describe('ai expect report | lint | judge', () => {
  it('HTML and helper reset are confined to the normalized entry, never an arbitrary export path', async () => {
    const html = `${expectHelperDir(ENTRY)}/page.html`;
    await main(['expect', 'report', ENTRY, '--html', html, '--root', ROOT], NOW);
    expect(await readFile(path.join(ROOT, html), 'utf8')).toContain('два плюс два — четыре');
    await expect(
      main(['expect', 'report', ENTRY, '--html', 'outside.html', '--root', ROOT], NOW),
    ).rejects.toThrow('ARTIFACT_ENTRY_MISMATCH');
    await expect(
      main(
        [
          'expect',
          'report',
          ENTRY,
          '--html',
          `${expectHelperDir('peer/index.expect.ts')}/page.html`,
          '--root',
          ROOT,
        ],
        NOW,
      ),
    ).rejects.toThrow('ARTIFACT_ENTRY_MISMATCH');
    const peer = `${expectHelperDir('peer/index.expect.ts')}/sentinel.json`;
    await put(peer, '{"synthetic":"peer"}');
    await main(['expect', 'judge', ENTRY, '--root', ROOT], NOW);
    expect(await readFile(path.join(ROOT, peer), 'utf8')).toBe('{"synthetic":"peer"}');
    await expect(readFile(path.join(ROOT, 'outside.html'))).rejects.toThrow();
  }, 60000);
  it('lint: 0 — заголовки в порядке', async () => {
    expect(await main(['expect', 'lint', ENTRY, '--root', ROOT], NOW)).toBe(0);
  }, 60_000);

  it('report: 1 — нет свежей проверки заголовков; дерево со статусами', async () => {
    out.length = 0;
    expect(await main(['expect', 'report', ENTRY, '--root', ROOT], NOW)).toBe(1);
    const text = out.join('\n');
    expect(text).toContain('✓ два плюс два — четыре');
    expect(text).toContain('○ будущее ожидание');
    expect(text).toContain('смысловая проверка заголовков устарела');
  }, 60_000);

  it('serve: страница отчёта с 127.0.0.1; SIGINT — код 0', async () => {
    out.length = 0;
    const running = main(['expect', 'serve', ENTRY, '--root', ROOT, '--port', '0'], NOW);
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
    expect(await main(['expect', 'judge', ENTRY, '--root', ROOT], NOW)).toBe(1);
    const plan: unknown = JSON.parse(
      await readFile(path.join(ROOT, expectHelperDir(ENTRY), 'plan.json'), 'utf8'),
    );
    const lint = isRecord(plan) && Array.isArray(plan['lint']) ? plan['lint'] : [];
    expect(lint).toHaveLength(1);
    const answer: unknown = isRecord(lint[0]) ? lint[0]['answer'] : undefined;
    if (typeof answer !== 'string') throw new Error('в плане нет файла ответа');
    await put(answer, '{"contradictions": [], "unmeasurable": []}');
    expect(await main(['expect', 'judge', ENTRY, '--apply', '--root', ROOT], NOW)).toBe(0);
    expect(await main(['expect', 'report', ENTRY, '--root', ROOT], NOW)).toBe(0);
    expect(await main(['expect', 'judge', ENTRY, '--root', ROOT], NOW)).toBe(0);
  }, 120_000);

  it('judge --run: роль отвечает конвертом в тексте — пакет доходит до apply сам', async () => {
    await put(
      'manifest.json',
      JSON.stringify({
        version: 1,
        default: 'openai/base',
        roles: { 'expect.judge': 'openai/expect#high' },
      }),
    );
    await put('expectations/extra.expect.ts', DEMO_ENTRY);
    await put(
      'agents/judge.md',
      '---\nname: judge\ndescription: Тестовая роль judge для проверки harness\noutput: verdict\n---\n\nТело роли judge.\n',
    );
    const fake = path.join(ROOT, 'fake-opencode.mjs');
    await writeFile(fake, FAKE_OPENCODE, 'utf8');
    const envKeys = ['HARNESS_OPENCODE', 'FAKE_TEXT', 'FAKE_SUBMIT', 'FAKE_ARGS'];
    const saved = envKeys.map((k) => [k, process.env[k]] as const);
    process.env['HARNESS_OPENCODE'] = fake;
    process.env['FAKE_ARGS'] = path.join(ROOT, 'expect-args.jsonl');
    delete process.env['FAKE_SUBMIT'];
    process.env['FAKE_TEXT'] =
      'Проверил.\n```json\n{"message":"verdict","data":{"contradictions": [], "unmeasurable": []}}\n```';
    const extra = 'expectations/extra.expect.ts';
    try {
      expect(await main(['expect', 'judge', extra, '--run', '--root', ROOT], NOW)).toBe(0);
      expect(await main(['expect', 'report', extra, '--root', ROOT], NOW)).toBe(0);
      const seen = (await readFile(path.join(ROOT, 'expect-args.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line): unknown => JSON.parse(line))
        .filter(isRecord);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((record) => record['model'] === 'openai/expect#high')).toBe(true);
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }, 120_000);

  it('judge --run: отказ роли — транскрипт в .judge, ошибка называет причину и файл', async () => {
    await put('expectations/broken.expect.ts', DEMO_ENTRY);
    const envKeys = ['HARNESS_OPENCODE', 'FAKE_TEXT'];
    const saved = envKeys.map((k) => [k, process.env[k]] as const);
    process.env['HARNESS_OPENCODE'] = path.join(ROOT, 'fake-opencode.mjs');
    process.env['FAKE_TEXT'] = 'Готово, итога в формате нет';
    out.length = 0;
    try {
      expect(
        await main(
          ['expect', 'judge', 'expectations/broken.expect.ts', '--run', '--root', ROOT],
          NOW,
        ),
      ).toBe(1);
      expect(
        await readFile(
          path.join(
            ROOT,
            expectHelperDir('expectations/broken.expect.ts'),
            'transcripts/lint-1.jsonl',
          ),
          'utf8',
        ),
      ).toContain('"type":"text"');
      const errors = out.join('\n');
      expect(errors).toContain('lint-1.md: роль judge не вернула итог');
      expect(errors).toContain('транскрипт:');
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }, 120_000);
});
