import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import {
  BUILTIN_HARNESSES,
  FSM_SCHEMA,
  HARNESS,
  harnessHome,
  bashDecision,
  hookEvent,
  JUDGE_TOOLS,
  openerFor,
  loadHarness,
  openSession,
  parseMachine,
  planIo,
  planReviewRegistry,
  reviewText,
  staticErrors,
  type HookName,
  type ModelRunner,
  type StageSpec,
  type StageResult,
  type StageRunner,
} from '@shahimat/harness';
import { artifactRelative, expectHelperDir, isRecord, opencodeArgs } from '@shahimat/ai-core';
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
} from '@shahimat/ai-core/expect';
import { parseJson } from './shared/guards.ts';

budget({ crit: 0, warn: 5 });

info.title('Harness Plan-Review');
info.text(
  'Интерактивный планер: из запроса пользователя он строит ожидания в файле и проверяет их ревью. Мотивация — предсказуемость.',
);
info.text(
  'Переходы выводит oc3-мост из событий стадийного opencode run: события стадии пишутся в planner-events.jsonl, обмен harness и моста идёт через bridge.json, мост входит в oc3-плагин. Модель событий не объявляет.',
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
      on: {
        gathered: { to: 'composing', label: 'контекст собран' },
        replied: { to: 'awaiting_input', label: 'ответ без записи' },
      },
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
    'EOF или пустая строка в REPL ставят сессию на паузу: автомат остаётся на месте, файл ожиданий — в последнем записанном виде; open <id> продолжает с той же точки',
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
  crit(
    'переходы выводит oc3-мост из событий сессии планера (planner-events.jsonl); модель событий не объявляет',
    () => Machine.hooksDrive(),
  );
  crit(
    'из команд планера разрешена только команда отчёта ожиданий; остальное блокирует oc3-мост',
    () => Machine.bashOnlyReport(),
  );
  crit(
    'ход планера — стадийный opencode run: границы хода — exit процесса, события — planner-events.jsonl',
    () => Machine.stopJson(),
  );
});

