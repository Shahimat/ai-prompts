import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '#cli';
import { io } from '#harnesses/plan-review/cli';
import {
  headlessArgs,
  interactiveArgs,
  type HeadlessResult,
  type HeadlessRun,
  type InteractiveRun,
  type ModelRunner,
} from '#harnesses/core/runner/claude';
import type { Prompter } from '#harnesses/core/runner/terminal';
import { openSession } from '#harnesses/core/store/session';
import { PLAN } from './plan-model.test.ts';

const NOW = new Date('2026-10-14T12:00:00Z');

let home: string;
let project: string;
let out: string[];
let err: string[];

interface Fake {
  interactive: InteractiveRun[];
  headless: HeadlessRun[];
  review: (stage: '1b' | '2', n: number) => unknown;
  fix: (text: string, run: HeadlessRun) => string;
  draft: (session: string) => string;
  answer: string;
  askedPlan?: string;
}

let fake: Fake;
let answers: string[];
let interactive: boolean;

const planFor = (session: string) => PLAN.replace('session: demo-1', `session: ${session}`);

function sessionIdFrom(run: { addDirs: string[] }): string {
  return path.basename(run.addDirs[0] ?? '');
}

const runner: ModelRunner = {
  interactive: async (run) => {
    fake.interactive.push(run);
    await writeFile(path.join(run.addDirs[0] ?? '', 'plan.md'), fake.draft(sessionIdFrom(run)));
    return 0;
  },
  headless: async (run): Promise<HeadlessResult> => {
    fake.headless.push(run);
    const result = (structured: unknown, text = ''): HeadlessResult => ({
      text,
      structured,
      sessionId: run.sessionId ?? run.resume,
      costUsd: 0,
    });
    if (run.schema !== undefined) {
      const stage = run.tools.includes('WebSearch') ? '2' : '1b';
      const n = fake.headless.filter(
        (r) => r.schema !== undefined && r.tools.includes('WebSearch') === (stage === '2'),
      ).length;
      return result(fake.review(stage, n));
    }
    const planPath = path.join(run.addDirs[0] ?? '', 'plan.md');
    if (run.systemPrompt.includes('отвечает на вопрос')) {
      fake.askedPlan = await readFile(planPath, 'utf8');
      await writeFile(planPath, 'испорчено');
      return result(undefined, fake.answer);
    }
    await writeFile(planPath, fake.fix(await readFile(planPath, 'utf8'), run));
    return result(undefined, 'исправлено');
  },
};

const prompter = (): Prompter => ({
  interactive,
  say: (text) => {
    out.push(text);
  },
  text: async () => answers.shift() ?? '',
  choose: async () => answers.shift() ?? 'approve',
});

const clean = { findings: [] };
const crit = { findings: [{ criterion: 'dod-checkable', item: 'T1', text: 'DoD не проверяем' }] };

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'harness-home-'));
  project = await mkdtemp(path.join(tmpdir(), 'harness-proj-'));
  await mkdir(path.join(project, '.claude'));
  spawnSync('git', ['init', '-q'], { cwd: project });
  await writeFile(path.join(project, 'README.md'), '# проект\n');
  out = [];
  err = [];
  answers = [];
  interactive = true;
  fake = {
    interactive: [],
    headless: [],
    review: () => clean,
    fix: (t) => t.replace('точка входа.', 'точка входа CLI.'),
    draft: planFor,
    answer: 'потому что так',
  };
  io.runner = () => runner;
  io.prompter = prompter;
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

