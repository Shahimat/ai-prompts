import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import {
  BUILTIN_HARNESSES,
  CRITERIA_SCHEMA,
  findCommand,
  FSM_SCHEMA,
  harnessHome,
  headlessArgs,
  loadHarness,
  openSession,
  parseMachine,
  planIo,
  planReviewRegistry,
  REVIEW_TOOLS,
  staticErrors,
  verdict,
  type Finding,
  type ModelRunner,
  type Prompter,
} from '@shahimat/harness';
import {
  budget,
  crit,
  dataFiles,
  expectSchema,
  judged,
  readRepo,
  repoRoot,
  warn,
} from '@shahimat/harness/expect';
import { parseJson } from './shared/guards.ts';

budget({ crit: 0, warn: 0 });

describe('[harness] plan-review start', () => {
  crit(
    'harness plan-review start <file>: существующий файл ожиданий — план изменения его состояния; нового файла нет — создаётся каркас с plan({ name })',
    () => Start.file(),
  );
  crit('имя плана берётся из plan({ name }) в файле; для нового файла — из имени файла', () =>
    Start.name(),
  );
  crit(
    'без --request запрос пишется в интерактивной сессии планера: текст, файлы, картинки; start его не спрашивает',
    () => Start.request(),
  );
  crit('plan({ name }): шапка страницы — имя плана, под ним перечень блоков', () =>
    Start.htmlHeader(),
  );
});

describe('[harness] plan-review', () => {
  crit(
    'команды планера: harness plan-review start | open | list | status | validate | graph | check | render | read | clone',
    () => Check.commands(),
  );
  crit('результат планера — plan.md; HTML для просмотра собирает отдельная команда render', () =>
    Check.planIsSource(),
  );
  crit('сессии лежат в ~/.config/harness; каталог переопределяется параметром', () => Check.home());
  warn(
    'переходами управляет автомат из harness.yaml; модель работает только внутри состояний',
    () => Check.fsmDrives(),
  );
  crit(
    'граф автомата проверяется статически: все состояния достижимы, тупиков нет, у каждого цикла есть лимит',
    () => Check.staticGraph(),
  );
  crit('в harness.yaml нет выражений: guards и действия — имена из реестра', () =>
    Check.noExpressions(),
  );
  crit('критерии ревью плана — один criteria.yaml по схеме plan-criteria', () =>
    Check.criteriaFile(),
  );
  crit('бюджет стадии ревью: crit 0, warn не больше 3; info не блокирует', () => Check.budget());
  crit('проверка структуры плана (1a) не расходует попыток правки', () => Check.formalFree());
  crit('не больше 3 правок на цикл ревью; после четвёртого провала — failure-report.md', () =>
    Check.fixLimit(),
  );
  crit('ревьюеры плана не получают context.md', () => Check.reviewersBlind());
  crit('у стадии ревью без сети нет WebSearch и WebFetch', () => Check.offlineStage());
  crit('после «уточнить» plan.md не меняется ни на байт', () => Check.askKeepsPlan());
  crit('после «вернуть на доработку» изменены только отмеченные пункты и зависящие от них', () =>
    Check.reviseScope(),
  );
  crit('согласованный план не правится', () => Check.approvedFrozen());
  warn('планер не планирует дальше нерешённого spike', () => Check.spikeHorizon());
  crit('headless-прогоны задают флаги явно и не исполняют hooks проекта', () =>
    Check.explicitFlags(),
  );
});

const NOW = new Date('2026-10-14T12:00:00Z');

const PLAN = `---
harness: plan-review
session: SESSION
status: draft
revision: 1
---
# Демо

## Цель

Проверить планер.

## Пункты

### S1. Какой парсер?
- Тип: spike
- Вопрос: какой парсер взять
- Ожидаемое решение: выбор библиотеки
- Таймбокс: полдня

### T1. Каркас
- Тип: task
- Зависит от: —
- Мотивация: точка входа.
- DoD:
  - [ ] команда запускается

### T2. Разбор
- Тип: task
- Зависит от: S1
- Мотивация: модель плана.
- DoD:
  - [ ] разбор обратим

## За горизонтом

- Исполнение плана.
`;

type HeadlessRun = Parameters<ModelRunner['headless']>[0];
type InteractiveRun = Parameters<ModelRunner['interactive']>[0];

interface Script {
  answers: string[];
  review?: (stage: '1b' | '2') => unknown;
  fix?: (text: string, n: number) => string;
  draft?: (session: string) => string;
  plan?: string;
  request?: string;
}

