import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import {
  BUILTIN_HARNESSES,
  findCommand,
  FSM_SCHEMA,
  harnessHome,
  headlessArgs,
  loadHarness,
  openSession,
  parseMachine,
  planIo,
  planReviewRegistry,
  staticErrors,
  type ModelRunner,
  type Prompter,
} from '@shahimat/harness';
import {
  budget,
  crit,
  fsm,
  Graph,
  info,
  judged,
  readRepo,
  repoRoot,
  warn,
} from '@shahimat/harness/expect';
import { parseJson } from './shared/guards.ts';

budget({ crit: 0, warn: 0 });

info.title('Harness Plan-Review');
info.text(
  'Интерактивный планер: из запроса пользователя он строит ожидания в файле и проверяет их ревью. Мотивация — предсказуемость.',
);

info.remarks();

info.questions([
  {
    text: 'Рисовать ли Ctrl+C на схеме автомата?',
    answers: [
      {
        text: 'нет: оставить заглушкой на автомат целиком',
        recommended: true,
        comment:
          'Стрелка Ctrl+C из каждого состояния делает схему нечитаемой, а смысл один для всех узлов.',
      },
      { text: 'да: событие interrupt из каждого состояния в finished' },
    ],
  },
  {
    text: 'Разбор ответа ревьюера — отдельное состояние планера или часть ревью?',
    answers: [
      {
        text: 'отдельное состояние analyze',
        recommended: true,
        comment: 'Так видно, кто решает, что замечание крупное: ревьюер находит, планер решает.',
      },
      { text: 'часть состояния review' },
    ],
  },
  {
    text: 'Оставить ли на странице служебные разделы — нарушения плана и удалённые относительно HEAD ожидания?',
    answers: [
      {
        text: 'оставить: они появляются, только когда есть что показать',
        recommended: true,
        comment:
          'Нарушения плана теперь идут в блок «Замечания»; список удалённых нужен, чтобы видеть, что ушло из файла.',
      },
      { text: 'убрать' },
    ],
  },
]);

info.stats('crit');
info.stats('warn');

info.subtitle('FSM');

const planReview = fsm('plan-review', {
  initial: 'awaiting_input',
  start: 'запуск: start <file>',
  limits: { cycles: 3 },
  states: {
    awaiting_input: {
      actor: 'user',
      description: 'Планер ждёт ввода пользователя',
      on: {
        request: { to: 'gathering', label: 'запрос' },
        exit: { to: 'finished', label: 'выход' },
      },
    },
    gathering: {
      actor: 'model',
      description: 'Сбор контекста, в том числе параллельными подзадачами',
      on: { gathered: { to: 'composing', label: 'контекст собран' } },
    },
    composing: {
      actor: 'model',
      description: 'Планер записывает ожидания в файл из блоков механизма',
      on: {
        written: { to: 'review', label: 'ожидания записаны' },
        unclear: { to: 'clarify_form', label: 'форма неясна' },
      },
    },
    clarify_form: {
      actor: 'user',
      description: 'Пользователь выбирает, каким блоком строить ожидания',
      on: { answered: { to: 'composing', label: 'ответ получен' } },
    },
    review: {
      actor: 'model',
      description: 'Ревью ожиданий — работа судьи',
      on: { reviewed: { to: 'analyze', label: 'ревью пройдено' } },
    },
    analyze: {
      actor: 'model',
      description: 'Планер разбирает ответ ревьюера',
      on: {
        remarks: [
          { to: 'composing', count: 'cycles', label: 'замечания' },
          { to: 'awaiting_input', label: 'лимит исчерпан' },
        ],
        clean: { to: 'awaiting_input', label: 'ревью чистое' },
      },
    },
    finished: { final: true, description: 'Сессия завершена' },
  },
});

planReview.whole(() => {
  crit.todo(
    'Ctrl+C в любом состоянии завершает сессию; файл ожиданий остаётся в последнем записанном виде',
  );
  crit.todo(
    'цикл composing → review → analyze ограничен счётчиком cycles: по умолчанию 3 полных цикла',
  );
  crit.wip(
    'автомат plan-review в harness.yaml совпадает с этой схемой: состояния, акторы, события и лимиты',
    () => Check.sameAsFsm(),
  );
});

planReview.entry(() => {
  crit.todo(
    'вход — harness plan-review start <file>: сессия открывается на конкретном файле ожиданий',
  );
});

