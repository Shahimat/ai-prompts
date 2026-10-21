import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import {
  BUILTIN_HARNESSES,
  findCommand,
  FSM_SCHEMA,
  harnessHome,
  headlessArgs,
  hookEvent,
  JUDGE_TOOLS,
  loadHarness,
  openSession,
  parseMachine,
  planIo,
  planReviewRegistry,
  reviewText,
  staticErrors,
  type HookName,
  type ModelRunner,
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
info.text(
  'Переходы выводит команда hook из событий сессии планера: UserPromptSubmit, PreToolUse, PostToolUse, Stop и SessionEnd. Модель событий не объявляет.',
);

info.remarks();

info.stats('crit');
info.stats('warn');

info.subtitle('FSM');

const planReview = fsm('plan-review', {
  initial: 'awaiting_input',
  start: 'запуск: start <file>',
  limits: { cycles: 3, build: 3 },
  states: {
    awaiting_input: {
      actor: 'user',
      description: 'Планер ждёт ввода пользователя',
      on: {
        request: { to: 'gathering', reset: ['cycles'], label: 'запрос' },
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
      description: 'Код сравнивает находки с бюджетом файла, планер разбирает ответ',
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
  crit(
    'Ctrl+C или /exit в любом состоянии ставят сессию на паузу: автомат остаётся на месте, файл ожиданий — в последнем записанном виде; open <id> продолжает с той же точки',
    () => Machine.pause(),
  );
  crit(
    'цикл composing → review → analyze ограничен счётчиком cycles: по умолчанию 3 полных цикла',
    () => Machine.cycles(),
  );
  crit(
    'автомат plan-review в harness.yaml совпадает с этой схемой: состояния, акторы, события и лимиты',
    () => Machine.sameAsFsm(),
  );
  crit('переходы выводит команда hook из событий сессии планера; модель событий не объявляет', () =>
    Machine.hooksDrive(),
  );
});

planReview.entry(() => {
  crit(
    'вход — harness plan-review start <file>: сессия открывается на конкретном файле ожиданий',
    () => Machine.entry(),
  );
});

planReview.state('awaiting_input', () => {
  crit('в ожидании ввода планер ничего не меняет в файле ожиданий и проекте', () =>
    Machine.awaitingReadOnly(),
  );
  crit(
    'при запуске планер получает перечень блоков, из которых строит ожидания: fsm, steps, паттерны',
    () => Machine.blocksListed(),
  );
});

planReview.transition('awaiting_input', 'request', () => {
  crit('запрос любого вида — текст, файлы, картинки — пишется в интерактивной сессии планера', () =>
    Machine.requestInteractive(),
  );
  crit('событие request — hook UserPromptSubmit в состоянии awaiting_input', () =>
    Machine.hook('awaiting_input', 'prompt', 'request'),
  );
});

planReview.transition('awaiting_input', 'exit', () => {
  crit(
    'выход — только по явной просьбе пользователя: его слово «выход» или флаг exit в ответе планера; Ctrl+C и зелёный прогон выходом не считаются',
    () => Machine.exitOnlyByUser(),
  );
  crit(
    'на просьбу о выходе планер завершает сессию в точке, где файл ожиданий записан целиком',
    () => Machine.exitWhenWritten(),
  );
  warn('на просьбу о выходе планер ставит последней строкой ответа флаг [plan-review: exit]', () =>
    Machine.plannerRole(),
  );
  crit(
    'событие exit — слово «выход» (UserPromptSubmit) в awaiting_input или флаг exit, прочитанный на Stop после стадии; SessionEnd событий не даёт',
    () => Machine.exitHook(),
  );
});

planReview.state('gathering', () => {
  crit('сбор контекста может идти параллельными подзадачами внутри сессии планера', () =>
    Machine.subagents(),
  );
  crit('на сборе контекста файл ожиданий не меняется', () => Machine.gatheringReadOnly());
});

planReview.transition('gathering', 'gathered', () => {
  warn(
    'планер переходит к записи ожиданий, когда список его открытых вопросов к пользователю пуст',
    () => Machine.plannerRole(),
  );
  crit('событие gathered — первая правка файла ожиданий (PreToolUse Edit/Write) в gathering', () =>
    Machine.hook('gathering', 'edit', 'gathered'),
  );
});

planReview.state('composing', () => {
  warn('планер записывает в файл ожидания по собранному контексту только из блоков перечня', () =>
    Machine.plannerRole(),
  );
  warn('ожидание без готовой проверки записывается заглушкой crit.todo или crit.wip', () =>
    Machine.plannerRole(),
  );
  crit('планер правит только файл ожиданий: правка другого файла блокируется hook', () =>
    Machine.onlyPlanFile(),
  );
});

planReview.transition('composing', 'written', () => {
  crit(
    'ревью запускается на файле, который собирается без ошибок: typecheck и сбор ожиданий чистые',
    () => Machine.reviewOnBuild(),
  );
  crit(
    'файл не собирается — Stop показывает планеру ошибки не больше limits.build раз подряд, затем отпускает',
    () => Machine.buildLimit(),
  );
});

planReview.transition('composing', 'unclear', () => {
  warn(
    'если блок для ожиданий выбрать нельзя, планер спрашивает пользователя, каким его строить',
    () => Machine.plannerRole(),
  );
  crit('событие unclear — вопрос AskUserQuestion (PreToolUse) в состоянии composing', () =>
    Machine.hook('composing', 'ask', 'unclear'),
  );
});

planReview.state('clarify_form', () => {
  crit('ответ пользователя о форме ожиданий передаётся планеру дословно', () =>
    Machine.answerVerbatim(),
  );
});

planReview.transition('clarify_form', 'answered', () => {
  warn('после ответа планер записывает ожидания выбранным блоком', () => Machine.plannerRole());
  crit('событие answered — ответ на AskUserQuestion (PostToolUse) в состоянии clarify_form', () =>
    Machine.hook('clarify_form', 'answer', 'answered'),
  );
});

planReview.state('review', () => {
  crit(
    'ревью проверяет ожидания как судья: противоречия и неизмеримые заголовки, crit, warn и info по бюджету файла',
    () => Machine.judgeAsJudge(),
  );
  crit('ревьюер не правит файл ожиданий; результат ревью возвращается планеру', () =>
    Machine.judgeReadOnly(),
  );
  crit('судья — headless без сети и без права записи; правит файл только планер', () =>
    Machine.judgeTools(),
  );
});

planReview.transition('review', 'reviewed', () => {
  crit('результат ревью — замечания с уровнем crit, warn или info и пояснением к каждому', () =>
    Machine.reviewLines(),
  );
});

planReview.state('analyze', () => {
  crit(
    'если у файла есть замечания, а info.remarks нет, планер пишет об этом пользователю в сессии и просит добавить блок',
    () => Machine.remarksHint(),
  );
});

planReview.transition(
  'analyze',
  'remarks',
  () => {
    crit('crit или warn сверх бюджета возвращают планера к правке ожиданий', () =>
      Machine.remarksBack(),
    );
  },
  'composing',
);

planReview.transition(
  'analyze',
  'remarks',
  () => {
    crit(
      'после 3 циклов без чистого ревью планер возвращается к пользователю и объясняет, где зациклился и что не может разрешить',
      () => Machine.cyclesExhausted(),
    );
  },
  'awaiting_input',
);

planReview.transition('analyze', 'clean', () => {
  crit(
    'при чистом ревью планер возвращается к пользователю с пояснениями и ждёт следующего запроса',
    () => Machine.cleanBack(),
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
  crit(
    'команды планера: harness plan-review start | open | list | status | validate | graph | hook',
    () => Check.commands(),
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
  crit('headless-прогоны задают флаги явно и не исполняют hooks проекта', () =>
    Check.explicitFlags(),
  );
});

const NOW = new Date('2026-10-14T12:00:00Z');
const ARTIFACTS = '.claude/artifacts/plan-review';
const TMP = (): string => path.join(repoRoot(), 'packages/harness/test/.tmp');

const GOOD = `import { describe } from 'vitest';
import { budget, crit, info, plan } from '@shahimat/harness/expect';
budget({ crit: 0, warn: 0 });
plan({ name: 'демо' });
info.remarks();
describe('раздел', () => {
  crit('ожидание выполнено', () => {});
});
`;

const RED = GOOD.replace(
  "crit('ожидание выполнено', () => {});",
  "crit('ожидание не выполнено', () => { throw new Error('нет'); });",
);

const BROKEN = `${GOOD}\nconst = ;\n`;

const EXIT_FLAG = { last_assistant_message: 'Файл записан.\n[plan-review: exit]' };

const NO_REMARKS = `import { budget, plan, step, steps } from '@shahimat/harness/expect';
budget({ crit: 0, warn: 0 });
plan({ name: 'демо' });
steps(() => { step('T1', { title: 'шаг', after: ['T9'] }, () => {}); });
`;

interface Step {
  hook?: HookName;
  input?: Record<string, unknown>;
  write?: string;
}

interface Options {
  steps?: Step[];
  plan?: string;
  request?: string;
  files?: Record<string, string>;
  cycles?: number;
  judgeWrites?: boolean;
  reopen?: boolean;
}

interface HookCall {
  hook: HookName;
  code: number;
  message: string;
}

interface FlowResult {
  id: string;
  home: string;
  project: string;
  state: string;
  planFile: string;
  title: string;
  request: string;
  transitions: string[];
  hooks: HookCall[];
  interactive: Parameters<ModelRunner['interactive']>[0][];
  headless: Parameters<ModelRunner['headless']>[0][];
  plan: string;
  artifacts: string[];
  files: Record<string, string>;
}

const planAbs = (project: string, file: string): string => path.join(project, file);

async function runFlow(options: Options): Promise<FlowResult> {
  await mkdir(TMP(), { recursive: true });
  const home = await mkdtemp(path.join(TMP(), 'plan-review-home-'));
  const project = await mkdtemp(path.join(TMP(), 'plan-review-proj-'));
  const planFile = options.plan ?? `${ARTIFACTS}/демо.expect.ts`;
  spawnSync('git', ['init', '-q'], { cwd: project });
  await mkdir(path.join(project, '.claude'), { recursive: true });
  await writeFile(
    path.join(project, 'package.json'),
    '{"name":"fixture","private":true,"type":"module"}',
  );
  for (const [rel, text] of Object.entries(options.files ?? {})) {
    await mkdir(path.dirname(path.join(project, rel)), { recursive: true });
    await writeFile(path.join(project, rel), text);
  }
  if (options.cycles !== undefined) {
    const own = path.join(home, 'harnesses/plan-review');
    await mkdir(own, { recursive: true });
    const builtin = await readFile(
      path.join(BUILTIN_HARNESSES, 'plan-review/harness.yaml'),
      'utf8',
    );
    await writeFile(
      path.join(own, 'harness.yaml'),
      builtin.replace('cycles: 3', `cycles: ${options.cycles}`),
    );
  }
  const interactive: FlowResult['interactive'] = [];
  const headless: FlowResult['headless'] = [];
  const hooks: HookCall[] = [];
  const queue = [...(options.steps ?? [])];
  let id = '';
  const run = (words: string[]) => {
    const match = findCommand(words);
    if (match === undefined) throw new Error(`нет команды ${words.join(' ')}`);
    return match.command.run({
      root: project,
      now: NOW,
      home,
      params: match.params,
      request: options.request ?? 'спланируй',
    });
  };
  const errors: string[] = [];
  const runner: ModelRunner = {
    interactive: async (r) => {
      interactive.push(r);
      [id = ''] = await readdir(path.join(home, 'sessions'));
      for (const step of queue.splice(0)) {
        if (step.write !== undefined) await writeFile(planAbs(project, planFile), step.write);
        if (step.hook === undefined) continue;
        planIo.stdin = async () => JSON.stringify({ cwd: project, ...step.input });
        const before = errors.length;
        const code = await run(['plan-review', 'hook', id, step.hook]);
        hooks.push({ hook: step.hook, code, message: errors.slice(before).join('\n') });
      }
      return 0;
    },
    headless: async (r) => {
      headless.push(r);
      if (options.judgeWrites === true) await writeFile(planAbs(project, planFile), 'испорчено');
      const structured =
        r.schema !== undefined && JSON.stringify(r.schema).includes('contradictions')
          ? { contradictions: [], unmeasurable: [] }
          : { answers: [] };
      return { text: '', structured, sessionId: undefined, costUsd: 0 };
    },
  };
  const saved = { runner: planIo.runner, stdin: planIo.stdin, terminal: planIo.terminal };
  const log = console.log;
  const error = console.error;
  planIo.runner = () => runner;
  planIo.terminal = () => true;
  console.log = () => undefined;
  console.error = (...a: unknown[]) => {
    errors.push(a.join(' '));
  };
  try {
    await run(['plan-review', 'start', planFile]);
    [id = ''] = await readdir(path.join(home, 'sessions'));
    if (options.reopen === true) await run(['plan-review', 'open', id]);
    const s = await openSession(home, id);
    const journal = await readFile(path.join(home, 'sessions', id, 'log.jsonl'), 'utf8');
    const transitions = journal
      .trim()
      .split('\n')
      .flatMap((line) => {
        const e = parseJson(line);
        if (
          typeof e !== 'object' ||
          e === null ||
          !('from' in e) ||
          !('to' in e) ||
          !('event' in e)
        )
          return [];
        return [`${String(e.from)} -${String(e.event)}-> ${String(e.to)}`];
      });
    const files: Record<string, string> = {};
    for (const rel of Object.keys(options.files ?? {}))
      files[rel] = await readFile(path.join(project, rel), 'utf8');
    return {
      id,
      home,
      project,
      state: s.data.state,
      planFile: s.data.planFile ?? '',
      title: s.data.title,
      request: s.data.request,
      transitions,
      hooks,
      interactive,
      headless,
      plan: existsSync(planAbs(project, planFile))
        ? await readFile(planAbs(project, planFile), 'utf8')
        : '',
      artifacts: existsSync(path.join(project, ARTIFACTS))
        ? (await readdir(path.join(project, ARTIFACTS))).sort()
        : [],
      files,
    };
  } finally {
    console.log = log;
    console.error = error;
    planIo.runner = saved.runner;
    planIo.stdin = saved.stdin;
    planIo.terminal = saved.terminal;
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
}

const once = <T>(make: () => Promise<T>): (() => Promise<T>) => {
  let value: Promise<T> | undefined;
  return () => (value ??= make());
};

const edit = (file = `${ARTIFACTS}/демо.expect.ts`): Step => ({
  hook: 'edit',
  input: { tool_name: 'Write', tool_input: { file_path: file } },
});

const Flows = {
  idle: once(() => runFlow({})),
  clean: once(() =>
    runFlow({
      steps: [
        { hook: 'prompt' },
        edit(),
        { write: GOOD, hook: 'stop' },
        { hook: 'stop' },
        { hook: 'prompt', input: { prompt: 'выход' } },
      ],
    }),
  ),
  red: once(() =>
    runFlow({
      cycles: 1,
      steps: [
        { hook: 'prompt' },
        edit(),
        { write: RED, hook: 'stop' },
        { write: `${RED}// 2\n`, hook: 'stop' },
      ],
    }),
  ),
  broken: once(() =>
    runFlow({
      steps: [
        { hook: 'prompt' },
        edit(),
        { write: BROKEN, hook: 'stop' },
        { hook: 'stop' },
        { hook: 'stop' },
        { hook: 'stop' },
      ],
    }),
  ),
  noRemarks: once(() =>
    runFlow({ steps: [{ hook: 'prompt' }, edit(), { write: NO_REMARKS, hook: 'stop' }] }),
  ),
  exitFlag: once(() =>
    runFlow({
      steps: [{ hook: 'prompt' }, edit(), { write: GOOD, hook: 'stop', input: EXIT_FLAG }],
    }),
  ),
  exitFlagRed: once(() =>
    runFlow({
      steps: [{ hook: 'prompt' }, edit(), { write: RED, hook: 'stop', input: EXIT_FLAG }],
    }),
  ),
  paused: once(() =>
    runFlow({
      reopen: true,
      steps: [
        { hook: 'prompt' },
        edit(),
        { write: GOOD },
        { hook: 'end', input: { reason: 'other' } },
      ],
    }),
  ),
  judgeWrites: once(() =>
    runFlow({
      judgeWrites: true,
      steps: [{ hook: 'prompt' }, edit(), { write: GOOD, hook: 'stop' }],
    }),
  ),
};

const stops = (f: FlowResult): HookCall[] => f.hooks.filter((h) => h.hook === 'stop');

async function builtinDef() {
  const result = await loadHarness(path.join(homedir(), '.no-such-harness-home'), 'plan-review');
  if (result.harness === undefined) throw new Error(result.errors.join('\n'));
  return result.harness;
}

class Machine {
  static async cycles(): Promise<void> {
    const { def } = await builtinDef();
    expect(def.limits['cycles']).toBe(3);
    const analyze = def.states.find((s) => s.name === 'analyze');
    expect(analyze?.on['remarks']?.[0]?.count).toBe('cycles');
  }

  static async sameAsFsm(): Promise<void> {
    const { def } = await builtinDef();
    Graph.sameAs(planReview, def);
  }

  static async hooksDrive(): Promise<void> {
    const run = (await Flows.idle()).interactive[0];
    if (run === undefined) throw new Error('планер не запускался');
    const settings = JSON.stringify(run.settings);
    for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'])
      expect(settings).toContain(event);
    expect(settings.match(/plan-review hook /g)?.length).toBe(6);
    expect(run.allowedTools.filter((t) => t.includes('plan-review hook'))).toEqual([]);
    const hookNode = findCommand(['plan-review', 'hook', 'x', 'stop']);
    expect(hookNode?.command.path).toEqual(['plan-review', 'hook', '<id>', '<hook>']);
  }

  static async entry(): Promise<void> {
    const f = await Flows.idle();
    expect(f.planFile).toBe(`${ARTIFACTS}/демо.expect.ts`);
    expect(f.state).toBe('awaiting_input');
    expect(f.interactive[0]?.systemPrompt).toContain(f.planFile);
  }

  static awaitingReadOnly(): void {
    const plan = '/p/plan.expect.ts';
    expect(
      hookEvent('awaiting_input', 'edit', { tool_name: 'Edit', file_path: plan }, plan).block,
    ).toContain('не меняется');
    expect(
      hookEvent('awaiting_input', 'edit', { tool_name: 'Write', file_path: '/p/src/a.ts' }, plan)
        .block,
    ).toContain('только файл ожиданий');
  }

  static async blocksListed(): Promise<void> {
    const prompt = (await Flows.idle()).interactive[0]?.systemPrompt ?? '';
    for (const block of ['fsm(', 'steps(', 'Паттерны']) expect(prompt).toContain(block);
  }

  static async requestInteractive(): Promise<void> {
    const f = await Flows.clean();
    expect(f.interactive).toHaveLength(1);
    expect(f.interactive[0]?.tools).toContain('Read');
    expect(f.transitions[0]).toBe('awaiting_input -request-> gathering');
  }

  static hook(state: string, hook: HookName, event: string): void {
    const plan = '/p/plan.expect.ts';
    const input = { tool_name: 'Write', file_path: plan };
    expect(hookEvent(state, hook, input, plan)).toEqual({ event });
    for (const other of [
      'awaiting_input',
      'gathering',
      'composing',
      'clarify_form',
      'review',
      'analyze',
    ])
      if (other !== state) expect(hookEvent(other, hook, input, plan).event).not.toBe(event);
  }

  static async exitOnlyByUser(): Promise<void> {
    const f = await Flows.clean();
    expect(f.transitions).toContain('analyze -clean-> awaiting_input');
    expect(f.transitions.at(-1)).toBe('awaiting_input -exit-> finished');
    expect((await Flows.exitFlag()).state).toBe('finished');
    expect((await Flows.paused()).state).toBe('composing');
    const { def } = await builtinDef();
    const intoFinal = def.states.flatMap((s) =>
      Object.entries(s.on).flatMap(([event, list]) =>
        list.filter((t) => t.to === 'finished').map(() => `${s.name}:${event}`),
      ),
    );
    expect(intoFinal).toEqual(['awaiting_input:exit']);
  }

  static plannerRole = (): Promise<void> => judged(['@planner-role']);

  static exitHook(): void {
    const plan = '/p/plan.expect.ts';
    for (const prompt of ['выход', ' Выход '])
      expect(hookEvent('awaiting_input', 'prompt', { prompt }, plan)).toEqual({ event: 'exit' });
    expect(hookEvent('awaiting_input', 'prompt', { prompt: 'выход из цикла' }, plan)).toEqual({
      event: 'request',
    });
    for (const state of ['awaiting_input', 'gathering', 'composing', 'clarify_form'])
      for (const reason of ['prompt_input_exit', 'other', 'clear'])
        expect(hookEvent(state, 'end', { reason }, plan)).toEqual({});
  }

  static async exitWhenWritten(): Promise<void> {
    const done = await Flows.exitFlag();
    expect(done.transitions.slice(-2)).toEqual([
      'analyze -clean-> awaiting_input',
      'awaiting_input -exit-> finished',
    ]);
    expect(done.plan).toBe(GOOD);
    const red = await Flows.exitFlagRed();
    expect(red.state).toBe('composing');
    expect(stops(red).at(-1)?.message).toContain('Выход отложен');
  }

  static async pause(): Promise<void> {
    const f = await Flows.paused();
    expect(f.state).toBe('composing');
    expect(f.plan).toBe(GOOD);
    expect(f.interactive.map((r) => r.resume)).toEqual([false, true]);
    expect(f.interactive[1]?.sessionId).toBe(f.interactive[0]?.sessionId);
    expect(f.hooks.find((h) => h.hook === 'end')?.code).toBe(0);
  }

  static async subagents(): Promise<void> {
    const run = (await Flows.idle()).interactive[0];
    expect(run?.tools).toContain('Agent');
    expect(run?.allowedTools).toContain('Agent');
  }

  static gatheringReadOnly(): void {
    const plan = '/p/plan.expect.ts';
    const write = { tool_name: 'Write', file_path: plan };
    expect(hookEvent('gathering', 'edit', write, plan)).toEqual({ event: 'gathered' });
    expect(hookEvent('composing', 'edit', write, plan)).toEqual({});
  }

  static async onlyPlanFile(): Promise<void> {
    const plan = '/p/plan.expect.ts';
    for (const state of ['gathering', 'composing'])
      expect(
        hookEvent(state, 'edit', { tool_name: 'Edit', file_path: '/p/README.md' }, plan).block,
      ).toContain('только файл ожиданий');
    const run = (await Flows.idle()).interactive[0];
    const writes = (run?.allowedTools ?? []).filter((t) => /^(Edit|Write)\(/.test(t));
    expect(writes).toHaveLength(2);
    for (const w of writes) expect(w).toMatch(/демо\.expect\.ts\)$/);
  }

  static async reviewOnBuild(): Promise<void> {
    const broken = await Flows.broken();
    expect(broken.headless).toEqual([]);
    expect(broken.transitions).not.toContain('composing -written-> review');
    expect(stops(broken)[0]?.message).toContain('не собирается');
    const clean = await Flows.clean();
    expect(clean.transitions).toContain('composing -written-> review');
  }

  static async buildLimit(): Promise<void> {
    const f = await Flows.broken();
    expect(stops(f).map((s) => s.code)).toEqual([2, 2, 2, 0]);
    expect(f.state).toBe('composing');
  }

  static async answerVerbatim(): Promise<void> {
    const settings = JSON.stringify((await Flows.idle()).interactive[0]?.settings ?? {});
    expect(settings).toContain('"matcher":"AskUserQuestion"');
    expect(settings).not.toContain('updatedInput');
    expect(hookEvent('clarify_form', 'answer', {}, '/p/p.expect.ts')).toEqual({
      event: 'answered',
    });
  }

  static async judgeAsJudge(): Promise<void> {
    const f = await Flows.clean();
    const schemas = f.headless.map((r) => JSON.stringify(r.schema ?? {}));
    expect(schemas.some((s) => s.includes('contradictions') && s.includes('unmeasurable'))).toBe(
      true,
    );
    expect(stops(f)[0]?.message).toMatch(/crit 0\/0 · warn 0\/0 · info \d+/);
    const red = await Flows.red();
    expect(red.transitions).toContain('analyze -remarks-> composing');
  }

  static async judgeReadOnly(): Promise<void> {
    const f = await Flows.judgeWrites();
    expect(f.plan).toBe(GOOD);
    expect(stops(f)[0]?.code).toBe(2);
    expect(stops(f)[0]?.message).toContain('Ревью 1');
  }

  static judgeTools(): void {
    expect(JUDGE_TOOLS).toEqual(['Read', 'Glob', 'Grep']);
    const args = headlessArgs({
      cwd: '.',
      model: 'opus',
      addDirs: [],
      systemPrompt: '',
      tools: JUDGE_TOOLS,
      allowedTools: JUDGE_TOOLS,
      prompt: 'p',
      persist: false,
      maxTurns: 1,
    });
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('WebSearch,WebFetch');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep');
  }

  static reviewLines(): void {
    const lines = reviewText({
      round: 1,
      pass: false,
      rejected: [],
      summary: {
        blocked: true,
        count: { crit: 1, warn: 1, info: 0, pending: 0 },
        budget: { crit: 0, warn: 0 },
        failures: [
          { level: 'crit', title: 'а', message: 'нет' },
          { level: 'warn', title: 'б', message: 'размыто' },
        ],
        remarks: [{ text: 'противоречие', detail: 'а ↔ б' }],
        remarksDeclared: true,
      },
    });
    expect(lines).toEqual([
      'crit 1/0 · warn 1/0 · info 0',
      '- crit «а» — нет',
      '- warn «б» — размыто',
      '- противоречие — а ↔ б',
    ]);
  }

  static async remarksHint(): Promise<void> {
    const f = await Flows.noRemarks();
    expect(stops(f)[0]?.message).toContain('info.remarks()');
    const clean = await Flows.clean();
    expect(stops(clean)[0]?.message).not.toContain('info.remarks()');
  }

  static async remarksBack(): Promise<void> {
    const f = await Flows.red();
    expect(f.transitions.filter((t) => t.startsWith('analyze'))[0]).toBe(
      'analyze -remarks-> composing',
    );
    expect(stops(f)[0]?.code).toBe(2);
    expect(stops(f)[0]?.message).toContain('ожидание не выполнено');
  }

  static async cyclesExhausted(): Promise<void> {
    const f = await Flows.red();
    expect(f.transitions.filter((t) => t.startsWith('analyze'))).toEqual([
      'analyze -remarks-> composing',
      'analyze -remarks-> awaiting_input',
    ]);
    expect(f.state).toBe('awaiting_input');
    expect(stops(f)[1]?.message).toContain('где зациклился');
  }

  static async cleanBack(): Promise<void> {
    const f = await Flows.clean();
    expect(f.transitions).toContain('analyze -clean-> awaiting_input');
    expect(stops(f)[0]?.code).toBe(2);
    expect(stops(f)[0]?.message).toContain('поясни пользователю');
    expect(stops(f)[1]?.code).toBe(0);
  }
}

class Check {
  static commands(): void {
    const lines = [
      'plan-review start f.expect.ts',
      'plan-review open s',
      'plan-review list',
      'plan-review status s',
      'plan-review validate',
      'plan-review graph',
      'plan-review hook s stop',
    ];
    expect(lines.filter((l) => findCommand(l.split(' ')) === undefined)).toEqual([]);
    for (const old of ['check', 'render', 'read', 'clone'])
      expect(findCommand(['plan-review', old, 's'])).toBeUndefined();
  }

  static async home(): Promise<void> {
    expect(harnessHome()).toBe(path.join(homedir(), '.config', 'harness'));
    expect(harnessHome('/tmp/elsewhere')).toBe(path.resolve('/tmp/elsewhere'));
    const f = await Flows.idle();
    expect(f.id).toMatch(/^[0-9a-f]{64}$/);
    expect(path.relative(f.project, f.home).startsWith('..')).toBe(true);
  }

  static fsmDrives = (): Promise<void> => judged(['@fsm-drive']);

  static async staticGraph(): Promise<void> {
    const { def, registry } = await builtinDef();
    expect(staticErrors(def, registry, 'h')).toEqual([]);
    const yaml = (on: string) =>
      `harness: t-t\ninitial: a\nstates:\n  a:\n    action: plan-analyze\n    on:\n${on}\n  z:\n    final: true\n`;
    const parsed = parseMachine(yaml('      remarks: a\n      clean: a'), 'h');
    if (parsed.def === undefined) throw new Error(parsed.errors.join('\n'));
    const errors = staticErrors(parsed.def, registry, 'h').join('\n');
    expect(errors).toContain('недостижимо');
    expect(errors).toContain('цикл без лимита');
    const dead = parseMachine(
      'harness: t-t\ninitial: a\nstates:\n  a:\n    action: plan-analyze\n',
      'h',
    );
    if (dead.def === undefined) throw new Error(dead.errors.join('\n'));
    expect(staticErrors(dead.def, registry, 'h').join('\n')).toContain('тупик');
  }

  static async noExpressions(): Promise<void> {
    const text = await readFile(path.join(BUILTIN_HARNESSES, 'plan-review/harness.yaml'), 'utf8');
    expect(parseMachine(text, 'h').errors).toEqual([]);
    const expr = text.replace(
      'clean: awaiting_input',
      "clean: 'crit == 0 ? awaiting_input : composing'",
    );
    expect(parseMachine(expr, 'h').errors.join('\n')).toContain('h/states/analyze/on/clean');
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

class Start {
  static async file(): Promise<void> {
    const f = await Flows.idle();
    expect(f.artifacts).toEqual(['демо.expect.ts']);
    expect(f.plan).toContain("plan({ name: 'демо' })");
    expect(f.planFile).toBe(`${ARTIFACTS}/демо.expect.ts`);
    const existing =
      "import { plan } from '@shahimat/harness/expect';\nplan({ name: 'Текущее состояние' });\n";
    const own = await runFlow({
      plan: 'expectations/own.expect.ts',
      files: { 'expectations/own.expect.ts': existing },
    });
    expect(own.files['expectations/own.expect.ts']).toBe(existing);
  }

  static async name(): Promise<void> {
    const own = await runFlow({
      plan: 'expectations/own.expect.ts',
      files: { 'expectations/own.expect.ts': "plan({ name: 'Текущее состояние' });\n" },
    });
    expect(own.title).toBe('Текущее состояние');
    const fresh = await runFlow({ plan: 'plans/новый-план.expect.ts' });
    expect(fresh.title).toBe('новый-план');
  }

  static async request(): Promise<void> {
    const empty = await runFlow({ request: '' });
    expect(empty.request).toBe('');
    expect(empty.interactive.map((r) => r.prompt)).toEqual(['']);
    expect(empty.interactive[0]?.systemPrompt).toContain('дождись запроса');
    const line = await runFlow({ request: 'одной строкой' });
    expect(line.interactive.map((r) => r.prompt)).toEqual(['одной строкой']);
  }

  static async htmlHeader(): Promise<void> {
    await mkdir(TMP(), { recursive: true });
    const dir = await mkdtemp(path.join(TMP(), 'plan-header-'));
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