interface Flow {
  home: string;
  project: string;
  id: string;
  dir: string;
  interactive: InteractiveRun[];
  headless: HeadlessRun[];
  askedPlan?: string;
  run: (...words: string[]) => Promise<number>;
}

async function withFlow(
  script: Script,
  fn: (flow: Flow) => Promise<void>,
  files: Record<string, string> = {},
): Promise<void> {
  const home = await mkdtemp(path.join(tmpdir(), 'plan-review-home-'));
  const project = await mkdtemp(path.join(tmpdir(), 'plan-review-proj-'));
  spawnSync('git', ['init', '-q'], { cwd: project });
  await mkdir(path.join(project, '.claude'), { recursive: true });
  await writeFile(path.join(project, 'README.md'), '# проект\n');
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(project, rel)), { recursive: true });
    await writeFile(path.join(project, rel), text);
  }
  const saved = { runner: planIo.runner, prompter: planIo.prompter };
  const flow: Flow = {
    home,
    project,
    id: '',
    dir: '',
    interactive: [],
    headless: [],
    run: async (...words) => {
      const outAt = words.indexOf('--out');
      const positionals = outAt >= 0 ? words.slice(0, outAt) : words;
      const match = findCommand(positionals);
      if (match === undefined) throw new Error(`нет команды ${words.join(' ')}`);
      return match.command.run({
        root: project,
        now: NOW,
        home,
        params: match.params,
        request: script.request ?? 'спланируй',
        ...(outAt >= 0 ? { out: words[outAt + 1] ?? '' } : {}),
      });
    },
  };
  let fixes = 0;
  const runner: ModelRunner = {
    interactive: async (run) => {
      flow.interactive.push(run);
      const session = path.basename(run.addDirs[0] ?? '');
      const draft = script.draft ?? ((s: string) => PLAN.replace('SESSION', s));
      await writeFile(path.join(run.addDirs[0] ?? '', 'plan.md'), draft(session));
      return 0;
    },
    headless: async (run) => {
      flow.headless.push(run);
      const planPath = path.join(run.addDirs[0] ?? '', 'plan.md');
      if (run.schema !== undefined) {
        const stage = run.tools.includes('WebSearch') ? '2' : '1b';
        return {
          text: '',
          structured: script.review?.(stage) ?? { findings: [] },
          sessionId: undefined,
          costUsd: 0,
        };
      }
      if (run.systemPrompt.includes('отвечает на вопрос')) {
        flow.askedPlan = await readFile(planPath, 'utf8');
        await writeFile(planPath, 'ответчик испортил план');
        return { text: 'ответ', structured: undefined, sessionId: undefined, costUsd: 0 };
      }
      fixes += 1;
      const text = await readFile(planPath, 'utf8');
      await writeFile(planPath, script.fix?.(text, fixes) ?? text);
      return { text: 'ok', structured: undefined, sessionId: run.sessionId, costUsd: 0 };
    },
  };
  const prompter: Prompter = {
    interactive: true,
    say: () => undefined,
    text: async () => script.answers.shift() ?? '',
    choose: async () => script.answers.shift() ?? 'approve',
  };
  planIo.runner = () => runner;
  planIo.prompter = () => prompter;
  const log = console.log;
  console.log = () => undefined;
  try {
    await flow.run('plan-review', 'start', script.plan ?? `${ARTIFACTS}/демо.expect.ts`);
    const [id = ''] = await readdir(path.join(home, 'sessions'));
    flow.id = id;
    flow.dir = path.join(home, 'sessions', id);
    await fn(flow);
  } finally {
    console.log = log;
    planIo.runner = saved.runner;
    planIo.prompter = saved.prompter;
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
}

const state = async (flow: Flow): Promise<string> =>
  (await openSession(flow.home, flow.id)).data.state;

const CRIT_1B = { findings: [{ criterion: 'dod-checkable', item: 'T1', text: 'не проверяем' }] };

async function builtinDef() {
  const result = await loadHarness(path.join(tmpdir(), 'plan-review-no-home'), 'plan-review');
  if (result.harness === undefined) throw new Error(result.errors.join('\n'));
  return result.harness;
}

class Check {
  static async commands(): Promise<void> {
    const lines = [
      'plan-review start f.expect.ts',
      'plan-review open s',
      'plan-review list',
      'plan-review status s',
      'plan-review validate',
      'plan-review graph',
      'plan-review check s',
      'plan-review render s',
      'plan-review read s',
      'plan-review clone s',
      'plan-review clone s md',
    ];
    expect(lines.filter((l) => findCommand(l.split(' ')) === undefined)).toEqual([]);
  }

