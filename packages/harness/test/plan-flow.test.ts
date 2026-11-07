import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '@shahimat/cli';
import { artifactPath, cliCommand, isRecord } from '@shahimat/ai-core';
import { io } from '#harnesses/plan-review/cli';
import { openerFor, servePage } from '#harnesses/plan-review/page';
import { bashDecision, hookEvent } from '#harnesses/plan-review/hook';
import { openSession } from '#harnesses/core/store/session';
import { FAKE_OPENCODE } from './fake-opencode.ts';

const NOW = new Date('2026-10-14T12:00:00Z');
const PLAN_FILE = 'plans/демо.expect.ts';
const TMP = path.join(import.meta.dirname, '.tmp');

const PLANNER_AGENT = `---
# fixture agent для тестов plan-review
description: Планер ожиданий plan-review
mode: subagent
tools:
  read: true
  glob: true
  grep: true
  write: true
  edit: true
  bash: true
  task: true
---

Планер ожиданий: строит файл ожиданий вместе с пользователем.
`;

const JUDGE_AGENT = `---
# fixture agent для тестов plan-review
description: Судья ревью ожиданий
mode: subagent
tools:
  read: true
  glob: true
  grep: true
---

Судья: проверяет ожидания как судья, возвращает JSON-ответ.
`;

const GOOD = `import { describe } from 'vitest';
import { budget, crit, plan } from '@shahimat/ai-core/expect';
budget({ crit: 0, warn: 0 });
plan({ name: 'демо' });
describe('раздел', () => {
  crit('ожидание выполнено', () => {});
});
`;

const RED = GOOD.replace(
  "crit('ожидание выполнено', () => {});",
  "crit('ожидание не выполнено', () => { throw new Error('нет'); });",
);

const BROKEN = `${GOOD}\nconst = ;\n`;

let home: string;
let project: string;
let out: string[];
let err: string[];
let codes: { hook: string; code: number; raw: number; message: string }[];
let session: () => string;
let pages: { root: string; file: string; stopped: boolean }[];
let fakeDir: string;
let fakeBin: string;
let lines: string[];

const planPath = (): string => path.join(project, PLAN_FILE);

interface Turn {
  text?: string;
  files?: Record<string, string>;
  events?: Record<string, unknown>[];
  tools?: string[];
  exit?: number;
  exitMessage?: string;
  answer?: string;
}

const turnFile = (agent: string, n: number): string => path.join(fakeDir, `${agent}-${n}.json`);

async function putTurn(agent: string, n: number, turn: Turn): Promise<void> {
  await writeFile(turnFile(agent, n), `${JSON.stringify(turn, null, 2)}\n`, 'utf8');
}

async function argsRecords(): Promise<Record<string, unknown>[]> {
  const text = await readFile(path.join(fakeDir, 'args.jsonl'), 'utf8').catch(() => '');
  return text
    .trim()
    .split('\n')
    .filter((l) => l !== '')
    .flatMap((l) => {
      const data: unknown = JSON.parse(l);
      return isRecord(data) ? [data] : [];
    });
}

const plannerArgs = async (): Promise<Record<string, unknown>[]> =>
  (await argsRecords()).filter((r) => r['agent'] === 'planner');

const judgeArgs = async (): Promise<Record<string, unknown>[]> =>
  (await argsRecords()).filter((r) => r['agent'] === 'judge');

function blockReason(linesOut: string[]): string | undefined {
  for (const line of linesOut) {
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    if (isRecord(data) && data['decision'] === 'block' && typeof data['reason'] === 'string')
      return data['reason'];
  }
  return undefined;
}

async function hook(name: string, input: Record<string, unknown> = {}): Promise<void> {
  io.stdin = async () => JSON.stringify({ cwd: project, ...input });
  const before = err.length;
  const outBefore = out.length;
  const raw = await main(['plan-review', 'hook', session(), name, '--home', home], NOW);
  const reason = blockReason(out.slice(outBefore));
  codes.push({
    hook: name,
    raw,
    code: reason === undefined ? raw : 2,
    message: reason ?? err.slice(before).join('\n'),
  });
}

async function resetFake(): Promise<void> {
  await rm(fakeDir, { recursive: true, force: true });
  await mkdir(fakeDir, { recursive: true });
}

