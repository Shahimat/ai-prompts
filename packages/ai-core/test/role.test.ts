import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, selfCommand } from '@shahimat/cli';
import { parseAgent } from '#lib/agent';
import { advertisedSchema, serveChannel } from '#lib/mcp';
import { PROTOCOL, SUBMIT_TOOL } from '#lib/protocol';
import { askRole, findRole, memoryPromptOf, roleSystemPrompt, roleTimeoutMs } from '#lib/role';
import { buildBundles, writeGraph } from '#lib/memory-graph';
import { openCodeStepOf, opencodeArgs } from '#lib/opencode';
import { setRuntime } from '#lib/runtime';
import { isRecord } from '#shared/guards';
import { FAKE_OPENCODE } from './fake-opencode.ts';

const NOW = new Date('2026-10-28T12:00:00Z');

let root: string;
let home: string;
let fakeOc: string;
const ENV = [
  'HARNESS_OPENCODE',
  'FAKE_SUBMIT',
  'FAKE_ARGS',
  'FAKE_FILES',
  'FAKE_TEXT',
  'SLOW_MS',
  'FAKE_SLEEP',
  'FAKE_STEPS',
  'FAKE_EXIT',
  'FAKE_ERROR',
];
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
  fakeOc = path.join(home, 'fake-opencode.mjs');
  await writeFile(fakeOc, FAKE_OPENCODE, 'utf8');
  saved = ENV.map((k) => [k, process.env[k]]);
  process.env['HARNESS_OPENCODE'] = fakeOc;
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

describe('роль: формат', () => {
  it('model и output — из закрытых списков', () => {
    const problems: string[] = [];
    const ok = parseAgent(
      'agents/x.md',
      roleFile('x', 'verdict', 'model: zai/glm-5.3#max\n'),
      (m) => problems.push(m),
    );
    expect(ok?.model).toBe('zai/glm-5.3#max');
    expect(ok?.output).toBe('verdict');
    expect(
      parseAgent('agents/x.md', roleFile('x', 'verdict', 'model: haiku\n'), (m) =>
        problems.push(m),
      ),
    ).toBeNull();
    expect(problems.join('\n')).toContain('model — вне формата');
    expect(parseAgent('agents/x.md', roleFile('x', 'answer'), (m) => problems.push(m))).toBeNull();
    expect(problems.join('\n')).toContain('output — сообщение протокола');
  });

  it('роль ищется в .agents/agents, затем в agents; нет роли или output — ошибка', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    expect((await findRole(root, 'judge')).source).toBe('agents/judge.md');
    await put('.agents/agents/judge.md', roleFile('judge', 'result'));
    expect((await findRole(root, 'judge')).output).toBe('result');
    await expect(findRole(root, 'nobody')).rejects.toThrow('роль nobody не найдена');
    await put(
      'agents/bare.md',
      '---\nname: bare\ndescription: Роль без output для проверки\n---\n\nТело.\n',
    );
    await expect(findRole(root, 'bare')).rejects.toThrow('роль без output');
  });
});