async function start(): Promise<string> {
  expect(await cli('plan-review', 'start', '--name', 'Демо', '--request', 'спланируй демо')).toBe(
    0,
  );
  const [id = ''] = await readdir(path.join(home, 'sessions'));
  expect(id).toMatch(/^[0-9a-f]{64}$/);
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

describe('plan iter: сквозной прогон', () => {
  it('start → draft → formal → review → согласовать: план согласован, проект не тронут', async () => {
    answers = ['approve'];
    const id = await start();
    const s = await openSession(home, id);
    expect(s.data.state).toBe('approved');
    expect(await transitions(id)).toEqual([
      'draft -done-> formal',
      'formal -ok-> review',
      'review -pass-> awaiting_user',
      'awaiting_user -approve-> approved',
    ]);
    const plan = await readFile(s.planPath, 'utf8');
    expect(plan).toContain('status: approved');
    expect(plan).toContain('## Схема');
    expect(plan).toContain('## Точки улучшения');
    expect(await readdir(project)).toEqual(['.claude', '.git', 'README.md']);
    expect(await readdir(path.join(project, '.claude/artifacts/plan-review'))).toEqual([
      'демо.expect.ts',
    ]);
    expect(
      spawnSync('git', ['status', '--porcelain'], { cwd: project, encoding: 'utf8' }).stdout,
    ).toBe('?? .claude/\n?? README.md\n');
  });

  it('интерактивный планер: роль, каталог сессии, Stop-hook и явные флаги', async () => {
    answers = ['approve'];
    const id = await start();
    const run = fake.interactive[0];
    if (run === undefined) throw new Error('планер не запускался');
    expect(run.cwd).toBe(project);
    expect(run?.addDirs).toEqual([path.join(home, 'sessions', id)]);
    expect(run?.systemPrompt).toContain('Горизонт');
    expect(run?.prompt).toBe('спланируй демо');
    expect(JSON.stringify(run?.settings)).toMatch(/plan-review check \S+ --hook/);
    expect(run?.allowedTools.some((t) => t.startsWith('Bash(') && t.includes('check'))).toBe(true);
    const args = interactiveArgs(run);
    expect(args.slice(0, 3)).toEqual(['--setting-sources', '', '--disable-slash-commands']);
    expect(args[args.indexOf('--tools') + 1]).toBe(run.tools.join(','));
    expect(run.tools).not.toContain('Skill');
  });

  it('ревьюеры получают только копию плана: без context.md, сеть только у стадии 2', async () => {
    answers = ['approve'];
    const id = await start();
    const reviews = fake.headless.filter((r) => r.schema !== undefined);
    expect(reviews).toHaveLength(2);
    const reviewDir = path.join(home, 'sessions', id, 'review', '1');
    const [r1b, r2] = [
      reviews.find((r) => !r.tools.includes('WebSearch')),
      reviews.find((r) => r.tools.includes('WebSearch')),
    ];
    expect(r1b?.cwd).toBe(reviewDir);
    expect(r1b?.addDirs).toEqual([]);
    expect(r1b?.tools).toEqual(['Read']);
    expect(r2?.cwd).toBe(project);
    expect(r2?.addDirs).toEqual([reviewDir]);
    expect((await readdir(reviewDir)).sort()).toEqual(['findings.json', 'plan.md']);
    const copy = await readFile(path.join(reviewDir, 'plan.md'), 'utf8');
    expect(copy).not.toContain('## Схема');
    expect(copy).not.toContain('## Точки улучшения');
    expect(copy).toContain('### T2. Разбор');
    for (const r of reviews) {
      expect(r.systemPrompt).not.toContain('context.md');
      const args = headlessArgs(r);
      expect(args).toContain('--setting-sources');
      expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
      expect(args).toContain('--disable-slash-commands');
      expect(args).toContain('dontAsk');
    }
    if (r1b === undefined) throw new Error('нет прогона 1b');
    expect(headlessArgs(r1b).join(' ')).toContain('--disallowedTools WebSearch,WebFetch');
  });

  it('три правки на цикл, четвёртый провал — failed и справка; retry — новый цикл', async () => {
    fake.review = (stage) => (stage === '1b' ? crit : clean);
    const id = await start();
    let s = await openSession(home, id);
    expect(s.data.state).toBe('failed');
    expect(s.data.round).toBe(4);
    const fixes = fake.headless.filter((r) => r.schema === undefined);
    expect(fixes).toHaveLength(3);
    const report = await readFile(path.join(s.dir, 'failure-report.md'), 'utf8');
    expect(report).toContain('| `dod-checkable` | crit T1 | crit T1 | crit T1 | crit T1 |');
    expect(report).toContain('кандидат на переформулировку');
    expect(fixes[0]?.prompt).toContain('DoD не проверяем');
    expect(fixes[0]?.sessionId).toBeDefined();
    expect(fixes[0]?.resume).toBeUndefined();

    fake.review = () => clean;
    answers = ['approve'];
    expect(await cli('plan-review', 'open', id)).toBe(0);
    s = await openSession(home, id);
    expect(s.data.state).toBe('approved');
    expect(s.data.cycleStart).toBe(5);
  });

  it('провал 1a после draft возобновляет ту же сессию планера и не тратит правку', async () => {
    fake.draft = (session) => planFor(session).replace('- Таймбокс: полдня\n', '');
    fake.fix = (t) =>
      t.replace(
        '- Ожидаемое решение: выбор библиотеки\n',
        '- Ожидаемое решение: выбор библиотеки\n- Таймбокс: полдня\n',
      );
    answers = ['approve'];
    const id = await start();
    const s = await openSession(home, id);
    expect(s.data.state).toBe('approved');
    const repair = fake.headless.find((r) => r.prompt.includes('Проверка структуры'));
    expect(repair?.resume).toBe(fake.interactive[0]?.sessionId);
    expect(repair?.prompt).toContain('S1: нет поля «Таймбокс»');
    expect(s.data.counters['fix'] ?? 0).toBe(0);
    expect(await transitions(id)).toContain('formal -broken-> repair');
  });

  it('Stop-hook не отпускает непроходящий план до предела, затем автомат уходит в failed', async () => {
    fake.draft = (session) => planFor(session).replace('## Цель', '## Задача');
    fake.fix = (t) => t;
    const id = await start();
    expect((await openSession(home, id)).data.state).toBe('failed');
    expect(await transitions(id)).toEqual([
      'draft -done-> formal',
      'formal -broken-> repair',
      'repair -done-> formal',
      'formal -broken-> repair',
      'repair -done-> formal',
      'formal -broken-> repair',
      'repair -done-> formal',
      'formal -broken-> failed',
    ]);
  });

  it('вернуть по пунктам: правка неотмеченного пункта отклоняется, отмеченного и зависимых — принимается', async () => {
    answers = ['walk', '', 'уточни мотивацию', '', 'approve'];
    let call = 0;
    fake.fix = (t) => {
      call += 1;
      return call === 1
        ? t.replace('какой парсер взять', 'другое')
        : t.replace('точка входа.', 'точка входа CLI.');
    };
    const id = await start();
    const s = await openSession(home, id);
    expect(s.data.state).toBe('approved');
    expect(await transitions(id)).toContain('fix -rejected-> fix');
    const plan = await readFile(s.planPath, 'utf8');
    expect(plan).toContain('точка входа CLI.');
    expect(plan).toContain('какой парсер взять');
    expect(plan).toContain('revision: 2');
    const fixes = fake.headless.filter((r) => r.schema === undefined);
    expect(fixes[0]?.prompt).toContain('T1');
    expect(fixes[0]?.prompt).toContain('уточни мотивацию');
    expect(
      (await readdir(path.join(s.dir, 'revisions'))).some((f) => f.startsWith('rejected-')),
    ).toBe(true);
  });

  it('уточнить: plan.md побайтно прежний, ответ дописан в context.md', async () => {
    answers = ['ask', 'почему два пункта?', 'approve'];
    const id = await start();
    const s = await openSession(home, id);
    const plan = await readFile(s.planPath, 'utf8');
    expect(fake.askedPlan).toBeDefined();
    expect(plan.replace('status: approved', 'status: awaiting-user')).toBe(fake.askedPlan);
    const context = await readFile(s.contextPath, 'utf8');
    expect(context).toContain('почему два пункта?');
    expect(context).toContain('потому что так');
    expect(await transitions(id)).toContain('answer -done-> awaiting_user');
  });

  it('переработать — только с комментарием', async () => {
    answers = ['rework', '', 'переделай целиком', 'approve'];
    const id = await start();
    const fixes = fake.headless.filter((r) => r.schema === undefined);
    expect(fixes[0]?.prompt).toContain('переделай целиком');
    expect(out).toContain('без комментария переработка не принимается');
    expect((await openSession(home, id)).data.state).toBe('approved');
  });

  it('без терминала draft встаёт на паузу; resume продолжает', async () => {
    interactive = false;
    const id = await start();
    expect((await openSession(home, id)).data.state).toBe('draft');
    expect(fake.interactive).toHaveLength(0);
    interactive = true;
    answers = ['approve'];
    expect(await cli('plan-review', 'open', id)).toBe(0);
    expect((await openSession(home, id)).data.state).toBe('approved');
  });

  it('согласованный план не правится: повторный open ничего не меняет', async () => {
    answers = ['approve'];
    const id = await start();
    const plan = await readFile(path.join(home, 'sessions', id, 'plan.md'), 'utf8');
    expect(await cli('plan-review', 'open', id)).toBe(0);
    expect(await readFile(path.join(home, 'sessions', id, 'plan.md'), 'utf8')).toBe(plan);
    expect(fake.headless.filter((r) => r.schema === undefined)).toHaveLength(0);
  });
});

describe('harness session: команды', () => {
  it('check: 1a, коды 0 и 1', async () => {
    answers = ['approve'];
    const id = await start();
    expect(await cli('plan-review', 'check', id)).toBe(0);
    const planPath = path.join(home, 'sessions', id, 'plan.md');
    await writeFile(planPath, (await readFile(planPath, 'utf8')).replace('## Цель', '## Задача'));
    expect(await cli('plan-review', 'check', id)).toBe(1);
    expect(err.join('\n')).toContain('нет раздела «## Цель»');
  });

  it('check --hook: молчит без плана и без изменений, блокирует кодом 2, после предела отпускает', async () => {
    interactive = false;
    const id = await start();
    const planPath = path.join(home, 'sessions', id, 'plan.md');
    expect(await cli('plan-review', 'check', id, '--hook')).toBe(0);
    await writeFile(planPath, planFor(id).replace('## Цель', '## Задача'));
    expect(await cli('plan-review', 'check', id, '--hook')).toBe(2);
    expect(await cli('plan-review', 'check', id, '--hook')).toBe(2);
    expect(await cli('plan-review', 'check', id, '--hook')).toBe(2);
    expect(await cli('plan-review', 'check', id, '--hook')).toBe(0);
    expect((await openSession(home, id)).data.formalExhausted).toBe(true);
    await writeFile(planPath, planFor(id));
    expect(await cli('plan-review', 'check', id, '--hook')).toBe(0);
    expect(await cli('plan-review', 'check', id, '--hook')).toBe(0);
  });

  it('list, status, render, read', async () => {
    answers = ['approve'];
    const id = await start();
    out = [];
    expect(await cli('plan-review', 'list')).toBe(0);
    expect(out.join('\n')).toContain(`${id.slice(0, 7)}\tapproved\tДемо`);
    out = [];
    expect(await cli('plan-review', 'status', id)).toBe(0);
    expect(out.join('\n')).toContain('состояние: approved');
    const html = path.join(project, 'out/plan.html');
    expect(await cli('plan-review', 'render', id, '--out', html)).toBe(0);
    expect(await readFile(html, 'utf8')).toContain('<svg');
    vi.stubEnv('BROWSER', process.execPath);
    expect(await cli('plan-review', 'read', id)).toBe(0);
    vi.unstubAllEnvs();
    expect(existsSync(path.join(home, 'sessions', id, 'plan.html'))).toBe(true);
  });

  it('clone md --out кладёт план в проект; clone * — все артефакты в каталог', async () => {
    answers = ['approve'];
    const id = await start();
    expect(await cli('plan-review', 'clone', id, 'md', '--out', 'docs/plan.md')).toBe(0);
    expect(await readFile(path.join(project, 'docs/plan.md'), 'utf8')).toContain(
      'status: approved',
    );
    expect(await cli('plan-review', 'clone', id, '--out', 'all')).toBe(0);
    expect((await readdir(path.join(project, 'all'))).sort()).toEqual(['context.md', 'plan.md']);
  });

  it('сессии лежат в --home, а не в проекте; HARNESS_HOME — тоже', async () => {
    interactive = false;
    await start();
    expect(existsSync(path.join(home, 'sessions'))).toBe(true);
    vi.stubEnv('HARNESS_HOME', home);
    out = [];
    expect(await main(['plan-review', 'list'], NOW)).toBe(0);
    vi.unstubAllEnvs();
    expect(out.join('\n')).toContain('Демо');
  });
});

describe('harness plan: команды', () => {
  it('plan-review validate, plan-review graph', async () => {
    expect(await cli('plan-review', 'validate')).toBe(0);
    expect(out.join('\n')).toContain('plan-review: ok');
    out = [];
    expect(await cli('plan-review', 'graph')).toBe(0);
    expect(out.join('\n')).toContain('review --> fix: fail fix++');
  });

  it('validate: ошибка с путём до поля — код 1', async () => {
    const own = path.join(home, 'harnesses/plan-review');
    await import('node:fs/promises').then((fs) => fs.mkdir(own, { recursive: true }));
    await writeFile(
      path.join(own, 'criteria.yaml'),
      'criteria:\n  - { id: x, stage: 1a, level: crit, text: t }\n',
    );
    expect(await cli('plan-review', 'validate')).toBe(1);
    expect(err.join('\n')).toContain('критерий 1a x не реализован скриптом');
  });

  it('start без --name и без терминала — ошибка вызова', async () => {
    interactive = false;
    await expect(cli('plan-review', 'start')).rejects.toThrow('--name');
  });
});
