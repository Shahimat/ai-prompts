import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '#cli';
import { openSession } from '#harnesses/core/store/session';
import { parseAgent, type AgentDef } from '#lib/agent';
import { advertisedSchema, serveChannel } from '#lib/mcp';
import { PROTOCOL, SUBMIT_TOOL, SUBMIT_TOOL_ID } from '#lib/protocol';
import { findRole, roleArgs } from '#lib/role';
import { isRecord } from '#shared/guards';

const NOW = new Date('2026-10-28T12:00:00Z');

const FAKE_CLAUDE = `import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
const args = process.argv.slice(2);
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
if (process.env.FAKE_ARGS) writeFileSync(process.env.FAKE_ARGS, JSON.stringify({ args, prompt }));
for (const [rel, text] of Object.entries(JSON.parse(process.env.FAKE_FILES ?? '{}'))) {
  mkdirSync(path.dirname(rel), { recursive: true });
  writeFileSync(rel, text);
}
const done = () => process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: 'ok', session_id: 's', total_cost_usd: 0 }));
const submit = process.env.FAKE_SUBMIT;
if (submit === undefined) { done(); process.exit(0); }
const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.harness;
const server = spawn(config.command, config.args, { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: server.stdout });
const send = (m) => server.stdin.write(JSON.stringify(m) + '\\n');
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, line + '\\n');
  if (m.id === 1) send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: '${SUBMIT_TOOL}', arguments: JSON.parse(submit) } });
  if (m.id === 2) { server.stdin.end(); done(); }
});
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
`;

const RESULT = { status: 'done', changed: [], failed: [], questions: [], report: 'ok' };

let root: string;
let home: string;
let fake: string;
const ENV = ['HARNESS_CLAUDE', 'FAKE_SUBMIT', 'FAKE_ARGS', 'FAKE_FILES', 'FAKE_LOG'];
let saved: [string, string | undefined][];

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
}

const roleFile = (name: string, output: string, extra = ''): string =>
  `---\nname: ${name}\ndescription: Тестовая роль ${name} для проверки harness\n${extra}output: ${output}\n---\n\nИнструкции роли ${name}.\n`;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'harness-role-'));
  await mkdir(path.join(root, '.claude'));
  home = await mkdtemp(path.join(tmpdir(), 'harness-role-home-'));
  fake = path.join(home, 'fake-claude.mjs');
  await writeFile(fake, FAKE_CLAUDE, 'utf8');
  saved = ENV.map((k) => [k, process.env[k]]);
  process.env['HARNESS_CLAUDE'] = fake;
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
    const ok = parseAgent('agents/x.md', roleFile('x', 'verdict', 'model: haiku\n'), (m) =>
      problems.push(m),
    );
    expect(ok?.model).toBe('haiku');
    expect(ok?.output).toBe('verdict');
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
  const role: AgentDef = {
    name: 'judge',
    source: 'agents/judge.md',
    description: 'd',
    skills: [],
    tools: [],
    output: 'verdict',
    instructions: 'i',
  };

  it('claude -p изолирован, канал harness — единственный MCP, задание не в аргументах', () => {
    const args = roleArgs({
      root,
      role,
      task: 'ЗАДАНИЕ',
      out: '/o.json',
      self: ['node', 'bin.js'],
    });
    expect(args).toContain('--strict-mcp-config');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep');
    expect(args.at(-1)).toBe(`Read,Glob,Grep,${SUBMIT_TOOL_ID}`);
    expect(args.join(' ')).not.toContain('ЗАДАНИЕ');
    const config: unknown = JSON.parse(args[args.indexOf('--mcp-config') + 1] ?? '');
    expect(JSON.stringify(config)).toContain(
      '["bin.js","role","channel","verdict","--out","/o.json"]',
    );
  });

  it('role run: ответ через submit_result попадает в --out', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    await put('task.md', 'Задание судье');
    process.env['FAKE_SUBMIT'] = JSON.stringify({ answers: [] });
    process.env['FAKE_ARGS'] = path.join(home, 'args.json');
    expect(
      await main(
        ['role', 'run', 'judge', '--file', 'task.md', '--out', 'a.json', '--root', root],
        NOW,
      ),
    ).toBe(0);
    expect(JSON.parse(await readFile(path.join(root, 'a.json'), 'utf8'))).toEqual({ answers: [] });
    const seen: unknown = JSON.parse(await readFile(path.join(home, 'args.json'), 'utf8'));
    expect(isRecord(seen) ? seen['prompt'] : undefined).toBe('Задание судье');
  });

  it('role run: роль без submit_result — ошибка, а не пустой ответ', async () => {
    await put('agents/judge.md', roleFile('judge', 'verdict'));
    await put('task.md', 'Задание');
    await expect(
      main(['role', 'run', 'judge', '--file', 'task.md', '--root', root], NOW),
    ).rejects.toThrow('не вернула результат');
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

describe('docs-delta: роль docs-keeper', () => {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

  async function project(): Promise<void> {
    await put('context/harness.yml', 'checks:\n  context-index: {}\n');
    await put('context/project.yml', 'name: demo\nnamespaces:\n  core: ядро\n');
    await put('context/conventions/naming.yml', 'key: naming\nsummary: kebab-case\nrule: x\n');
    await put('.agents/agents/docs-keeper.md', roleFile('docs-keeper', 'result'));
    await put('intents.yml', '- kind: rule\n  summary: новое\n  evidence: e\n');
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  }

  const state = async (): Promise<string> => {
    const id = (await readdir(path.join(home, 'sessions')))[0] ?? '';
    return (await openSession(home, id)).data.state;
  };

  it('start --file: apply выполняет роль, дальше verify и close без handoff', async () => {
    await project();
    process.env['FAKE_SUBMIT'] = JSON.stringify(RESULT);
    process.env['FAKE_FILES'] = JSON.stringify({
      'context/.delta/naming.yml':
        'summary: s\nitems:\n  - op: add\n    kind: rule\n    target: other\n    summary: новое\n    evidence: e\n',
      'context/conventions/other.yml': 'key: other\nsummary: новое\nrule: y\n',
    });
    const args = ['--root', root, '--home', home, '--file', 'intents.yml'];
    expect(await main(['docs-delta', 'start', '--name', 'naming', ...args], NOW)).toBe(0);
    expect(await state()).toBe('done');
  });

  it('роль не вернула результат — пауза в apply с заданием для ручного handoff', async () => {
    await project();
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      lines.push(a.join(' '));
    });
    const args = ['--root', root, '--home', home, '--file', 'intents.yml'];
    expect(await main(['docs-delta', 'start', '--name', 'naming', ...args], NOW)).toBe(0);
    expect(await state()).toBe('apply');
    expect(lines.join('\n')).toMatch(/роль docs-keeper: .*не вернула результат.*docs-delta open/s);
  });
});