describe('роль: запуск', () => {
  it('команда: opencode run --format json --auto --agent --model; вариант — часть --model', () => {
    expect(opencodeArgs('judge', 'zai-coding-plan/glm-5.3#max')).toEqual([
      'run',
      '--format',
      'json',
      '--auto',
      '--agent',
      'judge',
      '--model',
      'zai-coding-plan/glm-5.3#max',
    ]);
    expect(opencodeArgs('judge', 'zai/glm-5.3')).toEqual([
      'run',
      '--format',
      'json',
      '--auto',
      '--agent',
      'judge',
      '--model',
      'zai/glm-5.3',
    ]);
    expect(openCodeStepOf('{"type":"tool_use","part":{"tool":"read"}}')).toBe('read');
    expect(openCodeStepOf('{"type":"text","part":{"text":"ok"}}')).toBeUndefined();
  });

  it('изолированный прогон: итог из HARNESS_SUBMIT_OUT, конфиг с инструкциями, стоимость из события', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    process.env['FAKE_SUBMIT'] = JSON.stringify({ judge: { answers: [] } });
    process.env['FAKE_ARGS'] = path.join(home, 'args.jsonl');
    const outcome = await askRole(root, 'judge', 'Задание судье');
    expect(outcome).toEqual({ data: { answers: [] }, costUsd: 0.25 });
    const seen: unknown = JSON.parse(await readFile(path.join(home, 'args.jsonl'), 'utf8'));
    expect(isRecord(seen) ? seen['agent'] : undefined).toBe('judge');
    expect(isRecord(seen) ? seen['model'] : undefined).toBe('zai-coding-plan/glm-5.3-flash#max');
    expect(isRecord(seen) ? seen['prompt'] : undefined).toBe('Задание судье');
    const env = isRecord(seen) && isRecord(seen['env']) ? seen['env'] : {};
    expect(typeof env['submit']).toBe('string');
    expect(path.basename(String(env['submit']))).toBe('out.json');
    const config: unknown = JSON.parse(typeof env['config'] === 'string' ? env['config'] : '{}');
    const instructions = isRecord(config) ? config['instructions'] : undefined;
    expect(Array.isArray(instructions) && instructions.length === 1).toBe(true);
    const first = Array.isArray(instructions) ? String(instructions[0]) : '';
    expect(first.startsWith(String(env['dir']))).toBe(true);
    expect(first.endsWith('instructions.md')).toBe(true);
    expect(env['dir']).toBeDefined();
    expect(env['dir']).not.toBe(path.dirname(String(env['submit'])));
  });

  it('role run: итог через HARNESS_SUBMIT_OUT попадает в --out', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    await put('task.md', 'Задание');
    process.env['FAKE_SUBMIT'] = JSON.stringify({ judge: { answers: [] } });
    process.env['FAKE_ARGS'] = path.join(home, 'args.jsonl');
    expect(
      await main(
        ['role', 'run', 'judge', '--file', 'task.md', '--out', 'a.json', '--root', root],
        NOW,
      ),
    ).toBe(0);
    expect(JSON.parse(await readFile(path.join(root, 'a.json'), 'utf8'))).toEqual({ answers: [] });
    const seen: unknown = JSON.parse(await readFile(path.join(home, 'args.jsonl'), 'utf8'));
    const env = isRecord(seen) && isRecord(seen['env']) ? seen['env'] : {};
    expect(typeof env['submit']).toBe('string');
    expect(path.basename(String(env['submit']))).toBe('out.json');
  });

  it('журнал прогона: json-поток пишется в файл, прогресс — по tool_use события', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    process.env['FAKE_SUBMIT'] = JSON.stringify({ judge: { answers: [] } });
    process.env['FAKE_STEPS'] = '1';
    setRuntime({ self: selfCommand(), runScript: async () => 0 });
    const transcript = path.join(home, 'runs', 'judge-oc.jsonl');
    const seen: string[] = [];
    const { data } = await askRole(root, 'judge', 'Задание', {
      transcript,
      onProgress: (t) => seen.push(t),
    });
    expect(data).toEqual({ answers: [] });
    expect(await readFile(transcript, 'utf8')).toContain('"type":"step_finish"');
    expect(seen).toEqual([
      'роль judge: запущена (zai-coding-plan/glm-5.3-flash#max)',
      'роль judge: шаг 1 — read',
      'роль judge: готово, шагов 1',
    ]);
    expect(roleTimeoutMs()).toBe(30 * 60_000);
  });

  it('роль без итога — ошибка «не вернула итог»; неуспешный код — ошибки потока в сообщении', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    await expect(askRole(root, 'judge', 'т')).rejects.toThrow('не вернула итог');
    process.env['FAKE_EXIT'] = '1';
    process.env['FAKE_ERROR'] = 'модель недоступна';
    await expect(askRole(root, 'judge', 'т')).rejects.toThrow(
      'opencode run: код 1: модель недоступна',
    );
  });

  it('модель закончила текстом без submit — fallback: JSON из последнего текста становится итогом', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    process.env['FAKE_TEXT'] = 'Проверил.\n```json\n{"answers":[]}\n```';
    expect(await askRole(root, 'judge', 'т')).toEqual({ data: { answers: [] }, costUsd: 0.25 });
    process.env['FAKE_TEXT'] = '{"answers":[]}';
    expect(await askRole(root, 'judge', 'т')).toEqual({ data: { answers: [] }, costUsd: 0.25 });
    process.env['FAKE_SUBMIT'] = JSON.stringify({
      judge: { contradictions: [], unmeasurable: [] },
    });
    expect(await askRole(root, 'judge', 'т')).toEqual({
      data: { contradictions: [], unmeasurable: [] },
      costUsd: 0.25,
    });
  });

  it('fallback: текст без валидного JSON — прежняя ошибка «не вернула итог»', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    process.env['FAKE_TEXT'] = 'Готово, итога в формате нет';
    await expect(askRole(root, 'judge', 'т')).rejects.toThrow('не вернула итог');
    process.env['FAKE_TEXT'] = '{"answers": "не массив"}';
    await expect(askRole(root, 'judge', 'т')).rejects.toThrow('не вернула итог');
  });

  it('fallback: конверт {message, data} из текста — итог data по схеме роли', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    process.env['FAKE_TEXT'] =
      'Проверил.\n```json\n{"message":"verdict","data":{"answers":[]}}\n```';
    expect(await askRole(root, 'judge', 'т')).toEqual({ data: { answers: [] }, costUsd: 0.25 });
    process.env['FAKE_TEXT'] =
      '{"message":"result","data":{"status":"done","changed":[],"failed":[],"questions":[],"report":"итог"}}';
    await expect(askRole(root, 'judge', 'т')).rejects.toThrow('роль возвращает verdict');
  });

  it('fallback: голый массив ответов батча оборачивается в {answers}', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    process.env['FAKE_TEXT'] =
      '```json\n[{"id":"a","verdict":true,"ref":"@e","quote":"цитата","reason":"найдено"}]\n```';
    expect(await askRole(root, 'judge', 'т')).toEqual({
      data: {
        answers: [{ id: 'a', verdict: true, ref: '@e', quote: 'цитата', reason: 'найдено' }],
      },
      costUsd: 0.25,
    });
  });

  it('fallback: пустые ветки вердикта рядом с заполненной не мешают', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    process.env['FAKE_TEXT'] =
      '```json\n{"answers":[{"id":"a","verdict":true,"ref":"@e","quote":"цитата","reason":"найдено"}],"contradictions":[],"unmeasurable":[]}\n```';
    expect(await askRole(root, 'judge', 'т')).toEqual({
      data: {
        answers: [{ id: 'a', verdict: true, ref: '@e', quote: 'цитата', reason: 'найдено' }],
      },
      costUsd: 0.25,
    });
    process.env['FAKE_TEXT'] =
      '```json\n{"contradictions":[{"a":"x","b":"y","reason":"противоречит"}],"unmeasurable":[]}\n```';
    expect(await askRole(root, 'judge', 'т')).toEqual({
      data: {
        contradictions: [{ a: 'x', b: 'y', reason: 'противоречит' }],
        unmeasurable: [],
      },
      costUsd: 0.25,
    });
  });

  it('итог из файла сессии сервера .oc3/submit/<sessionID>.json, когда канал не записал', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    process.env['FAKE_FILES'] = JSON.stringify({ '.oc3/submit/s.json': '{"answers":[]}' });
    expect(await askRole(root, 'judge', 'т')).toEqual({ data: { answers: [] }, costUsd: 0.25 });
    process.env['FAKE_FILES'] = JSON.stringify({ '.oc3/submit/s.json': '{"битый": true}' });
    process.env['FAKE_TEXT'] = '{"answers":[]}';
    expect(await askRole(root, 'judge', 'т')).toEqual({ data: { answers: [] }, costUsd: 0.25 });
  });

  it('отказ роли называет причину и путь транскрипта', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    const transcript = path.join(home, 'runs', 'judge-t.jsonl');
    await expect(askRole(root, 'judge', 'т', { transcript })).rejects.toThrow(String(transcript));
    await expect(askRole(root, 'judge', 'т', { transcript })).rejects.toThrow(
      'текст ответа без JSON',
    );
  });

  it('системный промпт: правило submit_result — первый абзац', () => {
    const prompt = roleSystemPrompt({
      name: 'judge',
      source: 'agents/judge.md',
      description: 'Тестовая роль judge для проверки harness',
      skills: [],
      tools: [],
      output: 'verdict',
      instructions: 'Тело роли.',
    });
    const [head] = prompt.split('\n');
    expect(head?.includes(`вызов инструмента ${SUBMIT_TOOL}`)).toBe(true);
    expect(head).toContain('итогом не считается');
  });

  it('таймаут останавливает прогон', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    process.env['FAKE_SLEEP'] = '5000';
    await expect(askRole(root, 'judge', 'т', { timeoutMs: 200 })).rejects.toThrow('таймаут');
  });
});