beforeEach(async () => {
  await mkdir(TMP, { recursive: true });
  home = await mkdtemp(path.join(TMP, 'plan-home-'));
  project = await mkdtemp(path.join(TMP, 'plan-proj-'));
  await mkdir(path.join(project, '.opencode', 'agents'), { recursive: true });
  await writeFile(path.join(project, '.opencode', 'agents', 'planner.md'), PLANNER_AGENT);
  await writeFile(path.join(project, '.opencode', 'agents', 'judge.md'), JUDGE_AGENT);
  await writeFile(
    path.join(project, 'package.json'),
    '{"name":"fixture","private":true,"type":"module"}',
  );
  fakeDir = await mkdtemp(path.join(TMP, 'plan-fake-'));
  fakeBin = path.join(TMP, `fake-opencode-${process.pid}.mjs`);
  out = [];
  err = [];
  codes = [];
  session = () => '';
  lines = [];
  pages = [];
  io.repl = async () => lines.shift() ?? '';
  io.terminal = () => true;
  io.page = async (root, file) => {
    const page = { root, file, stopped: false };
    pages.push(page);
    return {
      url: 'http://127.0.0.1:1/',
      stop: async () => {
        page.stopped = true;
      },
    };
  };
  await writeFile(fakeBin, FAKE_OPENCODE, 'utf8');
  vi.stubEnv('HARNESS_OPENCODE', fakeBin);
  vi.stubEnv('FAKE_DIR', fakeDir);
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    err.push(a.join(' '));
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
  await rm(fakeDir, { recursive: true, force: true });
  await rm(fakeBin, { force: true });
});

const cli = (...args: string[]) => main([...args, '--home', home, '--root', project], NOW);

async function start(turns: Turn[], replLines: string[] = [], ...extra: string[]): Promise<string> {
  await resetFake();
  lines = replLines;
  for (const [i, turn] of turns.entries()) await putTurn('planner', i + 1, turn);
  let id = '';
  session = () => id;
  expect(await cli('plan-review', 'start', PLAN_FILE, ...extra)).toBe(0);
  [id = ''] = await readdir(path.join(home, 'sessions'));
  return id;
}

async function open(id: string, turns: Turn[], replLines: string[] = []): Promise<void> {
  lines = replLines;
  const known = new Set((await readdir(fakeDir)).filter((f) => f.endsWith('.json')));
  for (const [i, turn] of turns.entries()) {
    let n = i + 1;
    while (known.has(`${'planner'}-${n}.json`)) n++;
    await putTurn('planner', n, turn);
  }
  session = () => id;
  expect(await cli('plan-review', 'open', id.slice(0, 7))).toBe(0);
}

async function transitions(id: string): Promise<string[]> {
  const linesLog = (await readFile(path.join(home, 'sessions', id, 'log.jsonl'), 'utf8'))
    .trim()
    .split('\n');
  return linesLog.flatMap((l) => {
    const e: unknown = JSON.parse(l);
    if (typeof e !== 'object' || e === null || !('from' in e) || !('to' in e) || !('event' in e))
      return [];
    return [`${String(e.from)} -${String(e.event)}-> ${String(e.to)}`];
  });
}

const editOn = (): Record<string, unknown> => ({ kind: 'edit', path: PLAN_FILE });