  static async planIsSource(): Promise<void> {
    await withFlow({ answers: ['approve'] }, async (flow) => {
      expect(await state(flow)).toBe('approved');
      expect(existsSync(path.join(flow.dir, 'plan.md'))).toBe(true);
      expect(existsSync(path.join(flow.dir, 'plan.html'))).toBe(false);
      expect(await flow.run('plan-review', 'render', flow.id)).toBe(0);
      expect(await readFile(path.join(flow.dir, 'plan.html'), 'utf8')).toContain('<svg');
    });
  }

  static async home(): Promise<void> {
    expect(harnessHome()).toBe(path.join(homedir(), '.config', 'harness'));
    expect(harnessHome('/tmp/elsewhere')).toBe(path.resolve('/tmp/elsewhere'));
    await withFlow({ answers: ['approve'] }, async (flow) => {
      expect(flow.dir.startsWith(path.join(flow.home, 'sessions'))).toBe(true);
    });
  }

  static fsmDrives = (): Promise<void> => judged(['@fsm-drive']);

  static async staticGraph(): Promise<void> {
    const { def, registry } = await builtinDef();
    expect(staticErrors(def, registry, 'h')).toEqual([]);
    const yaml = (on: string) =>
      `harness: t-t\ninitial: a\nstates:\n  a:\n    action: plan-check\n    on:\n${on}\n  z:\n    final: true\n`;
    const parsed = parseMachine(yaml('      ok: a\n      broken: a\n      exhausted: a'), 'h');
    if (parsed.def === undefined) throw new Error(parsed.errors.join('\n'));
    const errors = staticErrors(parsed.def, registry, 'h').join('\n');
    expect(errors).toContain('недостижимо');
    expect(errors).toContain('цикл без лимита');
    const dead = parseMachine(
      'harness: t-t\ninitial: a\nstates:\n  a:\n    action: plan-check\n',
      'h',
    );
    if (dead.def === undefined) throw new Error(dead.errors.join('\n'));
    expect(staticErrors(dead.def, registry, 'h').join('\n')).toContain('тупик');
  }

  static async noExpressions(): Promise<void> {
    const text = await readFile(path.join(BUILTIN_HARNESSES, 'plan-review/harness.yaml'), 'utf8');
    expect(parseMachine(text, 'h').errors).toEqual([]);
    const expr = text.replace('pass: awaiting_user', "pass: 'crit == 0 ? awaiting_user : fix'");
    expect(parseMachine(expr, 'h').errors.join('\n')).toContain('h/states/review/on/pass');
    const { def } = await builtinDef();
    const registry = planReviewRegistry();
    expect(
      def.states.filter((s) => s.action !== undefined && !registry.actions.has(s.action)),
    ).toEqual([]);
    expect(parseJson(await readRepo('expectations/schemas/harness-fsm.schema.json'))).toEqual(
      FSM_SCHEMA,
    );
  }

  static async criteriaFile(): Promise<void> {
    const files = (
      await readdir(path.join(BUILTIN_HARNESSES, 'plan-review'), { recursive: true })
    ).filter((f) => /criteria.*\.ya?ml$/.test(f));
    expect(files).toEqual(['criteria.yaml']);
    await expectSchema(
      await dataFiles(['packages/harness/src/harnesses/plan-review/criteria.yaml']),
      'expectations/schemas/plan-criteria.schema.json',
    );
    expect(parseJson(await readRepo('expectations/schemas/plan-criteria.schema.json'))).toEqual(
      CRITERIA_SCHEMA,
    );
  }

  static async budget(): Promise<void> {
    const { def } = await builtinDef();
    expect(def.review.budget).toEqual({ crit: 0, warn: 3 });
    const f = (level: Finding['level']): Finding => ({
      criterion: 'c',
      level,
      stage: '1b',
      item: 'T1',
      text: 't',
    });
    const passes = (list: Finding[]) => verdict(list, def.review.budget).every((v) => v.pass);
    expect(
      passes([f('warn'), f('warn'), f('warn'), f('info'), f('info'), f('info'), f('info')]),
    ).toBe(true);
    expect(passes([f('warn'), f('warn'), f('warn'), f('warn')])).toBe(false);
    expect(passes([f('crit')])).toBe(false);
  }