describe('роль: канал', () => {
  it('role channel: сообщение — только из протокола, нужен --out', async () => {
    await expect(main(['role', 'channel', 'answer', '--out', 'o.json'], NOW)).rejects.toThrow(
      'result, verdict или question',
    );
    await expect(main(['role', 'channel', 'verdict'], NOW)).rejects.toThrow('нужен --out');
  });

  async function talk(lines: object[]): Promise<{ replies: unknown[]; out: string }> {
    const input = new PassThrough();
    const output = new PassThrough();
    const out = path.join(root, 'out.json');
    const replies: unknown[] = [];
    output.on('data', (d: Buffer) => {
      for (const l of d.toString('utf8').split('\n')) if (l !== '') replies.push(JSON.parse(l));
    });
    const served = serveChannel({ message: 'verdict', out, input, output });
    for (const l of lines) input.write(`${JSON.stringify(l)}\n`);
    input.end();
    await served;
    return { replies, out };
  }

  it('инструмент один — submit_result; схема без комбинаторов верхнего уровня', async () => {
    const { replies } = await talk([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    expect(JSON.stringify(replies[1])).toContain(`"name":"${SUBMIT_TOOL}"`);
    expect(Object.keys(advertisedSchema(PROTOCOL.verdict))).not.toContain('oneOf');
  });

  it('невалидный ответ — isError с путём к полю, файл не пишется; валидный — пишется', async () => {
    const bad = await talk([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: SUBMIT_TOOL, arguments: { answers: [{ id: 'x', verdict: 'maybe' }] } },
      },
    ]);
    expect(JSON.stringify(bad.replies[0])).toContain('"isError":true');
    expect(JSON.stringify(bad.replies[0])).toContain('/answers/0');
    expect(existsSync(bad.out)).toBe(false);
    const good = await talk([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: SUBMIT_TOOL, arguments: { contradictions: [], unmeasurable: [] } },
      },
    ]);
    expect(JSON.stringify(good.replies[0])).not.toContain('isError');
    expect(JSON.parse(await readFile(good.out, 'utf8'))).toEqual({
      contradictions: [],
      unmeasurable: [],
    });
  });
});