planReview.entry(() => {
  crit('вход — ai plan-review start <file>: сессия открывается на конкретном файле ожиданий', () =>
    Machine.entry(),
  );
  crit(
    'при запуске сессии планера harness поднимает страницу плана и открывает её в браузере; сервер живёт, пока открыта сессия планера',
    () => Machine.pageWithSession(),
  );
  crit(
    'адрес страницы — в промпте планера; на чистом ревью планер даёт ссылку вместе с пояснениями',
    () => Machine.pageLink(),
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
  crit('промпт планера содержит справочник блоков и пример, который собирается без ошибок', () =>
    Machine.promptExample(),
  );
});

planReview.transition('awaiting_input', 'request', () => {
  crit('запрос пользователя входит в задание стадии планера: текст и файлы-аттачменты', () =>
    Machine.requestInteractive(),
  );
  crit('событие request — первый промпт стадии awaiting_input, пойманный мостом', () =>
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
    'событие exit — слово «выход» в промпте awaiting_input или флаг [plan-review: exit] в последней строке ответа стадии',
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
  crit(
    'событие gathered — первая правка файла ожиданий (permission evaluate: edit/write) в gathering',
    () => Machine.hook('gathering', 'edit', 'gathered'),
  );
});

planReview.transition('gathering', 'replied', () => {
  crit(
    'событие replied — стадия gathering завершилась без правок файла: планер ответил и ждёт ввода',
    () => Machine.replied(),
  );
});

planReview.state('composing', () => {
  warn('планер записывает в файл ожидания по собранному контексту только из блоков перечня', () =>
    Machine.plannerRole(),
  );
  warn('ожидание без готовой проверки записывается заглушкой crit.todo или crit.wip', () =>
    Machine.plannerRole(),
  );
  crit('планер правит только файл ожиданий: правка другого файла блокируется oc3-мостом', () =>
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
  crit('событие unclear — вопрос планера без флага выхода в состоянии composing', () =>
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
  crit('событие answered — ответ пользователя, переданный следующим заданием в clarify_form', () =>
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
    'ai plan-review start <file>: существующий файл ожиданий — план изменения его состояния; нового файла нет — создаётся каркас с plan({ name })',
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
    'команды планера: ai plan-review start | open | list | status | validate | graph | hook',
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
  crit('headless-прогоны задают флаги явно и не исполняют плагины проекта', () =>
    Check.explicitFlags(),
  );
});

const NOW = new Date('2026-10-14T12:00:00Z');
const ARTIFACTS = '.opencode/artifacts/plan-review';
const BRIDGE_FILE = artifactRelative({ kind: 'bridge', key: 'bridge.json' });
const TMP = (): string => path.join(repoRoot(), 'packages/harness/test/.tmp');

const GOOD = `import { describe } from 'vitest';
import { budget, crit, info, plan } from '@shahimat/ai-core/expect';
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

const EXIT_FLAG = { text: 'Файл записан.\n[plan-review: exit]' } as const;

const NO_REMARKS = `import { budget, plan, step, steps } from '@shahimat/ai-core/expect';
budget({ crit: 0, warn: 0 });
plan({ name: 'демо' });
steps(() => { step('T1', { title: 'шаг', after: ['T9'] }, () => {}); });
`;

const PLANNER_AGENT_FIXTURE = `---
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

const JUDGE_AGENT_FIXTURE = `---
description: Судья ревью ожиданий
mode: subagent
tools:
  read: true
  glob: true
  grep: true
---

Судья: проверяет ожидания как судья, возвращает JSON-ответ.
`;

interface Turn {
  text?: string;
  write?: string;
  events?: { kind: string; path: string }[];
  exit?: number;
}

interface Options {
  turns?: Turn[];
  plan?: string;
  request?: string;
  files?: Record<string, string>;
  cycles?: number;
  judgeWrites?: boolean;
  reopen?: boolean;
  endHook?: boolean;
  stopProbe?: boolean;
  lines?: string[];
}

interface HookCall {
  hook: HookName;
  code: number;
  raw: number;
  json: boolean;
  message: string;
}

const PAGE_URL = 'http://127.0.0.1:1/';

function blockReason(lines: string[]): string | undefined {
  for (const line of lines) {
    let data: unknown;
    try {
      data = parseJson(line);
    } catch {
      continue;
    }
    if (typeof data !== 'object' || data === null || !('decision' in data) || !('reason' in data))
      continue;
    if (data.decision === 'block' && typeof data.reason === 'string') return data.reason;
  }
  return undefined;
}

interface FlowResult {
  id: string;
  short: string;
  home: string;
  project: string;
  state: string;
  planFile: string;
  title: string;
  request: string;
  transitions: string[];
  hooks: HookCall[];
  stages: StageSpec[];
  headless: Parameters<ModelRunner['headless']>[0][];
  plan: string;
  artifacts: string[];
  files: Record<string, string>;
  pages: { file: string; stopped: boolean }[];
  bridge: { root: string; events: string; plan: string; report: string } | undefined;
  plannerAgent: string;
  judgeAgent: string;
  logs: string[];
}

const planAbs = (project: string, file: string): string => path.join(project, file);

const bridgeOf = (text: string): { root: string; events: string; plan: string; report: string } => {
  const parsed = parseJson(text);
  if (!isRecord(parsed)) return { root: '', events: '', plan: '', report: '' };
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  return {
    root: str(parsed['root']),
    events: str(parsed['events']),
    plan: str(parsed['plan']),
    report: str(parsed['report']),
  };
};

async function runFlow(options: Options): Promise<FlowResult> {
  await mkdir(TMP(), { recursive: true });
  const home = await mkdtemp(path.join(TMP(), 'plan-review-home-'));
  const project = await mkdtemp(path.join(TMP(), 'plan-review-proj-'));
  const planFile = options.plan ?? `${ARTIFACTS}/демо.expect.ts`;
  spawnSync('git', ['init', '-q'], { cwd: project });
  await mkdir(path.join(project, '.opencode', 'agents'), { recursive: true });
  await writeFile(path.join(project, '.opencode', 'agents', 'planner.md'), PLANNER_AGENT_FIXTURE);
  await writeFile(path.join(project, '.opencode', 'agents', 'judge.md'), JUDGE_AGENT_FIXTURE);
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
  const stages: StageSpec[] = [];
  const headless: FlowResult['headless'] = [];
  const hooks: HookCall[] = [];
  const turns = [...(options.turns ?? [])];
  const lines = [...(options.lines ?? [])];
  let id = '';
  const run = (words: string[]) => {
    const match = HARNESS.findCommand(words);
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
  const logs: string[] = [];
  const pages: { file: string; stopped: boolean }[] = [];
  const stageRunner: StageRunner = {
    run: async (spec: StageSpec): Promise<StageResult> => {
      stages.push(spec);
      const turn = turns[stages.length - 1] ?? {};
      if (turn.write !== undefined) await writeFile(planAbs(project, planFile), turn.write);
      if (turn.events !== undefined) {
        const bridgeText = await readFile(path.join(project, BRIDGE_FILE), 'utf8');
        const eventsFile = bridgeOf(bridgeText).events;
        const linesOut = turn.events.map(
          (e) => `${JSON.stringify({ ...e, at: NOW.toISOString() })}\n`,
        );
        await appendFile(eventsFile, linesOut.join(''), 'utf8');
      }
      return { code: turn.exit ?? 0, text: turn.text ?? '' };
    },
  };
  const judgeRunner: ModelRunner = {
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
  const saved = {
    runner: planIo.runner,
    stage: planIo.stage,
    repl: planIo.repl,
    stdin: planIo.stdin,
    terminal: planIo.terminal,
    page: planIo.page,
  };
  const log = console.log;
  const error = console.error;
  planIo.runner = () => judgeRunner;
  planIo.stage = () => stageRunner;
  planIo.repl = async () => lines.shift() ?? '';
  planIo.terminal = () => true;
  planIo.page = async (_root, file) => {
    const page = { file, stopped: false };
    pages.push(page);
    return {
      url: PAGE_URL,
      stop: async () => {
        page.stopped = true;
      },
    };
  };
  console.log = (...a: unknown[]) => {
    logs.push(a.join(' '));
  };
  console.error = (...a: unknown[]) => {
    errors.push(a.join(' '));
  };
  try {
    await run(['plan-review', 'start', planFile]);
    [id = ''] = await readdir(path.join(home, 'sessions'));
    if (options.stopProbe === true) {
      planIo.stdin = async () => JSON.stringify({ message: 'пытался записать' });
      const before = errors.length;
      const logBefore = logs.length;
      const code = await run(['plan-review', 'hook', id, 'stop']);
      const reason = blockReason(logs.slice(logBefore));
      hooks.push({
        hook: 'stop',
        code: reason === undefined ? code : 2,
        raw: code,
        json: reason !== undefined,
        message: reason ?? errors.slice(before).join('\n'),
      });
      errors.length = before;
    }
    if (options.endHook === true) {
      planIo.stdin = async () => JSON.stringify({ reason: 'other' });
      const before = errors.length;
      const code = await run(['plan-review', 'hook', id, 'end']);
      hooks.push({ hook: 'end', code, raw: code, json: false, message: '' });
      errors.length = before;
    }
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
    const bridgePath = path.join(project, BRIDGE_FILE);
    const bridgeText = existsSync(bridgePath) ? await readFile(bridgePath, 'utf8') : undefined;
    const bridge = bridgeText === undefined ? undefined : bridgeOf(bridgeText);
    return {
      id,
      short: s.short,
      home,
      project,
      state: s.data.state,
      planFile: s.data.planFile ?? '',
      title: s.data.title,
      request: s.data.request,
      transitions,
      hooks,
      stages,
      headless,
      plan: existsSync(planAbs(project, planFile))
        ? await readFile(planAbs(project, planFile), 'utf8')
        : '',
      artifacts: existsSync(path.join(project, ARTIFACTS))
        ? (await readdir(path.join(project, ARTIFACTS))).sort()
        : [],
      files,
      pages,
      bridge,
      plannerAgent: PLANNER_AGENT_FIXTURE,
      judgeAgent: JUDGE_AGENT_FIXTURE,
      logs,
    };
  } finally {
    console.log = log;
    console.error = error;
    planIo.runner = saved.runner;
    planIo.stage = saved.stage;
    planIo.repl = saved.repl;
    planIo.stdin = saved.stdin;
    planIo.terminal = saved.terminal;
    planIo.page = saved.page;
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
}

const once = <T>(make: () => Promise<T>): (() => Promise<T>) => {
  let value: Promise<T> | undefined;
  return () => (value ??= make());
};

const edit = (file = `${ARTIFACTS}/демо.expect.ts`): { kind: string; path: string } => ({
  kind: 'edit',
  path: file,
});

const Flows = {
  idle: once(() => runFlow({})),
  clean: once(() =>
    runFlow({
      turns: [
        { events: [edit()], write: GOOD, text: 'записал' },
        { text: 'Готово.\n[plan-review: exit]' },
      ],
    }),
  ),
  red: once(() =>
    runFlow({
      cycles: 1,
      turns: [
        { events: [edit()], write: RED, text: 'раз' },
        { events: [edit()], write: `${RED}// 2\n`, text: 'два' },
      ],
    }),
  ),
  broken: once(() =>
    runFlow({
      turns: [
        { events: [edit()], write: BROKEN, text: 'раз' },
        { write: BROKEN, text: 'два' },
        { write: BROKEN, text: 'три' },
        { write: BROKEN, text: 'четыре' },
      ],
    }),
  ),
  noRemarks: once(() =>
    runFlow({
      turns: [{ events: [edit()], write: NO_REMARKS, text: 'записал' }, { text: 'поясняю' }],
    }),
  ),
  exitAsk: once(() =>
    runFlow({
      turns: [
        { events: [edit()], write: GOOD, text: 'записал' },
        { text: 'отвечаю' },
        { text: 'Выхожу.\n[plan-review: exit]' },
      ],
      lines: ['выйди из плана'],
    }),
  ),
  exitFlag: once(() =>
    runFlow({
      turns: [{ events: [edit()], write: GOOD, text: EXIT_FLAG.text }],
    }),
  ),
  exitFlagRed: once(() =>
    runFlow({
      turns: [{ events: [edit()], write: RED, text: EXIT_FLAG.text }, { text: 'исправил' }],
    }),
  ),
  paused: once(() =>
    runFlow({
      reopen: true,
      endHook: true,
      turns: [{ events: [edit()], write: GOOD, text: 'записал' }, { text: 'дополнил' }],
      lines: ['добавь ещё'],
    }),
  ),
  judgeWrites: once(() =>
    runFlow({
      judgeWrites: true,
      turns: [{ events: [edit()], write: GOOD, text: 'записал' }, { text: 'поясняю' }],
    }),
  ),
  brokenProbe: once(() =>
    runFlow({
      stopProbe: true,
      turns: [
        { events: [edit()], write: BROKEN, text: 'раз' },
        { write: BROKEN, text: 'два' },
        { write: BROKEN, text: 'три' },
        { write: BROKEN, text: 'четыре' },
      ],
    }),
  ),
};

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

  static async bashOnlyReport(): Promise<void> {
    const f = await Flows.idle();
    const report = f.bridge?.report ?? '';
    expect(report).toMatch(/ expect report \S+ --root /);
    expect(bashDecision(report, report)).toEqual({});
    for (const command of ['ls', 'cat x', 'echo x > a.ts', `cd /tmp && ${report}`])
      expect(bashDecision(command, report).block).toContain('Read, Glob и Grep');
  }

  static async stopJson(): Promise<void> {
    const f = await Flows.brokenProbe();
    const stop = f.hooks.find((h) => h.hook === 'stop');
    expect(stop?.json).toBe(true);
    expect(stop?.raw).toBe(0);
    expect(stop?.code).toBe(2);
    expect(stop?.message).toContain('не собирается');
  }

  static async pageWithSession(): Promise<void> {
    const f = await Flows.idle();
    expect(f.pages).toEqual([{ file: f.planFile, stopped: true }]);
    expect(f.logs.join('\n')).toContain(`страница плана: ${PAGE_URL}`);
    const browser = process.env['BROWSER'];
    delete process.env['BROWSER'];
    try {
      expect(openerFor('http://x/')?.at(-1)).toBe('http://x/');
    } finally {
      if (browser !== undefined) process.env['BROWSER'] = browser;
    }
  }

  static async pageLink(): Promise<void> {
    expect((await Flows.idle()).stages[0]?.systemPrompt).toContain(PAGE_URL);
    expect((await Flows.clean()).logs.join('\n')).toContain(PAGE_URL);
  }

  static async promptExample(): Promise<void> {
    const prompt = (await Flows.idle()).stages[0]?.systemPrompt ?? '';
    const code = /```ts\n([\s\S]*?)```/.exec(prompt)?.[1];
    if (code === undefined) throw new Error('в промпте планера нет примера');
    await mkdir(TMP(), { recursive: true });
    const dir = await mkdtemp(path.join(TMP(), 'planner-example-'));
    try {
      await writeFile(
        path.join(dir, 'package.json'),
        '{"name":"fixture","private":true,"type":"module"}',
      );
      await writeFile(path.join(dir, 'example.expect.ts'), code);
      const run = spawnSync(
        process.execPath,
        [
          path.join(repoRoot(), 'packages/cli/dist/bin.js'),
          'expect',
          'report',
          'example.expect.ts',
          '--root',
          dir,
        ],
        { cwd: dir, encoding: 'utf8' },
      );
      expect(run.stdout).not.toContain('файл не собран');
      expect(run.stdout).toMatch(/ожиданий [1-9]\d*:/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  static async sameAsFsm(): Promise<void> {
    const { def } = await builtinDef();
    Graph.sameAs(planReview, def);
  }

  static async hooksDrive(): Promise<void> {
    const f = await Flows.idle();
    const hookNode = HARNESS.findCommand(['plan-review', 'hook', 'x', 'stop']);
    expect(hookNode?.command.path).toEqual(['plan-review', 'hook', '<id>', '<hook>']);
    expect(f.bridge?.plan).toBe(f.planFile);
    expect(f.bridge?.events).toContain('planner-events.jsonl');
    expect(f.bridge?.report).toContain(' expect report ');
    expect(f.stages[0]?.task).toBe('спланируй');
  }

  static async entry(): Promise<void> {
    const f = await Flows.idle();
    expect(f.planFile).toBe(`${ARTIFACTS}/демо.expect.ts`);
    expect(f.state).toBe('awaiting_input');
    expect(f.stages[0]?.systemPrompt).toContain(f.planFile);
  }

  static awaitingReadOnly(): void {
    const plan = '/p/plan.expect.ts';
    expect(hookEvent('awaiting_input', 'edit', { file_path: plan }, plan).block).toContain(
      'не меняется',
    );
    expect(hookEvent('awaiting_input', 'edit', { file_path: '/p/src/a.ts' }, plan).block).toContain(
      'только файл ожиданий',
    );
  }

  static async blocksListed(): Promise<void> {
    const prompt = (await Flows.idle()).stages[0]?.systemPrompt ?? '';
    for (const block of ['fsm(', 'steps(', 'Паттерны']) expect(prompt).toContain(block);
  }

  static async requestInteractive(): Promise<void> {
    const f = await Flows.clean();
    expect(f.stages).toHaveLength(2);
    expect(f.stages[0]?.task).toBe('спланируй');
    expect(f.transitions[0]).toBe('awaiting_input -request-> gathering');
  }

  static hook(state: string, hook: HookName, event: string): void {
    const plan = '/p/plan.expect.ts';
    const input = { file_path: plan };
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
    expect((await Flows.paused()).state).toBe('awaiting_input');
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
    expect(red.logs.join('\n')).toContain('Выход отложен');
    const ask = await Flows.exitAsk();
    expect(ask.transitions.slice(-3)).toEqual([
      'awaiting_input -request-> gathering',
      'gathering -replied-> awaiting_input',
      'awaiting_input -exit-> finished',
    ]);
    expect(ask.plan).toBe(GOOD);
  }

  static async replied(): Promise<void> {
    const f = await Flows.exitAsk();
    expect(f.transitions).toContain('gathering -replied-> awaiting_input');
    const { def } = await builtinDef();
    expect(def.states.find((s) => s.name === 'gathering')?.on['replied']?.[0]?.to).toBe(
      'awaiting_input',
    );
  }

  static async pause(): Promise<void> {
    const f = await Flows.paused();
    expect(f.state).toBe('awaiting_input');
    expect(f.plan).toBe(GOOD);
    const sessions = new Set(f.stages.map((r) => r.sessionId));
    expect(sessions.size).toBe(1);
    expect(f.stages[0]?.resume).toBe(false);
    expect(f.stages.at(-1)?.resume).toBe(true);
    expect(f.hooks.find((h) => h.hook === 'end')?.code).toBe(0);
  }

  static async subagents(): Promise<void> {
    const f = await Flows.idle();
    expect(f.plannerAgent).toContain('task: true');
    expect(f.plannerAgent).toContain('read: true');
  }

  static gatheringReadOnly(): void {
    const plan = '/p/plan.expect.ts';
    const write = { file_path: plan };
    expect(hookEvent('gathering', 'edit', write, plan)).toEqual({ event: 'gathered' });
    expect(hookEvent('composing', 'edit', write, plan)).toEqual({});
  }

  static async onlyPlanFile(): Promise<void> {
    const plan = '/p/plan.expect.ts';
    for (const state of ['gathering', 'composing'])
      expect(hookEvent(state, 'edit', { file_path: '/p/README.md' }, plan).block).toContain(
        'только файл ожиданий',
      );
    const f = await Flows.idle();
    expect(f.plannerAgent).toContain('edit: true');
    expect(f.plannerAgent).toContain('write: true');
  }

  static async reviewOnBuild(): Promise<void> {
    const broken = await Flows.broken();
    expect(broken.headless).toEqual([]);
    expect(broken.transitions).not.toContain('composing -written-> review');
    expect(broken.logs.join('\n')).toContain('не собирается');
    const clean = await Flows.clean();
    expect(clean.transitions).toContain('composing -written-> review');
  }

  static async buildLimit(): Promise<void> {
    const f = await Flows.broken();
    expect(f.state).toBe('composing');
    expect(f.logs.join('\n')).toContain('не собирается (3/3)');
    expect(f.stages).toHaveLength(4);
  }

  static async answerVerbatim(): Promise<void> {
    const ask = await runFlow({
      turns: [
        {
          events: [edit()],
          write: GOOD,
          text: 'каким блоком строить?\n[plan-review: ask]',
        },
        { text: 'записал' },
      ],
      lines: ['steps'],
      request: 'спланируй',
    });
    expect(ask.transitions).toContain('composing -unclear-> clarify_form');
    expect(ask.stages[1]?.task).toBe('steps');
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
    expect(f.logs.join('\n')).toMatch(/crit 0\/0 · warn 0\/0 · info \d+/);
    const red = await Flows.red();
    expect(red.transitions).toContain('analyze -remarks-> composing');
  }

  static async judgeReadOnly(): Promise<void> {
    const f = await Flows.judgeWrites();
    expect(f.plan).toBe(GOOD);
    expect(f.logs.join('\n')).toContain('Ревью 1');
  }

  static judgeTools(): void {
    expect(JUDGE_TOOLS).toEqual(['Read', 'Glob', 'Grep']);
    const args = opencodeArgs('judge', 'zai-coding-plan/glm-5.3#max');
    expect(args).toEqual([
      'run',
      '--format',
      'json',
      '--auto',
      '--agent',
      'judge',
      '--model',
      'zai-coding-plan/glm-5.3#max',
    ]);
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
    expect(f.logs.join('\n')).toContain('info.remarks()');
    const clean = await Flows.clean();
    expect(clean.logs.join('\n')).not.toContain('info.remarks()');
  }

  static async remarksBack(): Promise<void> {
    const f = await Flows.red();
    expect(f.transitions.filter((t) => t.startsWith('analyze'))[0]).toBe(
      'analyze -remarks-> composing',
    );
    expect(f.logs.join('\n')).toContain('сверх бюджета файла');
    expect(f.logs.join('\n')).toContain('ожидание не выполнено');
  }

  static async cyclesExhausted(): Promise<void> {
    const f = await Flows.red();
    expect(f.transitions.filter((t) => t.startsWith('analyze'))).toEqual([
      'analyze -remarks-> composing',
      'analyze -remarks-> awaiting_input',
    ]);
    expect(f.state).toBe('awaiting_input');
    expect(f.logs.join('\n')).toContain('где зациклился');
  }

  static async cleanBack(): Promise<void> {
    const f = await Flows.clean();
    expect(f.transitions).toContain('analyze -clean-> awaiting_input');
    expect(f.logs.join('\n')).toContain('поясни пользователю');
    expect(f.transitions.at(-1)).toBe('awaiting_input -exit-> finished');
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
    expect(lines.filter((l) => HARNESS.findCommand(l.split(' ')) === undefined)).toEqual([]);
    for (const old of ['check', 'render', 'read', 'clone'])
      expect(HARNESS.findCommand(['plan-review', old, 's'])).toBeUndefined();
  }

  static async home(): Promise<void> {
    expect(harnessHome()).toBe(path.join(homedir(), '.config', 'harness'));
    expect(harnessHome('/tmp/elsewhere')).toBe(path.resolve('/tmp/elsewhere'));
    const f = await Flows.idle();
    expect(f.id).toMatch(/^[0-9a-f]{64}$/);
    expect(path.relative(f.project, f.home).startsWith('..')).toBe(true);
  }

  static async fsmDrives(): Promise<void> {
    const machine = await readRepo('packages/harness/src/harnesses/core/fsm/machine.ts');
    expect({
      resolve: machine.includes('await resolve(def, registry, current, event, ctx)'),
      save: machine.includes('await journal.save(next, current.state, event)'),
    }).toEqual({ resolve: true, save: true });
  }

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
    const args = opencodeArgs('planner', 'zai-coding-plan/glm-5.3#max');
    expect(args).toContain('--format');
    expect(args).toContain('json');
    expect(args).toContain('--auto');
    expect(args).toContain('--agent');
    expect(args).toContain('planner');
    expect(args).toContain('--model');
    expect(args).toContain('zai-coding-plan/glm-5.3#max');
  }
}

class Start {
  static async file(): Promise<void> {
    const f = await Flows.idle();
    expect(f.artifacts).toEqual(['демо.expect.ts']);
    expect(f.bridge?.root).toBe(path.resolve(f.project));
    expect(f.bridge?.events).toBe(
      path.join(
        f.project,
        artifactRelative({ kind: 'bridge', key: f.short, name: 'planner-events.jsonl' }),
      ),
    );
    expect(f.plan).toContain("plan({ name: 'демо' })");
    expect(f.planFile).toBe(`${ARTIFACTS}/демо.expect.ts`);
    const existing =
      "import { plan } from '@shahimat/ai-core/expect';\nplan({ name: 'Текущее состояние' });\n";
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
    const empty = await runFlow({ request: '', lines: ['допиши план входа'] });
    expect(empty.request).toBe('');
    expect(empty.stages.map((r) => r.task)).toEqual(['допиши план входа']);
    expect(empty.stages[0]?.systemPrompt).toContain('дождись запроса');
    const line = await runFlow({ request: 'одной строкой' });
    expect(line.stages.map((r) => r.task)).toEqual(['одной строкой']);
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
        "import { describe } from 'vitest';\nimport { budget, crit, fsm, plan } from '@shahimat/ai-core/expect';\nbudget({ crit: 0, warn: 0 });\nplan({ name: 'Демо-план' });\nfsm('demo-flow', { initial: 'a', states: { a: { actor: 'model', on: { go: 'b' } }, b: { final: true } } });\ndescribe('раздел', () => { crit('ожидание плана', () => {}); });\n",
      );
      const outRel = `${expectHelperDir(file)}/page.html`;
      const out = path.join(dir, outRel);
      const run = spawnSync(
        process.execPath,
        [
          path.join(repoRoot(), 'packages/cli/dist/bin.js'),
          'expect',
          'report',
          file,
          '--root',
          dir,
          '--html',
          outRel,
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
