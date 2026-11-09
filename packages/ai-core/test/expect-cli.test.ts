import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expectCacheFile, expectHelperDir } from '#lib/artifacts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { artifactPath } from '#lib/artifacts';
import { beginProofRun } from '#lib/proof/transport';
import { runExpect } from '#commands/expect/index';
import { main } from '@shahimat/cli';
import { isRecord } from '#shared/guards';
import { FAKE_OPENCODE } from './fake-opencode.ts';

const TMP = path.join(import.meta.dirname, '.tmp');
let ROOT: string;
const NOW = new Date('2026-10-13T12:00:00Z');
const out: string[] = [];
let zeroLaunchScenarios = 0;
let configuredAgentLaunches = 0;
const ENTRY = 'expectations/demo.expect.ts';
const DEMO_ENTRY =
  "import { describe, it, expect } from 'vitest';\ndescribe('второй файл', () => {\n  it('шесть на семь — сорок два', () => expect(6 * 7).toBe(42));\n  it.todo('позже');\n});\n";

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(ROOT, rel)), { recursive: true });
  await writeFile(path.join(ROOT, rel), content, 'utf8');
}

beforeEach(async () => {
  out.length = 0;
  await mkdir(TMP, { recursive: true });
  ROOT = await mkdtemp(path.join(TMP, 'expect-cli-'));
  await put('package.json', '{"name":"fixture","private":true,"type":"module"}');
  await put(
    'agents/judge.md',
    '---\nname: judge\ndescription: Тестовая роль judge для проверки harness\noutput: verdict\n---\n\nТело роли judge.\n',
  );
  await put('fake-opencode.mjs', FAKE_OPENCODE);
  vi.stubEnv('HARNESS_OPENCODE', path.join(ROOT, 'fake-opencode.mjs'));
  vi.stubEnv('FAKE_ARGS', path.join(ROOT, 'unexpected-agent.jsonl'));
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

afterEach(async () => {
  const launched = await readFile(path.join(ROOT, 'unexpected-agent.jsonl'), 'utf8').then(
    () => true,
    () => false,
  );
  if (launched) {
    configuredAgentLaunches++;
    throw new Error('unexpected agent launch');
  }
  zeroLaunchScenarios++;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(ROOT, { recursive: true, force: true });
});
afterAll(async () => {
  const file = artifactPath(path.resolve(import.meta.dirname, '..', '..', '..'), {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: `checks/cli-counters-a-${randomUUID()}.json`,
  });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ zeroLaunchScenarios, configuredAgentLaunches }, null, 2));
  console.log(`CLI counters: ${file}`);
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
  it('lint: 1 — scripted заголовки в порядке, semantic coverage needs-review', async () => {
    expect(await main(['expect', 'lint', ENTRY, '--root', ROOT], NOW)).toBe(1);
  }, 60_000);

  it('report: 1 — нет свежей проверки заголовков; дерево со статусами', async () => {
    out.length = 0;
    expect(await main(['expect', 'report', ENTRY, '--root', ROOT], NOW)).toBe(1);
    const text = out.join('\n');
    expect(text).toContain('✓ два плюс два — четыре');
    expect(text).toContain('○ будущее ожидание');
    expect(text).toContain('смысловая проверка заголовков устарела');
  }, 60_000);

  it('legacy report/lint are read-only and never launch the configured fake producer', async () => {
    const file = expectCacheFile(ENTRY);
    const legacy = JSON.stringify({
      verdicts: {
        historical: {
          question: 'old',
          evidence: { ref: 'old' },
          verdict: true,
          quote: 'historical quote',
          ref: 'ref',
          reason: 'preserve history',
          at: '2020-01-01',
        },
      },
      lint: {},
    });
    await put(file, legacy);
    expect(await main(['expect', 'report', ENTRY, '--root', ROOT], NOW)).toBe(1);
    expect(await main(['expect', 'lint', ENTRY, '--root', ROOT], NOW)).toBe(1);
    const proof = await beginProofRun(ROOT, {
      owner: 'synthetic-query',
      scope: [`expect:collection:${ENTRY}:query`],
      force: false,
      allowJudge: true,
    });
    const args = { root: ROOT, now: NOW, params: { file: ENTRY }, proofRun: proof };
    expect(await runExpect('report', args)).toBe(1);
    expect(await runExpect('lint', args)).toBe(1);
    vi.stubEnv('HARNESS_EXPECT_HEAD_SOURCE', path.join(ROOT, 'untrusted-head.ts'));
    await expect(runExpect('report', args)).rejects.toThrow('HEAD source requires');
    vi.stubEnv('HARNESS_EXPECT_HEAD_SOURCE', '');
    expect(await readFile(path.join(ROOT, file), 'utf8')).toBe(legacy);
    await expect(readFile(path.join(ROOT, 'unexpected-agent.jsonl'), 'utf8')).rejects.toThrow();
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
    expect(page.status).toBe(503);
    expect(page.headers.get('x-expect-status')).toBe('needs-review');
    expect(await page.text()).toContain('два плюс два — четыре');
    expect((await fetch(`${url}other`)).status).toBe(404);
    process.emit('SIGINT');
    expect(await running).toBe(0);
  }, 60_000);

  it('judge: готовит проверку; bare legacy ответ и неизвестный producer не дают trusted upgrade', async () => {
    expect(await main(['expect', 'judge', ENTRY, '--root', ROOT], NOW)).toBe(1);
    const plan: unknown = JSON.parse(
      await readFile(path.join(ROOT, expectHelperDir(ENTRY), 'plan.json'), 'utf8'),
    );
    const lint = isRecord(plan) && Array.isArray(plan['lint']) ? plan['lint'] : [];
    expect(lint).toHaveLength(1);
    const answer: unknown = isRecord(lint[0]) ? lint[0]['answer'] : undefined;
    if (typeof answer !== 'string') throw new Error('в плане нет файла ответа');
    await put(answer, '{"contradictions": [], "unmeasurable": []}');
    await expect(main(['expect', 'judge', ENTRY, '--apply', '--root', ROOT], NOW)).rejects.toThrow(
      'INCOMPLETE_EXPECT_PRODUCER',
    );
    expect(await main(['expect', 'report', ENTRY, '--root', ROOT], NOW)).toBe(1);
    expect(await main(['expect', 'judge', ENTRY, '--root', ROOT], NOW)).toBe(1);
  }, 120_000);

  it('judge --run: даже fake executable без controlled context не становится trusted producer', async () => {
    await put(
      'manifest.json',
      JSON.stringify({
        version: 1,
        default: 'openai/base',
        roles: { 'expect.judge': 'openai/expect#high' },
      }),
    );
    await put('expectations/extra.expect.ts', DEMO_ENTRY);
    const fake = path.join(ROOT, 'fake-opencode.mjs');
    const envKeys = ['HARNESS_OPENCODE', 'FAKE_TEXT', 'FAKE_SUBMIT', 'FAKE_ARGS'];
    const saved = envKeys.map((k) => [k, process.env[k]] as const);
    process.env['HARNESS_OPENCODE'] = fake;
    process.env['FAKE_ARGS'] = path.join(ROOT, 'expect-args.jsonl');
    delete process.env['FAKE_SUBMIT'];
    process.env['FAKE_TEXT'] =
      'Проверил.\n```json\n{"message":"verdict","data":{"contradictions": [], "unmeasurable": []}}\n```';
    const extra = 'expectations/extra.expect.ts';
    try {
      expect(await main(['expect', 'judge', extra, '--run', '--root', ROOT], NOW)).toBe(1);
      expect(await main(['expect', 'report', extra, '--root', ROOT], NOW)).toBe(1);
      await expect(readFile(path.join(ROOT, 'expect-args.jsonl'), 'utf8')).rejects.toThrow();
      expect(out.join('\n')).toContain('agent calls 0');
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }, 120_000);

  it('judge --run: неизвестные инструкции блокируют запуск до чтения ответа fake роли', async () => {
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
      const errors = out.join('\n');
      expect(errors).toContain('INCOMPLETE_EXPECT_PRODUCER');
      expect(errors).toContain('agent calls 0');
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }, 120_000);
});
