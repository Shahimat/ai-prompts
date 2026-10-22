import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '#cli';
import { io, selfCommand } from '#harnesses/plan-review/cli';
import { openerFor, servePage } from '#harnesses/plan-review/page';
import { hookEvent } from '#harnesses/plan-review/hook';
import {
  interactiveArgs,
  type HeadlessResult,
  type HeadlessRun,
  type InteractiveRun,
  type ModelRunner,
} from '#harnesses/core/runner/claude';
import { openSession } from '#harnesses/core/store/session';
import { isRecord } from '#shared/guards';

const NOW = new Date('2026-10-14T12:00:00Z');
const PLAN_FILE = 'plans/демо.expect.ts';
const TMP = path.join(import.meta.dirname, '.tmp');

const GOOD = `import { describe } from 'vitest';
import { budget, crit, plan } from '@shahimat/harness/expect';
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

type Step = { hook: string; input?: Record<string, unknown>; write?: string };

interface Fake {
  interactive: InteractiveRun[];
  headless: HeadlessRun[];
  steps: Step[];
}

let fake: Fake;

const planPath = (): string => path.join(project, PLAN_FILE);

function blockReason(lines: string[]): string | undefined {
  for (const line of lines) {
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

const runner: ModelRunner = {
  interactive: async (run) => {
    fake.interactive.push(run);
    for (const step of fake.steps.splice(0)) {
      if (step.write !== undefined) await writeFile(planPath(), step.write, 'utf8');
      else await hook(step.hook, step.input);
    }
    return 0;
  },
  headless: async (run): Promise<HeadlessResult> => {
    fake.headless.push(run);
    const structured =
      run.schema !== undefined && JSON.stringify(run.schema).includes('contradictions')
        ? { contradictions: [], unmeasurable: [] }
        : { answers: [] };
    return { text: '', structured, sessionId: undefined, costUsd: 0 };
  },
};

beforeEach(async () => {
  await mkdir(TMP, { recursive: true });
  home = await mkdtemp(path.join(TMP, 'plan-home-'));
  project = await mkdtemp(path.join(TMP, 'plan-proj-'));
  await mkdir(path.join(project, '.claude'));
  await writeFile(
    path.join(project, 'package.json'),
    '{"name":"fixture","private":true,"type":"module"}',
  );
  out = [];
  err = [];
  codes = [];
  fake = { interactive: [], headless: [], steps: [] };
  session = () => '';
  io.runner = () => runner;
  io.terminal = () => true;
  pages = [];
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
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    err.push(a.join(' '));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});

const cli = (...args: string[]) => main([...args, '--home', home, '--root', project], NOW);

async function start(steps: Step[], ...extra: string[]): Promise<string> {
  fake.steps = steps;
  let id = '';
  session = () => id;
  const sessions = path.join(home, 'sessions');
  const original = runner.interactive;
  const wrapped: ModelRunner = {
    headless: runner.headless,
    interactive: async (run) => {
      [id = ''] = await readdir(sessions);
      return original(run);
    },
  };
  io.runner = () => wrapped;
  expect(await cli('plan-review', 'start', PLAN_FILE, ...extra)).toBe(0);
  [id = ''] = await readdir(sessions);
  return id;
}

async function transitions(id: string): Promise<string[]> {
  const lines = (await readFile(path.join(home, 'sessions', id, 'log.jsonl'), 'utf8'))
    .trim()
    .split('\n');
  return lines.flatMap((l) => {
    const e: unknown = JSON.parse(l);
    if (typeof e !== 'object' || e === null || !('from' in e) || !('to' in e) || !('event' in e))
      return [];
    return [`${String(e.from)} -${String(e.event)}-> ${String(e.to)}`];
  });
}

const edit = (): Step => ({
  hook: 'edit',
  input: { tool_name: 'Write', tool_input: { file_path: planPath() } },
});

describe('plan-review: события из hooks', () => {
  it('hookEvent: событие зависит от состояния и hook', () => {
    const p = '/p/plan.expect.ts';
    const w = { tool_name: 'Write', file_path: p };
    expect(hookEvent('awaiting_input', 'prompt', {}, p)).toEqual({ event: 'request' });
    expect(hookEvent('composing', 'prompt', {}, p)).toEqual({});
    expect(hookEvent('gathering', 'edit', w, p)).toEqual({ event: 'gathered' });
    expect(hookEvent('composing', 'edit', w, p)).toEqual({});
    expect(hookEvent('awaiting_input', 'edit', w, p).block).toContain('не меняется');
    expect(hookEvent('composing', 'edit', { ...w, file_path: '/p/other.ts' }, p).block).toContain(
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
});

describe('plan-review: сквозной прогон', { timeout: 120_000 }, () => {
  it('запрос → сбор → запись → ревью чистое → выход', async () => {
    const id = await start(
      [
        { hook: 'prompt' },
        edit(),
        { hook: '', write: GOOD },
        { hook: 'stop' },
        { hook: 'stop' },
        { hook: 'prompt', input: { prompt: 'выход' } },
        { hook: 'prompt', input: { prompt: 'ещё' } },
      ],
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
    const stops = codes.filter((c) => c.hook === 'stop');
    expect(stops.map((c) => c.code)).toEqual([2, 0]);
    expect(stops[0]?.message).toContain('чистое');
    expect(stops[0]?.raw).toBe(0);
    expect(codes.filter((c) => c.hook === 'prompt').map((c) => c.code)).toEqual([0, 2, 2]);
    expect(codes.at(-1)?.message).toContain('завершена');
    expect(out.join('\n')).toContain('finished');
  });

  it('флаг exit в ответе планера: после чистого ревью — выход, при замечаниях — отложен', async () => {
    const flag = { last_assistant_message: 'Готово.\n[plan-review: exit]' };
    const done = await start([
      { hook: 'prompt' },
      edit(),
      { hook: '', write: GOOD },
      { hook: 'stop', input: flag },
    ]);
    expect((await transitions(done)).at(-1)).toBe('awaiting_input -exit-> finished');
    expect(codes.at(-1)?.code).toBe(0);
    codes = [];
    fake.interactive = [];
    await rm(home, { recursive: true, force: true });
    const red = await start([
      { hook: 'prompt' },
      edit(),
      { hook: '', write: RED },
      { hook: 'stop', input: flag },
    ]);
    expect((await openSession(home, red)).data.state).toBe('composing');
    expect(codes.at(-1)?.code).toBe(2);
    expect(codes.at(-1)?.message).toContain('Выход отложен');
  });

  it('ответ без записи файла: gathering → replied → awaiting_input; просьба выйти без правок закрывает сессию', async () => {
    const flag = { last_assistant_message: 'Выхожу.\n[plan-review: exit]' };
    const id = await start([
      { hook: 'prompt' },
      edit(),
      { hook: '', write: GOOD },
      { hook: 'stop' },
      { hook: 'prompt', input: { prompt: 'что ещё?' } },
      { hook: 'stop' },
      { hook: 'prompt', input: { prompt: 'выйди из плана' } },
      { hook: 'stop', input: flag },
    ]);
    expect((await transitions(id)).slice(-5)).toEqual([
      'awaiting_input -request-> gathering',
      'gathering -replied-> awaiting_input',
      'awaiting_input -request-> gathering',
      'gathering -replied-> awaiting_input',
      'awaiting_input -exit-> finished',
    ]);
    expect(codes.at(-1)?.code).toBe(0);
  });

  it('флаг выхода после ревью с замечаниями — выход отложен и из awaiting_input', async () => {
    const flag = { last_assistant_message: 'Выхожу.\n[plan-review: exit]' };
    const own = path.join(home, 'harnesses/plan-review');
    await mkdir(own, { recursive: true });
    const builtin = await readFile(
      path.join(import.meta.dirname, '../src/harnesses/plan-review/harness.yaml'),
      'utf8',
    );
    await writeFile(path.join(own, 'harness.yaml'), builtin.replace('cycles: 3', 'cycles: 1'));
    const id = await start([
      { hook: 'prompt' },
      edit(),
      { hook: '', write: RED },
      { hook: 'stop' },
      { hook: '', write: `${RED}// 2\n` },
      { hook: 'stop' },
      { hook: 'prompt', input: { prompt: 'выйди' } },
      { hook: 'stop', input: flag },
    ]);
    expect((await openSession(home, id)).data.state).toBe('awaiting_input');
    expect(codes.at(-1)?.message).toContain('Выход отложен');
  });

  it('Ctrl+C в любом состоянии — пауза: автомат на месте, open продолжает через --resume', async () => {
    const id = await start([
      { hook: 'prompt' },
      edit(),
      { hook: '', write: GOOD },
      { hook: 'end', input: { reason: 'other' } },
    ]);
    expect((await openSession(home, id)).data.state).toBe('composing');
    expect(await readFile(planPath(), 'utf8')).toBe(GOOD);
    expect(await cli('plan-review', 'open', id.slice(0, 7))).toBe(0);
    expect(fake.interactive.map((r) => r.resume)).toEqual([false, true]);
    expect((await openSession(home, id)).data.state).toBe('composing');
  });

  it('планер: роль, запрос первым сообщением, hooks в настройках, только файл плана на запись', async () => {
    await start([], '--request', 'спланируй демо');
    const run = fake.interactive[0];
    if (run === undefined) throw new Error('планер не запускался');
    expect(run.cwd).toBe(project);
    expect(run.name).toBe('plan-review · демо');
    expect(run.prompt).toBe('спланируй демо');
    expect(run.systemPrompt).toContain(PLAN_FILE);
    const settings = JSON.stringify(run.settings);
    for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'])
      expect(settings).toContain(event);
    expect(settings).toMatch(/plan-review hook \S+ stop/);
    expect(run.allowedTools.filter((t) => t.startsWith('Edit('))).toEqual([`Edit(/${planPath()})`]);
    expect(run.allowedTools.some((t) => t.includes('plan-review hook'))).toBe(false);
    const args = interactiveArgs(run);
    expect(args.slice(0, 3)).toEqual(['--setting-sources', '', '--disable-slash-commands']);
    expect(run.tools).not.toContain('Skill');
  });

  it('замечания сверх бюджета возвращают к записи; после cycles — к пользователю', async () => {
    const id = await start([
      { hook: 'prompt' },
      edit(),
      ...[1, 2, 3, 4].flatMap((n): Step[] => [
        { hook: '', write: `${RED}// ${n}\n` },
        { hook: 'stop' },
      ]),
    ]);
    const s = await openSession(home, id);
    expect(s.data.state).toBe('awaiting_input');
    const stops = codes.filter((c) => c.hook === 'stop');
    expect(stops.map((c) => c.code)).toEqual([2, 2, 2, 2]);
    expect(stops[0]?.message).toContain('ожидание не выполнено');
    expect(stops[3]?.message).toContain('где зациклился');
    expect((await transitions(id)).filter((t) => t.startsWith('analyze'))).toEqual([
      'analyze -remarks-> composing',
      'analyze -remarks-> composing',
      'analyze -remarks-> composing',
      'analyze -remarks-> awaiting_input',
    ]);
  });

  it('файл не собирается: Stop блокируется не больше limits.build раз, ревью не идёт', async () => {
    const id = await start([
      { hook: 'prompt' },
      edit(),
      { hook: '', write: BROKEN },
      { hook: 'stop' },
      { hook: 'stop' },
      { hook: 'stop' },
      { hook: 'stop' },
    ]);
    expect(codes.filter((c) => c.hook === 'stop').map((c) => c.code)).toEqual([2, 2, 2, 0]);
    expect((await openSession(home, id)).data.state).toBe('composing');
    expect(fake.headless).toEqual([]);
  });

  it('судья — без записи и без сети; правка файла судьёй отменяется', async () => {
    const judge = runner.headless;
    runner.headless = async (run) => {
      await writeFile(planPath(), 'испорчено', 'utf8');
      return judge(run);
    };
    try {
      await start([{ hook: 'prompt' }, edit(), { hook: '', write: GOOD }, { hook: 'stop' }]);
    } finally {
      runner.headless = judge;
    }
    expect(fake.headless.length).toBeGreaterThan(0);
    for (const r of fake.headless) {
      expect(r.tools).toEqual(['Read', 'Glob', 'Grep']);
      expect(r.persist).toBe(false);
    }
    expect(await readFile(planPath(), 'utf8')).toBe(GOOD);
  });
});