  static async formalFree(): Promise<void> {
    const broken = (s: string) => PLAN.replace('SESSION', s).replace('- Таймбокс: полдня\n', '');
    const fix = (t: string) =>
      t.replace(
        '- Ожидаемое решение: выбор библиотеки\n',
        '- Ожидаемое решение: выбор библиотеки\n- Таймбокс: полдня\n',
      );
    await withFlow({ answers: ['approve'], draft: broken, fix }, async (flow) => {
      const s = await openSession(flow.home, flow.id);
      expect(s.data.state).toBe('approved');
      expect(s.data.counters['fix'] ?? 0).toBe(0);
      expect(flow.headless.some((r) => r.resume !== undefined)).toBe(true);
    });
  }

  static async fixLimit(): Promise<void> {
    await withFlow(
      { answers: [], review: (s) => (s === '1b' ? CRIT_1B : { findings: [] }) },
      async (flow) => {
        expect(await state(flow)).toBe('failed');
        expect(flow.headless.filter((r) => r.schema === undefined)).toHaveLength(3);
        expect((await openSession(flow.home, flow.id)).data.round).toBe(4);
        expect(await readFile(path.join(flow.dir, 'failure-report.md'), 'utf8')).toContain(
          'dod-checkable',
        );
      },
    );
  }

  static async reviewersBlind(): Promise<void> {
    await withFlow({ answers: ['approve'] }, async (flow) => {
      const reviews = flow.headless.filter((r) => r.schema !== undefined);
      expect(reviews.length).toBeGreaterThan(0);
      for (const r of reviews) {
        expect([r.cwd, ...r.addDirs]).not.toContain(flow.dir);
        expect(r.systemPrompt).not.toContain('context.md');
        for (const dir of [r.cwd, ...r.addDirs].filter((d) => d.startsWith(flow.dir)))
          expect(await readdir(dir)).not.toContain('context.md');
      }
    });
  }

  static offlineStage(): void {
    expect(REVIEW_TOOLS['1b']).not.toContain('WebSearch');
    expect(REVIEW_TOOLS['1b']).not.toContain('WebFetch');
    const args = headlessArgs({
      cwd: '.',
      model: 'haiku',
      addDirs: [],
      systemPrompt: '',
      tools: REVIEW_TOOLS['1b'],
      allowedTools: REVIEW_TOOLS['1b'],
      prompt: 'p',
      persist: false,
      maxTurns: 1,
    });
    expect(args[args.indexOf('--tools') + 1]).toBe('Read');
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('WebSearch,WebFetch');
  }

  static async askKeepsPlan(): Promise<void> {
    await withFlow({ answers: ['ask', 'зачем S1?', 'approve'] }, async (flow) => {
      const plan = await readFile(path.join(flow.dir, 'plan.md'), 'utf8');
      expect(flow.askedPlan).toBeDefined();
      expect(plan.replace('status: approved', 'status: awaiting-user')).toBe(flow.askedPlan);
      expect(await readFile(path.join(flow.dir, 'context.md'), 'utf8')).toContain('зачем S1?');
    });
  }

  static async reviseScope(): Promise<void> {
    const fix = (t: string, n: number) =>
      n === 1
        ? t.replace('точка входа.', 'точка входа CLI.')
        : t.replace('модель плана.', 'модель плана, обратимая.');
    await withFlow({ answers: ['walk', 'уточни', '', '', 'approve'], fix }, async (flow) => {
      const plan = await readFile(path.join(flow.dir, 'plan.md'), 'utf8');
      expect(await state(flow)).toBe('approved');
      expect(plan).not.toContain('точка входа CLI.');
      expect(plan).toContain('модель плана, обратимая.');
    });
  }

  static async approvedFrozen(): Promise<void> {
    await withFlow({ answers: ['approve'] }, async (flow) => {
      const before = await readFile(path.join(flow.dir, 'plan.md'), 'utf8');
      expect(await flow.run('plan-review', 'open', flow.id)).toBe(0);
      expect(await readFile(path.join(flow.dir, 'plan.md'), 'utf8')).toBe(before);
      expect(flow.headless.filter((r) => r.schema === undefined)).toHaveLength(0);
    });
  }

  static spikeHorizon = (): Promise<void> => judged(['@spike-horizon']);