describe('plan-review: события из моста', () => {
  it('hookEvent: событие зависит от состояния и hook', () => {
    const p = '/p/plan.expect.ts';
    const w = { file_path: p };
    expect(hookEvent('awaiting_input', 'prompt', {}, p)).toEqual({ event: 'request' });
    expect(hookEvent('composing', 'prompt', {}, p)).toEqual({});
    expect(hookEvent('gathering', 'edit', w, p)).toEqual({ event: 'gathered' });
    expect(hookEvent('composing', 'edit', w, p)).toEqual({});
    expect(hookEvent('awaiting_input', 'edit', w, p).block).toContain('не меняется');
    expect(hookEvent('composing', 'edit', { file_path: '/p/other.ts' }, p).block).toContain(
      'только файл ожиданий',
    );
    expect(hookEvent('composing', 'ask', {}, p)).toEqual({ event: 'unclear' });
    expect(hookEvent('gathering', 'ask', {}, p)).toEqual({});
    expect(hookEvent('clarify_form', 'answer', {}, p)).toEqual({ event: 'answered' });
    expect(hookEvent('awaiting_input', 'prompt', { prompt: ' Выход ' }, p)).toEqual({
      event: 'exit',
    });
    expect(hookEvent('awaiting_input', 'prompt', { prompt: 'выход из цикла' }, p)).toEqual({
      event: 'request',
    });
    expect(hookEvent('composing', 'prompt', { prompt: 'выход' }, p)).toEqual({});
    for (const state of ['awaiting_input', 'composing'])
      expect(hookEvent(state, 'end', { reason: 'prompt_input_exit' }, p)).toEqual({});
  });

  it('bashDecision: только прогон файла ожиданий', () => {
    expect(bashDecision('x', 'x')).toEqual({});
    expect(bashDecision('ls', 'x').block).toContain('Read, Glob и Grep');
  });

  it('мост: edit-события читаются из файла моста, bash-события игнорируются', async () => {
    const { readPlannerEvents } = await import('#harnesses/plan-review/actions');
    const file = artifactPath(project, { kind: 'bridge', key: 'synthetic-events.jsonl' });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      [
        `${JSON.stringify({ kind: 'prompt', text: 'запрос' })}\n`,
        `${JSON.stringify({ kind: 'bash', command: 'ls', allowed: false })}\n`,
        `${JSON.stringify({ kind: 'edit', path: PLAN_FILE })}\n`,
        'не-json\n',
        `${JSON.stringify({ kind: 'edit', path: PLAN_FILE })}\n`,
      ].join(''),
      'utf8',
    );
    const { input, next } = await readPlannerEvents(file, 0, project);
    expect(input).toEqual([
      { file_path: path.resolve(project, PLAN_FILE) },
      { file_path: path.resolve(project, PLAN_FILE) },
    ]);
    expect(next).toBe(5);
    const again = await readPlannerEvents(file, next, project);
    expect(again.input).toEqual([]);
  });

  it('аттачменты: @путь существующего файла уходит в стадию', async () => {
    const { attachmentsOf } = await import('#harnesses/plan-review/actions');
    await writeFile(path.join(project, 'скрин.png'), 'x', 'utf8');
    expect(attachmentsOf('смотри @скрин.png и @нет.png', project)).toEqual([
      path.join(project, 'скрин.png'),
    ]);
  });
});