describe('plan-review: страница плана', () => {
  it('сессия планера поднимает страницу своего файла и гасит её при закрытии; адрес — в промпте и в ответе чистого ревью', async () => {
    await start([{ hook: 'prompt' }, edit(), { hook: '', write: GOOD }, { hook: 'stop' }]);
    expect(pages).toEqual([{ root: project, file: PLAN_FILE, stopped: true }]);
    expect(fake.interactive[0]?.systemPrompt).toContain('http://127.0.0.1:1/');
    expect(codes.find((c) => c.hook === 'stop')?.message).toContain('http://127.0.0.1:1/');
    expect(out.join('\n')).toContain('страница плана: http://127.0.0.1:1/');
  });

  it('servePage: настоящий expect serve на свободном порту, BROWSER=none не открывает браузер', async () => {
    vi.stubEnv('BROWSER', 'none');
    expect(openerFor('http://x/')).toBeUndefined();
    await mkdir(path.join(project, 'plans'), { recursive: true });
    await writeFile(planPath(), GOOD, 'utf8');
    const page = await servePage(selfCommand(), project, PLAN_FILE);
    try {
      expect(page.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(page.url).not.toContain(':4173/');
      const res = await fetch(page.url);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('ожидание выполнено');
    } finally {
      await page.stop();
      vi.unstubAllEnvs();
    }
    await expect(fetch(page.url)).rejects.toThrow();
  });

  it('страница не поднялась — планер всё равно запускается', async () => {
    io.page = async () => {
      throw new Error('нет порта');
    };
    await start([]);
    expect(fake.interactive).toHaveLength(1);
    expect(err.join('\n')).toContain('страница плана не поднялась: нет порта');
  });
});

describe('plan-review: Bash в сессии планера', () => {
  it('Bash — только expect report своего файла; остальное блокируется hook', async () => {
    const id = await start([]);
    const run = fake.interactive[0];
    const report = (run?.allowedTools ?? [])
      .map((t) => /^Bash\((.*)\)$/.exec(t)?.[1])
      .find((c) => c !== undefined);
    if (report === undefined) throw new Error('нет разрешённой команды Bash');
    session = () => id;
    for (const command of [report, `  ${report}  `])
      await hook('bash', { tool_input: { command } });
    for (const command of ['ls', 'echo x > a.txt', `cd /tmp && ${report}`, `${report}; rm -rf .`])
      await hook('bash', { tool_input: { command } });
    expect(codes.map((c) => c.code)).toEqual([0, 0, 2, 2, 2, 2]);
    expect(codes.at(-1)?.message).toContain('Read, Glob и Grep');
    expect(JSON.stringify(run?.settings)).toMatch(/"matcher":"Bash".*plan-review hook \S+ bash/);
  });
});

describe('plan-review: команды', () => {
  it('без терминала start встаёт на паузу; open запускает планера, повторный open — --resume', async () => {
    io.terminal = () => false;
    const id = await start([]);
    expect(fake.interactive).toEqual([]);
    expect(out.join('\n')).toContain(`harness plan-review open ${id.slice(0, 7)}`);
    io.terminal = () => true;
    session = () => id;
    expect(await cli('plan-review', 'open', id.slice(0, 7))).toBe(0);
    expect(await cli('plan-review', 'open', id.slice(0, 7))).toBe(0);
    expect(fake.interactive.map((r) => r.resume)).toEqual([false, true]);
    expect(fake.interactive[1]?.sessionId).toBe(fake.interactive[0]?.sessionId);
    const resumed = fake.interactive[1];
    if (resumed === undefined) throw new Error('повторный open не запускал планера');
    expect(interactiveArgs(resumed)).toContain('--resume');
  });

  it('validate, graph, list, status', async () => {
    expect(await cli('plan-review', 'validate')).toBe(0);
    expect(out.join('\n')).toContain('plan-review: ok');
    out = [];
    expect(await cli('plan-review', 'graph')).toBe(0);
    expect(out.join('\n')).toContain('analyze --> composing: remarks cycles++');
    const id = await start([]);
    out = [];
    expect(await cli('plan-review', 'list')).toBe(0);
    expect(out.join('\n')).toContain('демо');
    expect(await cli('plan-review', 'status', id.slice(0, 7))).toBe(0);
    expect(out.join('\n')).toContain(`план: ${PLAN_FILE}`);
  });

  it('hook: неизвестное имя — ошибка вызова', async () => {
    const id = await start([]);
    await expect(cli('plan-review', 'hook', id.slice(0, 7), 'nope')).rejects.toThrow('hook');
  });

  it('start без файла плана — ошибка вызова', async () => {
    await expect(cli('plan-review', 'start')).rejects.toThrow('<file>');
  });
});