  static explicitFlags(): void {
    const args = headlessArgs({
      cwd: '.',
      model: 'opus',
      addDirs: ['/s'],
      systemPrompt: 'роль',
      tools: ['Read'],
      allowedTools: ['Read'],
      prompt: 'p',
      persist: false,
      maxTurns: 3,
    });
    const flag = (name: string) => args[args.indexOf(name) + 1];
    expect(flag('--setting-sources')).toBe('');
    expect(flag('--permission-mode')).toBe('dontAsk');
    expect(flag('--model')).toBe('opus');
    expect(flag('--tools')).toBe('Read');
    expect(flag('--output-format')).toBe('json');
    expect(args).toContain('--no-session-persistence');
  }
}

const ARTIFACTS = '.claude/artifacts/plan-review';

const artifactsOf = async (project: string): Promise<string[]> =>
  existsSync(path.join(project, ARTIFACTS))
    ? (await readdir(path.join(project, ARTIFACTS))).sort()
    : [];

class Start {
  static async file(): Promise<void> {
    await withFlow({ answers: ['approve'] }, async (flow) => {
      expect(await artifactsOf(flow.project)).toEqual(['демо.expect.ts']);
      expect(
        await readFile(path.join(flow.project, ARTIFACTS, 'демо.expect.ts'), 'utf8'),
      ).toContain("plan({ name: 'демо' })");
      expect((await openSession(flow.home, flow.id)).data.planFile).toBe(
        `${ARTIFACTS}/демо.expect.ts`,
      );
    });
    const existing =
      "import { plan } from '@shahimat/harness/expect';\nplan({ name: 'Текущее состояние' });\n";
    await withFlow(
      { answers: ['approve'], plan: 'expectations/own.expect.ts' },
      async (flow) => {
        expect(await readFile(path.join(flow.project, 'expectations/own.expect.ts'), 'utf8')).toBe(
          existing,
        );
      },
      { 'expectations/own.expect.ts': existing },
    );
  }

  static async name(): Promise<void> {
    await withFlow(
      { answers: ['approve'], plan: 'expectations/own.expect.ts' },
      async (flow) => {
        expect((await openSession(flow.home, flow.id)).data.title).toBe('Текущее состояние');
      },
      { 'expectations/own.expect.ts': "plan({ name: 'Текущее состояние' });\n" },
    );
    await withFlow({ answers: ['approve'], plan: 'plans/новый-план.expect.ts' }, async (flow) => {
      expect((await openSession(flow.home, flow.id)).data.title).toBe('новый-план');
    });
  }

  static async request(): Promise<void> {
    await withFlow({ answers: ['approve'], request: '' }, async (flow) => {
      expect((await openSession(flow.home, flow.id)).data.request).toBe('');
      expect(flow.interactive.map((r) => r.prompt)).toEqual(['']);
      expect(flow.interactive[0]?.systemPrompt).toContain('дождись запроса');
    });
    await withFlow({ answers: ['approve'], request: 'одной строкой' }, async (flow) => {
      expect(flow.interactive.map((r) => r.prompt)).toEqual(['одной строкой']);
    });
  }

  static async htmlHeader(): Promise<void> {
    const base = path.join(repoRoot(), 'packages/harness/test/.tmp');
    await mkdir(base, { recursive: true });
    const dir = await mkdtemp(path.join(base, 'plan-header-'));
    try {
      const file = `${ARTIFACTS}/demo-plan.expect.ts`;
      await mkdir(path.join(dir, ARTIFACTS), { recursive: true });
      await writeFile(
        path.join(dir, 'package.json'),
        '{"name":"fixture","private":true,"type":"module"}',
      );
      await writeFile(
        path.join(dir, file),
        "import { describe } from 'vitest';\nimport { budget, crit, fsm, plan } from '@shahimat/harness/expect';\nbudget({ crit: 0, warn: 0 });\nplan({ name: 'Демо-план' });\nfsm('demo-flow', { initial: 'a', states: { a: { actor: 'model', on: { go: 'b' } }, b: { final: true } } });\ndescribe('раздел', () => { crit('ожидание плана', () => {}); });\n",
      );
      const out = path.join(dir, 'page.html');
      spawnSync(
        process.execPath,
        [
          path.join(repoRoot(), 'packages/harness/dist/bin.js'),
          'expect',
          'report',
          file,
          '--root',
          dir,
          '--html',
          out,
        ],
        { cwd: dir, encoding: 'utf8' },
      );
      const html = existsSync(out) ? await readFile(out, 'utf8') : '';
      expect(html).toMatch(/<h1>Демо-план<\/h1>\s*<p class="blocks">блоки: fsm demo-flow<\/p>/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