describe('plan-review: сквозной прогон на fake-opencode', { timeout: 180_000 }, () => {
  it('запрос → сбор → запись → ревью чистое → выход', async () => {
    const stage = io.stage();
    const runner = io.runner();
    const injectedStages: string[] = [];
    const injectedJudges: string[] = [];
    vi.spyOn(io, 'stage').mockImplementation(() => ({
      run: async (spec) => {
        injectedStages.push(spec.model);
        return stage.run(spec);
      },
    }));
    vi.spyOn(io, 'runner').mockImplementation(() => ({
      headless: async (spec) => {
        injectedJudges.push(spec.model);
        return runner.headless(spec);
      },
    }));
    await writeFile(
      path.join(project, 'manifest.json'),
      JSON.stringify({
        version: 1,
        default: 'openai/base',
        roles: {
          planner: 'openai/planner',
          judge: 'openai/judge',
          'plan-review.planner': 'openai/plan-helper#high',
          'plan-review.judge': 'openai/judge-helper#low',
        },
      }),
    );
    await writeFile(path.join(home, 'manifest.json'), '{invalid-home');
    const id = await start(
      [
        { events: [editOn()], files: { [PLAN_FILE]: GOOD }, text: 'записал' },
        { text: 'Готово.\n[plan-review: exit]' },
      ],
      [],
      '--request',
      'спланируй демо',
    );
    expect(await transitions(id)).toEqual([
      'awaiting_input -request-> gathering',
      'gathering -gathered-> composing',
      'composing -written-> review',
      'review -reviewed-> analyze',
      'analyze -clean-> awaiting_input',
      'awaiting_input -exit-> finished',
    ]);
    expect((await openSession(home, id)).data.state).toBe('finished');
    const planners = await plannerArgs();
    expect(planners.length).toBeGreaterThanOrEqual(2);
    expect(planners[0]?.['task']).toContain('спланируй демо');
    const sessions = new Set(planners.map((r) => r['session']));
    expect(sessions.size).toBe(1);
    expect([...sessions][0]).toMatch(/^ses_/);
    expect((await judgeArgs()).length).toBeGreaterThan(0);
    expect(planners.every((r) => r['model'] === 'openai/plan-helper#high')).toBe(true);
    expect((await judgeArgs()).every((r) => r['model'] === 'openai/judge-helper#low')).toBe(true);
    expect(new Set(injectedStages)).toEqual(new Set(['openai/plan-helper#high']));
    expect(new Set(injectedJudges)).toEqual(new Set(['openai/judge-helper#low']));
    expect(pages).toEqual([{ root: project, file: PLAN_FILE, stopped: true }]);
    expect(out.join('\n')).toContain('finished');
    expect(out.join('\n')).toContain('страница плана: http://127.0.0.1:1/');
  });

  it('флаг exit при замечаниях — отложен; после исправлений — выход', async () => {
    const id = await start(
      [
        { events: [editOn()], files: { [PLAN_FILE]: RED }, text: 'записал\n[plan-review: exit]' },
        { events: [editOn()], files: { [PLAN_FILE]: GOOD }, text: 'исправил\n[plan-review: exit]' },
      ],
      [],
      '--request',
      'спланируй',
    );
    expect((await openSession(home, id)).data.state).toBe('finished');
    expect(await transitions(id)).toContain('analyze -clean-> awaiting_input');
    const planners = await plannerArgs();
    expect(String(planners[1]?.['task'])).toContain('Исправь ожидания по замечаниям');
  });

  it('ответ без записи: gathering → replied → awaiting_input; слово «выход» закрывает сессию', async () => {
    const id = await start(
      [{ text: 'уточни сам' }, { text: 'отвечаю' }, { text: 'Выхожу.\n[plan-review: exit]' }],
      ['что ещё?', 'выйди из плана'],
      '--request',
      'спланируй',
    );
    expect((await transitions(id)).slice(-5)).toEqual([
      'awaiting_input -request-> gathering',
      'gathering -replied-> awaiting_input',
      'awaiting_input -request-> gathering',
      'gathering -replied-> awaiting_input',
      'awaiting_input -exit-> finished',
    ]);
    expect((await openSession(home, id)).data.state).toBe('finished');
    const planners = await plannerArgs();
    expect(String(planners[1]?.['task'])).toBe('что ещё?');
    expect(String(planners[2]?.['task'])).toBe('выйди из плана');
  });

  it('замечания сверх бюджета возвращают к записи; после cycles — к пользователю', async () => {
    const own = path.join(home, 'harnesses/plan-review');
    await mkdir(own, { recursive: true });
    const builtin = await readFile(
      path.join(import.meta.dirname, '../src/harnesses/plan-review/harness.yaml'),
      'utf8',
    );
    await writeFile(path.join(own, 'harness.yaml'), builtin.replace('cycles: 3', 'cycles: 1'));
    const id = await start(
      [
        { events: [editOn()], files: { [PLAN_FILE]: RED }, text: 'раз' },
        { events: [editOn()], files: { [PLAN_FILE]: `${RED}// 2\n` }, text: 'два' },
        { events: [editOn()], files: { [PLAN_FILE]: `${RED}// 3\n` }, text: 'три' },
      ],
      [],
      '--request',
      'спланируй',
    );
    expect((await openSession(home, id)).data.state).toBe('awaiting_input');
    expect((await transitions(id)).filter((t) => t.startsWith('analyze'))).toEqual([
      'analyze -remarks-> composing',
      'analyze -remarks-> awaiting_input',
    ]);
    expect(out.join('\n')).toContain('где зациклился');
  });

  it('файл не собирается: stop блокируется не больше limits.build раз, ревью не идёт', async () => {
    const id = await start(
      [
        { events: [editOn()], files: { [PLAN_FILE]: BROKEN }, text: 'раз' },
        { files: { [PLAN_FILE]: BROKEN }, text: 'два' },
        { files: { [PLAN_FILE]: BROKEN }, text: 'три' },
        { files: { [PLAN_FILE]: BROKEN }, text: 'четыре' },
      ],
      [],
      '--request',
      'спланируй',
    );
    expect((await openSession(home, id)).data.state).toBe('composing');
    expect(await judgeArgs()).toEqual([]);
    expect(out.join('\n')).toContain('не собирается (3/3)');
  });

  it('флаг ask в composing: вопрос пользователю, ответ передаётся планеру дословно', async () => {
    const id = await start(
      [
        {
          events: [editOn()],
          files: { [PLAN_FILE]: GOOD },
          text: 'каким блоком строить?\n[plan-review: ask]',
        },
        {
          events: [editOn()],
          files: { [PLAN_FILE]: `${GOOD}\n// steps\n` },
          text: 'записал steps',
        },
        { text: 'поясняю' },
      ],
      ['steps'],
      '--request',
      'спланируй',
    );
    expect(await transitions(id)).toEqual([
      'awaiting_input -request-> gathering',
      'gathering -gathered-> composing',
      'composing -unclear-> clarify_form',
      'clarify_form -answered-> composing',
      'composing -written-> review',
      'review -reviewed-> analyze',
      'analyze -clean-> awaiting_input',
    ]);
    expect(out.join('\n')).toContain('вопрос планера');
    const planners = await plannerArgs();
    expect(String(planners[1]?.['task'])).toBe('steps');
  }, 200_000);

  it('судья — через fake отдельной ролью; правка файла судьёй отменяется', async () => {
    const id = await start(
      [{ events: [editOn()], files: { [PLAN_FILE]: GOOD }, text: 'записал' }, { text: 'поясняю' }],
      [],
      '--request',
      'спланируй',
    );
    const judges = await judgeArgs();
    expect(judges.length).toBeGreaterThan(0);
    const judgeSessions = new Set(judges.map((r) => r['session']));
    expect(judgeSessions.size).toBe(1);
    expect(await readFile(planPath(), 'utf8')).toBe(GOOD);
    expect(await openSession(home, id)).toBeDefined();
  });

  it('пауза и возобновление: open продолжает с той же сессией opencode', async () => {
    await writeFile(
      path.join(project, 'manifest.json'),
      JSON.stringify({ version: 1, default: 'openai/before', roles: {} }),
    );
    const id = await start(
      [{ events: [editOn()], files: { [PLAN_FILE]: GOOD }, text: 'записал' }],
      [],
      '--request',
      'спланируй',
    );
    expect((await openSession(home, id)).data.state).toBe('awaiting_input');
    await hook('end', { reason: 'interrupt' });
    expect((await openSession(home, id)).data.state).toBe('awaiting_input');
    const before = await plannerArgs();
    await writeFile(
      path.join(project, 'manifest.json'),
      JSON.stringify({ version: 1, default: 'openai/after', roles: {} }),
    );
    await open(id, [{ text: 'дополнил' }], ['добавь ещё']);
    const after = await plannerArgs();
    expect(after.length).toBeGreaterThan(before.length);
    expect(before.every((r) => r['model'] === 'openai/before')).toBe(true);
    expect(after.slice(before.length).every((r) => r['model'] === 'openai/after')).toBe(true);
    expect(new Set(after.map((r) => r['session']))).toEqual(
      new Set(before.map((r) => r['session'])),
    );
  });

  it('аттачменты запроса уходят в стадию планера через -f', async () => {
    await writeFile(path.join(project, 'схема.png'), 'x', 'utf8');
    await start([{ text: 'глянул' }], [], '--request', 'смотри @схема.png');
    const planners = await plannerArgs();
    expect(planners[0]?.['files']).toEqual([path.join(project, 'схема.png')]);
  });

  it('стартовые проверки: agent-фикстура обязательна, hook CLI отвечает JSON-блокировкой', async () => {
    const own = path.join(project, '.opencode', 'agents', 'planner.md');
    await rm(own);
    await expect(cli('plan-review', 'start', PLAN_FILE)).rejects.toThrow('агента планера');
    await writeFile(own, PLANNER_AGENT);
    const id = await start([{ text: 'ок' }], ['привет'], '--request', 'спланируй');
    session = () => id;
    await hook('bash', { command: 'ls' });
    expect(codes.at(-1)?.code).toBe(2);
    expect(codes.at(-1)?.message).toContain('только прогон файла ожиданий');
    await hook('end', { reason: 'test' });
    expect(codes.at(-1)?.code).toBe(0);
  });

  it('команды: validate, graph, list, status; start без файла — ошибка', async () => {
    expect(await cli('plan-review', 'validate')).toBe(0);
    expect(out.join('\n')).toContain('plan-review: ok');
    out = [];
    expect(await cli('plan-review', 'graph')).toBe(0);
    expect(out.join('\n')).toContain('analyze --> composing: remarks cycles++');
    const id = await start([{ text: 'ок' }], ['привет'], '--request', 'спланируй');
    out = [];
    expect(await cli('plan-review', 'list')).toBe(0);
    expect(out.join('\n')).toContain('демо');
    expect(await cli('plan-review', 'status', id.slice(0, 7))).toBe(0);
    expect(out.join('\n')).toContain(`план: ${PLAN_FILE}`);
    await expect(cli('plan-review', 'start')).rejects.toThrow('<file>');
  });
});

describe('plan-review: страница плана', () => {
  it('servePage: настоящий expect serve на свободном порту, BROWSER=none не открывает браузер', async () => {
    vi.stubEnv('BROWSER', 'none');
    expect(openerFor('http://x/')).toBeUndefined();
    await mkdir(path.join(project, 'plans'), { recursive: true });
    await writeFile(planPath(), GOOD, 'utf8');
    const page = await servePage(cliCommand(), project, PLAN_FILE);
    try {
      expect(page.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const res = await fetch(page.url);
      expect(res.status).toBe(200);
    } finally {
      await page.stop();
      vi.unstubAllEnvs();
    }
    await expect(fetch(page.url)).rejects.toThrow();
  });
});