describe('роль: память', () => {
  const buildBundlesFixture = async (): Promise<void> => {
    await put(
      '.oc3/data/__schemas/manifest.schema.json',
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        additionalProperties: false,
        required: ['namespace', 'data'],
        properties: {
          namespace: { type: 'array', items: { type: 'string' } },
          data: { type: 'array', items: { type: 'string' } },
          files: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              additionalProperties: false,
              properties: {
                namespace: { type: 'array', items: { type: 'string' } },
                weight: { type: 'integer', minimum: 0 },
              },
            },
          },
        },
      }),
    );
    await put('.oc3/manifest.json', JSON.stringify({ namespace: ['docs'], data: [] }));
    await put('.oc3/project.yml', 'name: demo\nsummary: Демо-проект памяти\n');
    await put('.oc3/manuals/how.md', '# Как собрать\n\nnpm run build.\n');
    await put(
      '.oc3/manifest.json',
      JSON.stringify({
        namespace: ['docs'],
        data: [],
        files: { 'manuals/how.md': { namespace: ['docs'], weight: 1 } },
      }),
    );
  };

  it('стартовый index и узлы из маркеров «память: <sha>» попадают в system prompt', async () => {
    await buildBundlesFixture();
    const build = await buildBundles(root);
    const graph = build.graph;
    if (graph === null) throw new Error('нет графа');
    await writeGraph(root, graph);
    const node = graph.nodes[0];
    const prompt = await memoryPromptOf(root, `задание\nпамять: ${node?.dir}\n`);
    expect(prompt).toContain('# Память проекта');
    expect(prompt).toContain('Демо-проект памяти');
    expect(prompt).toContain(`Узел памяти ${node?.dir}`);
    expect(prompt).toContain('manuals/how.md');
    const dedup = await memoryPromptOf(root, `память: ${node?.dir} и снова память: ${node?.dir}`);
    expect(dedup.split(`Узел памяти ${node?.dir}`).length - 1).toBe(1);
  });

  it('повторный запуск RoleRun вшивает старт ровно один раз', async () => {
    await buildBundlesFixture();
    const build = await buildBundles(root);
    const graph = build.graph;
    if (graph === null) throw new Error('нет графа');
    await writeGraph(root, graph);
    await put('agents/executor.md', roleFile('executor', 'result'));
    const submit = { status: 'done', changed: [], failed: [], questions: [], report: 'готово' };
    process.env['FAKE_SUBMIT'] = JSON.stringify({ executor: submit });
    process.env['FAKE_ARGS'] = path.join(home, 'args.jsonl');
    await askRole(root, 'executor', 'Задание без маркеров памяти');
    const seen: unknown = JSON.parse(await readFile(path.join(home, 'args.jsonl'), 'utf8'));
    const system = isRecord(seen) && typeof seen['system'] === 'string' ? seen['system'] : '';
    expect(system.match(/# Память проекта/g)?.length ?? 0).toBe(1);
    expect(system).toContain('Оперативная память проекта');
  });

  it('неизвестный узел — отказ с перечнем валидных', async () => {
    await buildBundlesFixture();
    const build = await buildBundles(root);
    const graph = build.graph;
    if (graph === null) throw new Error('нет графа');
    await writeGraph(root, graph);
    await expect(memoryPromptOf(root, `память: 000000000000`)).rejects.toThrow(
      `валидные узлы: ${graph.nodes[0]?.dir}`,
    );
    await rm(path.join(root, '.oc3', 'bundles'), { recursive: true, force: true });
    await expect(memoryPromptOf(root, 'память: 000000000000')).rejects.toThrow('ai memory build');
  });

  it('runRole с маркером: инструкции содержат узел памяти', async () => {
    await buildBundlesFixture();
    const build = await buildBundles(root);
    const graph = build.graph;
    if (graph === null) throw new Error('нет графа');
    await writeGraph(root, graph);
    await put('agents/executor.md', roleFile('executor', 'result'));
    const submit = { status: 'done', changed: [], failed: [], questions: [], report: 'готово' };
    process.env['FAKE_SUBMIT'] = JSON.stringify({ executor: submit });
    process.env['FAKE_ARGS'] = path.join(home, 'args.jsonl');
    await askRole(root, 'executor', `задание\nпамять: ${graph.nodes[0]?.dir}`);
    const seen: unknown = JSON.parse(await readFile(path.join(home, 'args.jsonl'), 'utf8'));
    const system = isRecord(seen) && typeof seen['system'] === 'string' ? seen['system'] : '';
    expect(system).toContain('# Память проекта');
    expect(system).toContain(`Узел памяти ${graph.nodes[0]?.dir}`);
    expect(system).toContain('manuals/how.md');
  });
});