planReview.state('awaiting_input', () => {
  crit.todo('в ожидании ввода планер ничего не меняет в файле ожиданий и проекте');
  crit.todo(
    'при запуске планер получает перечень блоков, из которых строит ожидания: fsm, steps, паттерны',
  );
});

planReview.transition('awaiting_input', 'request', () => {
  crit.todo('запрос любого вида — текст, файлы, картинки — пишется в интерактивной сессии планера');
});

planReview.transition('awaiting_input', 'exit', () => {
  crit.todo(
    'выход — только по явному слову пользователя или Ctrl+C; зелёный прогон выходом не считается',
  );
  crit.todo(
    'на просьбу о выходе планер завершает сессию в точке, где файл ожиданий записан целиком',
  );
});

planReview.state('gathering', () => {
  crit.todo('сбор контекста может идти параллельными подзадачами внутри сессии планера');
  crit.todo('на сборе контекста файл ожиданий не меняется');
});

planReview.transition('gathering', 'gathered', () => {
  crit.todo(
    'планер переходит к записи ожиданий, когда список его открытых вопросов к пользователю пуст',
  );
});

planReview.state('composing', () => {
  crit.todo('планер записывает в файл ожидания по собранному контексту только из блоков перечня');
  crit.todo('ожидание без готовой проверки записывается заглушкой crit.todo или crit.wip');
});

planReview.transition('composing', 'written', () => {
  crit.todo(
    'ревью запускается на файле, который собирается без ошибок: typecheck и сбор ожиданий чистые',
  );
});

planReview.transition('composing', 'unclear', () => {
  crit.todo(
    'если блок для ожиданий выбрать нельзя, планер спрашивает пользователя, каким его строить',
  );
});

planReview.state('clarify_form', () => {
  crit.todo('ответ пользователя о форме ожиданий передаётся планеру дословно');
});

planReview.transition('clarify_form', 'answered', () => {
  crit.todo('после ответа планер записывает ожидания выбранным блоком');
});

planReview.state('review', () => {
  crit.todo(
    'ревью проверяет ожидания как судья: противоречия и неизмеримые заголовки, crit, warn и info по бюджету файла',
  );
  crit.todo('ревьюер не правит файл ожиданий; результат ревью возвращается планеру');
});

planReview.transition('review', 'reviewed', () => {
  crit.todo('результат ревью — замечания с уровнем crit, warn или info и пояснением к каждому');
});

planReview.state('analyze', () => {
  crit.todo(
    'если у файла есть замечания, а info.remarks нет, планер пишет об этом пользователю в сессии и просит добавить блок',
  );
});

planReview.transition(
  'analyze',
  'remarks',
  () => {
    crit.todo('crit или warn сверх бюджета возвращают планера к правке ожиданий');
  },
  'composing',
);

planReview.transition(
  'analyze',
  'remarks',
  () => {
    crit.todo(
      'после 3 циклов без чистого ревью планер возвращается к пользователю и объясняет, где зациклился и что не может разрешить',
    );
  },
  'awaiting_input',
);

planReview.transition('analyze', 'clean', () => {
  crit.todo(
    'при чистом ревью планер возвращается к пользователю с пояснениями и ждёт следующего запроса',
  );
});

info.subtitle('общие ожидания');

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
  crit(
    'без info.title шапки на странице нет; у плана без info.title отчёт в терминале просит добавить info.title()',
    () => Start.htmlHeader(),
  );
});

describe('[harness] plan-review', () => {
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
  const runner: ModelRunner = {
    interactive: async (run) => {
      flow.interactive.push(run);
      const session = path.basename(run.addDirs[0] ?? '');
      await writeFile(path.join(run.addDirs[0] ?? '', 'plan.md'), PLAN.replace('SESSION', session));
      return 0;
    },
    headless: async (run) => {
      flow.headless.push(run);
      return {
        text: '',
        structured: run.schema === undefined ? undefined : { findings: [] },
        sessionId: run.sessionId,
        costUsd: 0,
      };
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

async function builtinDef() {
  const result = await loadHarness(path.join(tmpdir(), 'plan-review-no-home'), 'plan-review');
  if (result.harness === undefined) throw new Error(result.errors.join('\n'));
  return result.harness;
}

class Check {
  static async sameAsFsm(): Promise<void> {
    const { def } = await builtinDef();
    Graph.sameAs(planReview, def);
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
      const run = spawnSync(
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
      expect(html).toContain('ожидание плана');
      expect(html).not.toContain('<h1>');
      expect(run.stdout).toMatch(/у плана «Демо-план» нет шапки: добавьте info\.title\(\)/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
