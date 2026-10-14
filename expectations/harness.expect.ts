import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildContextIndex,
  COMMANDS,
  computeSync,
  createSession,
  DELTA_SCHEMA,
  DEFAULT_CHANGELOG,
  findCommand,
  headlessArgs,
  interactiveArgs,
  KNOWN_ADAPTERS,
  KNOWN_CHECKS,
  loadHarness,
  parseConfig,
  parseFrontmatter,
  parseMachine,
  planIo,
  plannerTools,
  renderUsage,
  REVIEW_TOOLS,
  runOutdated,
  selfCommand,
  splitWords,
  UsageError,
  type MachineDef,
  type PlanContext,
} from '@shahimat/harness';
import * as harnessPkg from '@shahimat/harness';
import {
  applyAnswers,
  budget,
  crit,
  DEFAULT_LIMITS,
  indexEntries,
  judged,
  markdownRegions,
  MAX_TITLE,
  readRepo,
  repoRoot,
  warn,
} from '@shahimat/harness/expect';
import {
  at,
  parseJson,
  recordOrEmpty,
  stringAt,
  stringList,
  unknownList,
} from './shared/guards.ts';

budget({ crit: 0, warn: 0 });

describe('[harness] common', () => {
  crit(
    'состав harness: команды и скрипты check, refresh, changelog, context, adapters, delta, outdated, expect, index, secrets; harness plan-review, docs-delta, source-sync (команды harness — под его именем)',
    () => Check.composition(),
  );
  crit(
    'пакеты: @shahimat/harness — CLI и механизм ожиданий, @shahimat/expectations — наборы ожиданий; других нет',
    () => Check.packages(),
  );
  crit(
    'других команд, кроме перечисленных в разделах [harness] <процесс> этого файла и harness-plan-review.expect.ts, у harness нет',
    () => Check.noOtherCommands(),
  );
  crit('в репозитории нет bash-скриптов: вся автоматизация на TS и Node ≥ 24', () =>
    Check.noBash(),
  );
  crit('CI прогоняет harness на ubuntu, macos и windows', () => Check.ciMatrix());
  crit(
    'TypeScript в режиме strict: strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes',
    () => Check.tsStrict(),
  );
  crit('у каждой команды CLI из справки есть юнит-тест', () => Check.commandsTested());
  crit('коды выхода CLI: 0 — ok, 1 — нарушения, 2 — ошибка вызова или конфигурации', () =>
    Check.exitCodes(),
  );
  crit(
    'неизвестный ключ в context/harness.yml — ошибка конфига, а не молча выключенная проверка',
    () => Check.strictConfig(),
  );
  crit('справка CLI строится из декларативного дерева команд', () => Check.commandTree());
  crit('ошибка конфига называет путь до поля', () => Check.configErrorPath());
  warn('итог прогона считает код по бюджету и ответам модели, а не модель', () =>
    Check.verdictByCode(),
  );
  crit('ответ модели вне схемы отклоняется', () => Check.answerSchema());
  warn(
    'задание проверяющей модели содержит только вопросы и доказательства, без контекста автора',
    () => Check.cleanContext(),
  );
  crit('уровни замечаний общие для ожиданий и критериев плана: crit, warn, info', () =>
    Check.sharedLevels(),
  );
  crit(
    'harness живёт в одном каталоге src/harnesses/<имя>: harness.yaml, критерии и промпты рядом с кодом',
    () => Processes.colocated(),
  );
  crit('имя harness — категория-вид через дефис; core зарезервировано за ядром', () =>
    Processes.names(),
  );
  crit(
    'id сессии — sha256; в выводе 7 символов, open принимает уникальный префикс от 4 символов',
    () => Processes.shortIds(),
  );
  crit(
    'пауза — выход: каждый переход сразу на диске; open заново выполняет действие текущего состояния — в состоянии агента это приём задания, из failed — сброс счётчиков',
    () => Processes.pauseIsExit(),
  );
  crit(
    'harness не использует контекст вызывающей сессии: входы — аргументы start, файлы проекта и ответы, записанные в сессию',
    () => Processes.noCallerContext(),
  );
  it.todo(
    'дополнения проекта и пользователя подключаются из конфига динамическим import, без форка пакета',
  );
});

describe('[harness] layers', () => {
  crit(
    'слои пакета: shared → lib → commands → scripts → harnesses; импорт только вниз по слоям',
    () => Layers.downward(),
  );
  crit('команда не импортирует другие команды, скрипты и harness', () => Layers.commandsIsolated());
  crit('внутренний модуль команды или harness импортируется только из своего скоупа', () =>
    Layers.scopes(),
  );
  crit('harness не импортирует другие harness', () => Layers.harnessIsolated());
  crit(
    'ядро автомата (fsm, runner, store, registry) не зависит ни от одного конкретного harness',
    () => Layers.coreIndependent(),
  );
  crit('каждый модуль shared импортируют хотя бы два слайса', () => Layers.sharedReused());
  crit(
    'скрипт — только последовательность команд или алиасов одной команды, без своей логики',
    () => Layers.scriptsAreSequences(),
  );
  crit('каждый узел дерева CLI объявляет вид: command, script или harness', () =>
    Layers.nodeKinds(),
  );
  crit(
    'каждая команда объявляет эффект: query или mutation; эффект скрипта выводится из его команд',
    () => Layers.effects(),
  );
  crit(
    'query-команда не меняет ни одного файла, кроме кэша, адресованного по содержимому и не лежащего в git',
    () => Layers.queryReadOnly(),
  );
  crit('CI запускает один скрипт ci, и все его команды — query', () => Layers.ciQuery());
  crit(
    'модель в состоянии harness получает в Bash только query-команды и не получает инструмента Skill',
    () => Layers.stateTools(),
  );
  crit('проверка JSON Schema в пакете — одна функция в shared', () => Layers.oneSchemaCheck());
  crit('скрипт package.json не вызывает скрипт, который сам агрегирует несколько команд', () =>
    Layers.npmScriptsFlat(),
  );
  crit(
    'skill либо объявляет metadata.runs — скрипт, одну команду или harness пакета, либо ничего не запускает',
    () => Skills.runsDeclared(),
  );
  warn(
    'skill запускает только то, что объявлено в metadata.runs; остальные команды harness лишь упоминает',
    () => Skills.runsOnly(),
  );
  crit('субагент не запускает команды harness: запуск — в skill, который он загружает', () =>
    Skills.agentsRunNothing(),
  );
  crit(
    'в состоянии агента harness останавливается с заданием; open <id> продолжает со следующего состояния',
    () => Processes.handoff(),
  );
});

describe('[harness] refresh', () => {
  crit('скрипт harness refresh — context index и adapters sync, затем шаги check', () =>
    Processes.refresh(),
  );
});

describe('[harness] docs-delta', () => {
  crit('команды harness docs-delta start | open | list | status | validate | graph', () =>
    Processes.resolve('docs-delta'),
  );
  crit(
    'автомат docs-delta: apply → verify → close; провал verify или close возвращает в apply не больше 3 раз, затем failed',
    () => Processes.docsDelta(),
  );
  crit('verify в docs-delta — context index, adapters sync, delta check и шаги check', () =>
    Processes.docsVerify(),
  );
});

describe('[harness] source-sync', () => {
  crit('команды harness source-sync start | open | list | status | validate | graph', () =>
    Processes.resolve('source-sync'),
  );
  crit(
    'автомат source-sync: outdated → update → refresh; провал refresh возвращает в update не больше 3 раз, затем failed',
    () => Processes.sourceSync(),
  );
  crit('skill docs-keeper объявляет runs: docs-delta, skill source-sync — runs: source-sync', () =>
    Skills.processSkills(),
  );
});

describe('[harness] check', () => {
  crit('команда harness check — все проверки из context/harness.yml разом', () =>
    Check.commands(['check']),
  );
  crit('проверки harness check: changelog, context-index, adapters, secrets — других нет', () =>
    Check.checks(),
  );
});

describe('[harness] changelog', () => {
  crit('команда harness changelog lint — формат CHANGELOG.md', () =>
    Check.commands(['changelog lint']),
  );
  crit('строка журнала — не длиннее 120 символов', () => Check.changelogLine());
  crit('теги ядра — ровно arch, stack, dep, milestone', () => Check.coreTags());
});

describe('[harness] context', () => {
  crit('команда harness context index — генерация context/index.yml из слоёв документации', () =>
    Check.commands(['context index']),
  );
  crit(
    'команда harness context check — сверка context/index.yml со слоями документации без записи',
    () => Check.commands(['context check']),
  );
  warn('context/index.yml генерируется harness context index и не содержит даты генерации', () =>
    Check.contextIndexNoDate(),
  );
});

describe('[harness] adapters', () => {
  crit(
    'команда harness adapters sync — файлы под Claude Code и Codex из AGENTS.md и .agents/',
    () => Check.commands(['adapters sync']),
  );
  crit(
    'команда harness adapters check — сверка файлов адаптеров с AGENTS.md и .agents/ без записи',
    () => Check.commands(['adapters check']),
  );
  crit('адаптеры под инструменты: claude-code и codex — других нет', () => Check.adapters());
  crit('adapters sync не меняет и не удаляет файлы без метки harness', () => Check.adaptersSafe());
  warn(
    'adapters sync выключает memory: autoMemoryEnabled false в Claude Code, memories false в Codex',
    () => Check.memoryOff(),
  );
});

describe('[harness] outdated', () => {
  crit('команда harness outdated — версия проекта против npm и журнал изменений между ними', () =>
    Check.commands(['outdated']),
  );
  crit('harness outdated сообщает текущую и последнюю версию и записи журнала между ними', () =>
    Check.outdatedReport(),
  );
});

describe('[harness] expect', () => {
  crit('команды harness expect init | report | lint | judge — ожидания проекта', () =>
    Check.commands(['expect init', 'expect report', 'expect lint', 'expect judge']),
  );
  crit('смысловая проверка заголовков файла запускается только при изменении его заголовков', () =>
    Check.lintOnTitleChange(),
  );
  crit(
    'судья вызывается только для вердиктов, у которых изменились заголовок или доказательства',
    () => Check.judgeOnlyStale(),
  );
  crit('пакет судьи — не больше 25 вопросов и 80 KB доказательств', () => Check.batchLimits());
  crit('ответ судьи без дословной цитаты из доказательства отклоняется', () =>
    Check.quoteRequired(),
  );
  crit('в кэше вердиктов только вердикты живых ожиданий', () => Check.cachePruned());
  crit('CI проверяет ожидания без вызова LLM', () => Check.ciWithoutLlm());
  crit('файлы ожиданий ссылаются на доказательства только якорями @KEY, без путей', () =>
    Check.anchorsOnly(),
  );
  crit('ожидание — не длиннее 200 символов', () => Check.titleLimit());
});

describe('[harness] expect plan', () => {
  crit(
    'шаг плана — step(id, { title, status, after }), его ожидания — DoD; статус todo | active | done',
    () => Plan.stepForm(),
  );
  crit(
    'ожидания шага todo не запускаются; active — запускаются, но не блокируют прогон; done — блокируют',
    () => Plan.stepStatuses(),
  );
  crit('шаг не бывает done, пока не done все шаги из after; граф шагов без циклов', () =>
    Plan.stepOrder(),
  );
  crit('crit.todo и warn.todo несут уровень ожидания без проверки и не блокируют прогон', () =>
    Plan.todoLevels(),
  );
  crit(
    'machine(name, { initial, limits, states }) описывает автомат данными: состояния, actor, события, переходы, лимиты',
    () => Plan.machineData(),
  );
  crit(
    'ожидания привязываются к состоянию, переходу или автомату целиком: state, transition, whole',
    () => Plan.machineScopes(),
  );
  crit('неизвестное состояние или событие в machine, state и transition — ошибка typecheck', () =>
    Plan.machineTypos(),
  );
  crit(
    'зонды Graph: sameAs — совпадение с harness.yaml, canReach — достижимость, onlyVia — путь только через состояние',
    () => Plan.graphProbes(),
  );
  crit(
    'expect report --html <out> [--file <path>] пишет самодостаточный HTML: без сети и без JS; тот же вход — побайтно тот же файл',
    () => Plan.htmlStandalone(),
  );
  crit(
    'схемы автомата и шагов в HTML — SVG от Graphviz-wasm при генерации; узел и переход ведут к своей карточке',
    () => Plan.htmlGraphs(),
  );
  warn('цвет узла на схеме — статус его ожиданий: todo, пройдено, провал', () =>
    Plan.htmlStatuses(),
  );
  crit(
    'HTML отмечает новые и удалённые относительно HEAD ожидания; замена в том же разделе — изменение',
    () => Plan.htmlDiff(),
  );
});

describe('[harness] delta', () => {
  crit(
    'команды harness delta check | close — дельта проектной документации в context/.delta/',
    () => Check.commands(['delta check', 'delta close']),
  );
  crit(
    'delta check: удалённая или изменённая относительно HEAD сущность слоёв документации без пункта revise — нарушение',
    () => Check.deltaCheck(),
  );
  crit('delta close удаляет дельту только при чистом delta check и выполненных пунктах', () =>
    Check.deltaClose(),
  );
  crit('context index не включает context/.delta/', () => Check.deltaNotIndexed());
  crit('схема дельты в пакете совпадает с expectations/schemas/docs-delta.schema.json', () =>
    Check.deltaSchema(),
  );
});

describe('[harness] secrets', () => {
  crit('команда harness secrets scan [--file <path>] — поиск секретов в проекте или в файле', () =>
    Check.commands(['secrets scan']),
  );
  crit(
    'проверка secrets падает, если в отслеживаемых файлах проекта есть секрет: ключ API, токен, пароль, приватный ключ',
    () => Check.secretsFound(),
  );
  crit(
    'secrets включена в harness check по умолчанию; выключить её можно только явно в context/harness.yml',
    () => Check.secretsByDefault(),
  );
  crit(
    'ложное срабатывание снимается только явным исключением в context/harness.yml с указанием причины',
    () => Check.secretsAllow(),
  );
  crit('в выводе найденный секрет замаскирован: путь, строка и тип — без значения', () =>
    Check.secretsMasked(),
  );
  crit('secrets проверяет и файл вне проекта по пути — для артефактов, которые уходят наружу', () =>
    Check.secretsFile(),
  );
  warn(
    'docs-keeper не записывает секрет в документацию: вместо значения — указатель на хранилище',
    () => Check.docsKeeperSecrets(),
  );
});

describe('[harness] index', () => {
  crit('команды harness index build | check — индекс prompts/index.yml источника промптов', () =>
    Check.commands(['index build', 'index check']),
  );
  crit('у skill в индексе sha256 каждого файла', () => Check.skillFileShas());
});

const PKG = 'packages/harness';
const SCHEMAS = 'expectations/schemas';
const BIN = () => path.join(repoRoot(), PKG, 'dist/bin.js');
const cli = (args: string[], cwd = repoRoot()) =>
  spawnSync(process.execPath, [BIN(), ...args], { cwd, encoding: 'utf8' }).status;

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'harness-expect-'));
}

async function snapshot(
  dir: string,
  skip: (rel: string) => boolean = () => false,
): Promise<Record<string, string>> {
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name))
    .filter((file) => !skip(path.relative(dir, file).split(path.sep).join('/')));
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [path.relative(dir, file), await readFile(file, 'utf8')] as const),
    ),
  );
}

const REVISE_NAMING =
  'summary: s\nitems:\n  - op: revise\n    kind: rule\n    target: naming\n    summary: snake_case\n    evidence: e\n    was: kebab-case\n    why: w\n';

async function withGitProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await tempDir();
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    await mkdir(path.join(dir, 'context/conventions'), { recursive: true });
    await mkdir(path.join(dir, 'context/.delta'), { recursive: true });
    await mkdir(path.join(dir, 'context/modules'), { recursive: true });
    await writeFile(
      path.join(dir, 'context/project.yml'),
      'name: demo\nnamespaces:\n  core: ядро\n',
    );
    await writeFile(
      path.join(dir, 'context/conventions/naming.yml'),
      'key: naming\nsummary: kebab-case\nrule: x\n',
    );
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init', '--allow-empty');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'docs');
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SECRET_SAMPLES: Record<string, string> = {
  'api-key': `aws_key = ${'AKIA'}${'Q7XK2M9PLR4TWZ8N'}`,
  token: `token: ${'ghp'}_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}`,
  password: `password: "${'Tr0ub4dor'}&3-${'horse'}"`,
  'private-key': `${'-----BEGIN'} RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----`,
};
const SECRET_VALUE = `${'AKIA'}${'Q7XK2M9PLR4TWZ8N'}`;

async function withSecretProject(
  config: string,
  notes: string,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  await withGitProject(async (dir) => {
    const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    await writeFile(path.join(dir, 'context/harness.yml'), config);
    await writeFile(path.join(dir, 'notes.md'), `# Заметки\n\n${notes}\n`);
    git('add', '.');
    await fn(dir);
  });
}

const cliOut = (args: string[], cwd = repoRoot()) =>
  spawnSync(process.execPath, [BIN(), ...args], { cwd, encoding: 'utf8' });

async function usageCommands(): Promise<string[]> {
  return COMMANDS.map((c) => c.path.join(' '));
}

const DECLARED_COMMANDS = [
  'check',
  'changelog lint',
  'context index',
  'context check',
  'adapters sync',
  'adapters check',
  'expect init',
  'expect report',
  'expect lint',
  'expect judge',
  'delta check',
  'delta close',
  'outdated',
  'index build',
  'index check',
  'secrets scan',
  'refresh',
  ...['plan-review', 'docs-delta', 'source-sync'].flatMap((p) => [
    `${p} start`,
    `${p} open <id>`,
    `${p} list`,
    `${p} status <id>`,
    `${p} validate`,
    `${p} graph`,
  ]),
  'plan-review check <id>',
  'plan-review render <id>',
  'plan-review read <id>',
  'plan-review clone <id>',
  'plan-review clone <id> md',
];

class Check {
  static async secretsFound(): Promise<void> {
    for (const [kind, sample] of Object.entries(SECRET_SAMPLES)) {
      await withSecretProject('checks: {}\n', sample, async (dir) => {
        expect({ kind, status: cli(['check', '--root', dir]) }).toEqual({ kind, status: 1 });
      });
    }
    await withSecretProject('checks: {}\n', 'без секретов', async (dir) => {
      expect(cli(['check', '--root', dir])).toBe(0);
    });
  }

  static async secretsByDefault(): Promise<void> {
    const sample = SECRET_SAMPLES['api-key'] ?? '';
    await withSecretProject('version: "0"\n', sample, async (dir) => {
      expect(cli(['check', '--root', dir])).toBe(1);
    });
    await withSecretProject('checks:\n  secrets: false\n', sample, async (dir) => {
      expect(cli(['check', '--root', dir])).toBe(0);
    });
  }

  static async secretsAllow(): Promise<void> {
    const sample = SECRET_SAMPLES['api-key'] ?? '';
    const allow = (extra: string) =>
      `checks:\n  secrets:\n    allow:\n      - path: notes.md\n        line: 3\n${extra}`;
    await withSecretProject(
      allow('        reason: пример из документации AWS\n'),
      sample,
      async (dir) => {
        expect(cli(['check', '--root', dir])).toBe(0);
      },
    );
    await withSecretProject(allow(''), sample, async (dir) => {
      expect(cli(['check', '--root', dir])).toBe(2);
    });
  }

  static async secretsMasked(): Promise<void> {
    await withSecretProject('checks: {}\n', SECRET_SAMPLES['api-key'] ?? '', async (dir) => {
      const run = cliOut(['check', '--root', dir]);
      const out = `${run.stdout}${run.stderr}`;
      expect(out).toMatch(/notes\.md:3: \S/);
      expect(out).not.toContain(SECRET_VALUE);
    });
  }

  static async secretsFile(): Promise<void> {
    const dir = await tempDir();
    try {
      const file = path.join(dir, 'proposal.json');
      await writeFile(file, JSON.stringify({ evidence: SECRET_SAMPLES['token'] }));
      expect(cli(['secrets', 'scan', '--file', file])).toBe(1);
      await writeFile(file, JSON.stringify({ evidence: 'обезличенная выдержка' }));
      expect(cli(['secrets', 'scan', '--file', file])).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  static docsKeeperSecrets = (): Promise<void> => judged(['@docs-secrets']);

  static async packages(): Promise<void> {
    const dirs = (await packageDirs()).sort();
    const names = await Promise.all(
      dirs.map(async (d) =>
        stringAt(parseJson(await readRepo(`packages/${d}/package.json`)), 'name'),
      ),
    );
    expect(names.sort()).toEqual(['@shahimat/expectations', '@shahimat/harness']);
  }

  static async commands(list: string[]): Promise<void> {
    const usage = await usageCommands();
    expect(list.filter((c) => !usage.includes(c))).toEqual([]);
  }

  static async composition(): Promise<void> {
    expect([...new Set(COMMANDS.map((c) => c.path[0] ?? ''))].sort()).toEqual([
      'adapters',
      'changelog',
      'check',
      'context',
      'delta',
      'docs-delta',
      'expect',
      'index',
      'outdated',
      'plan-review',
      'refresh',
      'secrets',
      'source-sync',
    ]);
    const planIter = await readRepo('expectations/harness-plan-review.expect.ts');
    expect(planIter).toContain("describe('[harness] plan-review'");
    const own = await readRepo('expectations/harness.expect.ts');
    for (const section of ['refresh', 'docs-delta', 'source-sync'])
      expect(own).toContain(`describe('[harness] ${section}'`);
  }

  static async noOtherCommands(): Promise<void> {
    expect((await usageCommands()).filter((c) => !DECLARED_COMMANDS.includes(c))).toEqual([]);
  }

  static checks(): void {
    expect([...KNOWN_CHECKS].sort()).toEqual(['adapters', 'changelog', 'context-index', 'secrets']);
  }

  static adapters(): void {
    expect([...KNOWN_ADAPTERS].sort()).toEqual(['claude-code', 'codex']);
  }

  static async noBash(): Promise<void> {
    const pkg = parseJson(await readRepo(`${PKG}/package.json`));
    expect(at(pkg, 'engines', 'node')).toBe('>=24');
    expect(await readRepo('.gitattributes')).toContain('eol=lf');
    const out = spawnSync('git', ['ls-files', '*.sh'], {
      cwd: repoRoot(),
      encoding: 'utf8',
    }).stdout.trim();
    expect(out).toBe('');
  }

  static async ciMatrix(): Promise<void> {
    expect(await readRepo('.github/workflows/check-index.yml')).toMatch(
      /os: \[ubuntu-latest, macos-latest, windows-latest\]/,
    );
  }

  static async tsStrict(): Promise<void> {
    const compilerOptions = async (file: string): Promise<Record<string, unknown>> => {
      const cfg = parseJson(await readRepo(file));
      const parent = at(cfg, 'extends');
      const base =
        typeof parent === 'string'
          ? await compilerOptions(path.posix.join(path.posix.dirname(file), parent))
          : {};
      return { ...base, ...recordOrEmpty(at(cfg, 'compilerOptions'), `${file}: compilerOptions`) };
    };
    for (const pkg of ['harness', 'expectations']) {
      const opts = await compilerOptions(`packages/${pkg}/tsconfig.json`);
      expect({
        pkg,
        strict: opts['strict'],
        nui: opts['noUncheckedIndexedAccess'],
        eopt: opts['exactOptionalPropertyTypes'],
      }).toEqual({
        pkg,
        strict: true,
        nui: true,
        eopt: true,
      });
    }
  }

  static async commandsTested(): Promise<void> {
    const commands = await usageCommands();
    const tests = (
      await Promise.all(
        (await readdir(path.join(repoRoot(), PKG, 'test')))
          .filter((f) => f.endsWith('.test.ts'))
          .map((f) => readRepo(`${PKG}/test/${f}`)),
      )
    ).join('\n');
    const untested = commands.filter((c) => {
      const [group = '', sub] = c.split(' ');
      if (sub === undefined)
        return !new RegExp(`\\['${group}'|run${group[0]?.toUpperCase()}${group.slice(1)}\\(`).test(
          tests,
        );
      const call = c
        .split(' ')
        .map((seg) => (seg.startsWith('<') ? '[^,()]+' : `'${seg.replace(/[*]/g, '\\*')}'`))
        .join(',\\s*');
      return !new RegExp(call).test(tests);
    });
    expect(commands.length).toBeGreaterThan(5);
    expect(untested).toEqual([]);
  }

  static async exitCodes(): Promise<void> {
    const dir = await tempDir();
    try {
      await writeFile(path.join(dir, 'CHANGELOG.md'), '- 2026-10-13 · [arch] a · b\n');
      expect(cli(['changelog', 'lint', '--root', dir])).toBe(0);
      await writeFile(path.join(dir, 'CHANGELOG.md'), '- 2026-10-13 · без тега · b\n');
      expect(cli(['changelog', 'lint', '--root', dir])).toBe(1);
      expect(cli(['нет-такой-команды'])).toBe(2);
      await mkdir(path.join(dir, 'context'));
      await writeFile(path.join(dir, 'context/harness.yml'), 'checks:\n  nope: {}\n');
      expect(cli(['check', '--root', dir])).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  static strictConfig(): void {
    expect(() => parseConfig('checks:\n  changelg: {}\n')).toThrow(UsageError);
    expect(() => parseConfig('chekcs: {}\n')).toThrow(UsageError);
  }

  static async commandTree(): Promise<void> {
    const usage = renderUsage();
    expect(
      COMMANDS.map((c) => c.path.join(' ')).filter((c) => !usage.includes(`harness ${c}`)),
    ).toEqual([]);
    expect(await readRepo(`${PKG}/src/cli.ts`)).not.toMatch(/switch \(|Использование:/);
  }

  static configErrorPath(): void {
    expect(() => parseConfig('checks:\n  changelog:\n    max_line: x\n')).toThrow(
      'checks.changelog.max_line',
    );
    expect(() => parseConfig('checks:\n  changelog:\n    bogus: 1\n')).toThrow('checks.changelog');
  }

  static verdictByCode = (): Promise<void> => judged(['@verdict-by-code']);

  static answerSchema(): void {
    const item = { id: 'a', question: 'q', evidence: [{ ref: 'x', sha: 's', bytes: 1 }] };
    const texts = new Map([['x', 'текст доказательства про memory']]);
    const notArray = applyAnswers([item], { id: 'a' }, texts, new Date());
    const notBool = applyAnswers(
      [item],
      [{ id: 'a', verdict: 'да', ref: 'x', quote: 'доказательства про memory' }],
      texts,
      new Date(),
    );
    expect(Object.keys({ ...notArray.accepted, ...notBool.accepted })).toEqual([]);
    expect([...notArray.rejected, ...notBool.rejected].map((r) => r.id)).toEqual(['*', 'a']);
  }

  static cleanContext = (): Promise<void> => judged(['@judge-clean-context']);

  static async sharedLevels(): Promise<void> {
    const schema = parseJson(await readRepo(`${SCHEMAS}/plan-criteria.schema.json`));
    expect(at(schema, 'properties', 'criteria', 'items', 'properties', 'level', 'enum')).toEqual([
      'crit',
      'warn',
      'info',
    ]);
  }

  static lintOnTitleChange = (): Promise<void> => judged(['@expect-cycles']);
  static judgeOnlyStale = (): Promise<void> => judged(['@expect-cycles']);

  static batchLimits(): void {
    expect(DEFAULT_LIMITS).toEqual({ maxItems: 25, maxBytes: 80_000 });
  }

  static quoteRequired(): void {
    const item = { id: 'a', question: 'q', evidence: [{ ref: 'x', sha: 's', bytes: 1 }] };
    const texts = new Map([['x', 'текст доказательства про memory']]);
    const ok = applyAnswers(
      [item],
      [{ id: 'a', verdict: true, ref: 'x', quote: 'доказательства про memory' }],
      texts,
      new Date(),
    );
    const bad = applyAnswers(
      [item],
      [{ id: 'a', verdict: true, ref: 'x', quote: 'придуманная цитата судьи' }],
      texts,
      new Date(),
    );
    expect(Object.keys(ok.accepted)).toEqual(['a']);
    expect(bad.rejected.map((r) => r.id)).toEqual(['a']);
  }

  static cachePruned = (): Promise<void> => judged(['@verdict-prune']);

  static async ciWithoutLlm(): Promise<void> {
    const ci = await readRepo('.github/workflows/check-index.yml');
    const leaves = await npmLeaves(ciRuns(ci));
    expect(leaves.some((l) => /bin\.js expect report/.test(l))).toBe(true);
    expect([ci, ...leaves].join('\n')).not.toMatch(/secrets\.|ANTHROPIC|OPENAI|expect judge/);
  }

  static async anchorsOnly(): Promise<void> {
    const files = (await readdir(path.join(repoRoot(), 'expectations'), { recursive: true }))
      .filter((f) => f.endsWith('.expect.ts'))
      .map((f) => `expectations/${f.split(path.sep).join('/')}`)
      .concat(
        'packages/expectations/src/ticket-commits.ts',
        'packages/expectations/src/attention.ts',
      );
    const paths: string[] = [];
    for (const f of files) {
      for (const m of (await readRepo(f)).matchAll(/judged\(\[([^\]]*)\]\)/g)) {
        for (const ref of (m[1] ?? '').matchAll(/'([^']*)'/g))
          if (!(ref[1] ?? '').startsWith('@')) paths.push(`${f}: ${ref[1]}`);
      }
    }
    expect(paths).toEqual([]);
  }

  static titleLimit(): void {
    expect(MAX_TITLE).toBe(200);
  }

  static async adaptersSafe(): Promise<void> {
    const dir = await tempDir();
    try {
      await writeFile(path.join(dir, 'AGENTS.md'), '# x\n');
      await writeFile(path.join(dir, 'CLAUDE.md'), 'ручной CLAUDE.md\n');
      await mkdir(path.join(dir, '.claude/agents'), { recursive: true });
      await writeFile(path.join(dir, '.claude/agents/mine.md'), '---\nname: mine\n---\nсвой\n');
      const { actions, diagnostics } = await computeSync(dir, ['claude-code']);
      expect(
        actions.filter((a) => a.path === 'CLAUDE.md' || a.path === '.claude/agents/mine.md'),
      ).toEqual([]);
      expect(diagnostics.some((d) => d.file === 'CLAUDE.md')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  static contextIndexNoDate = (): Promise<void> => judged(['@context-index-no-date']);
  static memoryOff = (): Promise<void> => judged(['@memory-off']);

  static async skillFileShas(): Promise<void> {
    const bad = (await indexEntries()).filter(
      (e) =>
        e.kind === 'skill' &&
        !(
          (e.files?.length ?? 0) > 0 &&
          (e.files ?? []).every((f) => /^[0-9a-f]{64}$/.test(f.sha256))
        ),
    );
    expect(bad.map((e) => e.key)).toEqual([]);
  }

  static async deltaCheck(): Promise<void> {
    await withGitProject(async (dir) => {
      await writeFile(
        path.join(dir, 'context/conventions/naming.yml'),
        'key: naming\nsummary: snake_case\nrule: x\n',
      );
      expect(cli(['delta', 'check', '--root', dir])).toBe(1);
      await writeFile(path.join(dir, 'context/.delta/naming.yml'), REVISE_NAMING);
      expect(cli(['delta', 'check', '--root', dir])).toBe(0);
    });
  }

  static async deltaClose(): Promise<void> {
    await withGitProject(async (dir) => {
      const delta = path.join(dir, 'context/.delta/naming.yml');
      await writeFile(delta, REVISE_NAMING);
      expect(cli(['delta', 'close', '--root', dir])).toBe(1);
      expect(existsSync(delta)).toBe(true);
      await writeFile(
        path.join(dir, 'context/conventions/naming.yml'),
        'key: naming\nsummary: snake_case\nrule: x\n',
      );
      expect(cli(['delta', 'close', '--root', dir])).toBe(0);
      expect(existsSync(delta)).toBe(false);
    });
  }

  static async deltaNotIndexed(): Promise<void> {
    await withGitProject(async (dir) => {
      await writeFile(
        path.join(dir, 'context/modules/m.yml'),
        'provides:\n  index_layers:\n    - { section: drafts, dir: context, format: yml }\n',
      );
      await writeFile(
        path.join(dir, 'context/.delta/leak.yml'),
        'id: leak\nnamespace: core\nsummary: утечка\n',
      );
      expect((await buildContextIndex(dir)).text).not.toContain('leak');
    });
  }

  static async deltaSchema(): Promise<void> {
    expect(DELTA_SCHEMA).toEqual(JSON.parse(await readRepo(`${SCHEMAS}/docs-delta.schema.json`)));
  }

  static changelogLine(): void {
    expect(DEFAULT_CHANGELOG.maxLine).toBe(120);
  }

  static coreTags(): void {
    expect([...DEFAULT_CHANGELOG.tags].sort()).toEqual(['arch', 'dep', 'milestone', 'stack']);
  }

  static async outdatedReport(): Promise<void> {
    const dir = await tempDir();
    const logs: string[] = [];
    const log = console.log;
    try {
      await mkdir(path.join(dir, 'context'));
      await writeFile(path.join(dir, 'context/harness.yml'), 'version: 0.1.0\n');
      const changelog = '## 0.3.0\n\n- новое C\n\n## 0.2.0\n\n- новое B\n\n## 0.1.0\n\n- старое\n';
      console.log = (...a: unknown[]) => logs.push(a.join(' '));
      const code = await runOutdated({ root: dir, now: new Date() }, async (url) => ({
        ok: true,
        status: 200,
        text: async () =>
          url.includes('registry')
            ? JSON.stringify({ 'dist-tags': { latest: '0.3.0' } })
            : changelog,
      }));
      expect(code).toBe(1);
      const text = logs.join('\n');
      expect(text).toContain('0.1.0 → 0.3.0');
      expect(text).toContain('- новое C');
      expect(text).toContain('- новое B');
      expect(text).not.toContain('- старое');
    } finally {
      console.log = log;
      await rm(dir, { recursive: true, force: true });
    }
  }
}

const LAYERS = ['shared', 'lib', 'commands', 'scripts', 'harnesses', 'app'] as const;
type Layer = (typeof LAYERS)[number];
const APP_FILES = ['bin.ts', 'cli.ts', 'index.ts', 'tree.ts', 'shell.ts'];
const FACADE = 'index.ts';

function layerOf(file: string): Layer | undefined {
  if (APP_FILES.includes(file)) return 'app';
  const [head = '', ...rest] = file.split('/');
  if (head === 'harnesses' && rest.length === 1 && rest[0] !== 'index.ts') return undefined;
  return LAYERS.find((l) => l === head && l !== 'app' && rest.length > 0);
}

function sliceOf(file: string): string {
  const parts = file.split('/');
  if ((parts[0] === 'commands' || parts[0] === 'harnesses') && parts.length > 2)
    return `${parts[0]}/${parts[1] ?? ''}`;
  return layerOf(file) ?? file;
}

const isPublic = (file: string): boolean =>
  file.endsWith('/index.ts') && file.split('/').length === 3;

const rank = (file: string): number => LAYERS.indexOf(layerOf(file) ?? 'app');

async function srcFiles(): Promise<string[]> {
  return (await readdir(path.join(repoRoot(), PKG, 'src'), { recursive: true }))
    .map((f) => f.split(path.sep).join('/'))
    .filter((f) => f.endsWith('.ts'));
}

async function importsOf(file: string): Promise<string[]> {
  const text = await readRepo(`${PKG}/src/${file}`);
  return [...text.matchAll(/(?:from |import\()'([.#][^']+)'/g)].map((m) => {
    const spec = m[1] ?? '';
    return spec.startsWith('#')
      ? `${spec.slice(1)}.ts`
      : path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  });
}

async function violations(bad: (file: string, target: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  for (const file of await srcFiles())
    for (const target of await importsOf(file))
      if (bad(file, target)) out.push(`${file} → ${target}`);
  return out;
}

const node = (words: readonly string[]): unknown => findCommand(words)?.command;
const kindOf = (n: unknown): unknown => at(n, 'kind');
const effectOf = (n: unknown): unknown => at(n, 'effect');
const isEffect = (v: unknown): boolean => v === 'query' || v === 'mutation';
const label = (n: unknown): string => stringList(at(n, 'path'), 'path').join(' ');

const ciRuns = (workflow: string): string[] =>
  [...workflow.matchAll(/^\s*run: (.+)$/gm)]
    .map((m) => (m[1] ?? '').trim())
    .filter((r) => r !== 'npm ci');

interface NpmScripts {
  name: string;
  scripts: Record<string, string>;
}

async function readNpmScripts(rel: string): Promise<NpmScripts> {
  const pkg = parseJson(await readRepo(rel));
  const scripts = recordOrEmpty(at(pkg, 'scripts'), `${rel}: scripts`);
  return {
    name: stringAt(pkg, 'name'),
    scripts: Object.fromEntries(
      Object.entries(scripts).map(([k, v]) => [k, typeof v === 'string' ? v : '']),
    ),
  };
}

async function packageDirs(): Promise<string[]> {
  return (await readdir(path.join(repoRoot(), 'packages'), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

async function npmPackages(): Promise<{ root: NpmScripts; workspaces: NpmScripts[] }> {
  const dirs = await packageDirs();
  return {
    root: await readNpmScripts('package.json'),
    workspaces: await Promise.all(dirs.map((d) => readNpmScripts(`packages/${d}/package.json`))),
  };
}

function npmRef(part: string): { script: string; workspace?: string } | undefined {
  const m = /^npm (?:run (\S+)|(test))(?: -w (\S+))?$/.exec(part.trim());
  if (m === null) return undefined;
  const script = m[1] ?? m[2] ?? '';
  return m[3] === undefined ? { script } : { script, workspace: m[3] };
}

const partsOf = (script: string): string[] => script.split('&&').map((p) => p.trim());

async function npmLeaves(runs: string[]): Promise<string[]> {
  const { root, workspaces } = await npmPackages();
  const expand = (part: string, pkg: NpmScripts, seen: string[]): string[] => {
    const ref = npmRef(part);
    if (ref === undefined) return [part];
    const target =
      ref.workspace === undefined ? pkg : workspaces.find((w) => w.name === ref.workspace);
    const body = target?.scripts[ref.script];
    const key = `${target?.name ?? '?'}:${ref.script}`;
    if (target === undefined || body === undefined || seen.includes(key)) return [part];
    return partsOf(body).flatMap((p) => expand(p, target, [...seen, key]));
  };
  return runs.flatMap((r) => partsOf(r).flatMap((p) => expand(p, root, [])));
}

function harnessWords(line: string): string[] | undefined {
  const words = splitWords(line);
  const start = words.findIndex(
    (w, i) =>
      /(^|[\\/])bin\.js$/.test(w) ||
      (i === 0 && w === 'harness') ||
      /^@shahimat\/harness(@|$)/.test(w),
  );
  if (start < 0) return undefined;
  const rest = words.slice(start + 1);
  const end = rest.findIndex((w) => w.startsWith('--'));
  return end < 0 ? rest : rest.slice(0, end);
}

const PLAN_SAMPLE =
  '---\nharness: plan-review\nsession: s\nstatus: draft\nrevision: 1\n---\n# План\n\n## Цель\n\nцель\n\n## Пункты\n\n### T1. Пункт\n\n- Тип: task\n- Зависит от: —\n- Мотивация: м\n- DoD:\n  - [ ] д\n';

class Layers {
  static async downward(): Promise<void> {
    const files = await srcFiles();
    expect(files.filter((f) => layerOf(f) === undefined)).toEqual([]);
    expect(LAYERS.filter((l) => !files.some((f) => layerOf(f) === l))).toEqual([]);
    expect(await violations((f, t) => rank(t) > rank(f))).toEqual([]);
  }

  static async commandsIsolated(): Promise<void> {
    expect(
      await violations(
        (f, t) =>
          layerOf(f) === 'commands' &&
          (layerOf(t) === 'scripts' ||
            layerOf(t) === 'harnesses' ||
            (layerOf(t) === 'commands' && sliceOf(t) !== sliceOf(f))),
      ),
    ).toEqual([]);
  }

  static async scopes(): Promise<void> {
    expect(
      await violations(
        (f, t) =>
          (layerOf(t) === 'commands' || layerOf(t) === 'harnesses') &&
          sliceOf(t) !== sliceOf(f) &&
          t !== 'harnesses/index.ts' &&
          !isPublic(t),
      ),
    ).toEqual([]);
  }

  static async harnessIsolated(): Promise<void> {
    const own = (s: string): boolean => s.startsWith('harnesses/') && s !== 'harnesses/core';
    expect(
      await violations(
        (f, t) =>
          own(sliceOf(f)) &&
          (t === 'harnesses/index.ts' || (own(sliceOf(t)) && sliceOf(t) !== sliceOf(f))),
      ),
    ).toEqual([]);
  }

  static async coreIndependent(): Promise<void> {
    const files = await srcFiles();
    expect(files.filter((f) => sliceOf(f) === 'harnesses/core').length).toBeGreaterThan(3);
    expect(
      await violations(
        (f, t) =>
          sliceOf(f) === 'harnesses/core' &&
          layerOf(t) === 'harnesses' &&
          sliceOf(t) !== 'harnesses/core',
      ),
    ).toEqual([]);
  }

  static async sharedReused(): Promise<void> {
    const users = new Map<string, Set<string>>();
    for (const file of await srcFiles()) {
      if (layerOf(file) === 'shared') users.set(file, users.get(file) ?? new Set());
      if (layerOf(file) === 'shared' || file === FACADE) continue;
      for (const t of await importsOf(file))
        if (layerOf(t) === 'shared') users.set(t, (users.get(t) ?? new Set()).add(sliceOf(file)));
    }
    expect(users.size).toBeGreaterThan(0);
    expect(
      [...users].filter(([, s]) => s.size < 2).map(([f, s]) => `${f}: ${[...s].join(', ')}`),
    ).toEqual([]);
  }

  static async scriptsAreSequences(): Promise<void> {
    const scripts = COMMANDS.filter((n) => kindOf(n) === 'script');
    expect(scripts.map(label)).toContain('check');
    const bad: string[] = [];
    for (const s of scripts) {
      const steps = unknownList(at(s, 'steps'), `${label(s)}: steps`);
      if (steps.length === 0) bad.push(`${label(s)}: нет шагов`);
      for (const step of steps) {
        const command = stringList(at(step, 'command'), `${label(s)}: steps.command`);
        const extra = Object.keys(recordOrEmpty(step, 'step')).filter(
          (k) => k !== 'command' && k !== 'enabledBy',
        );
        if (kindOf(node(command)) !== 'command')
          bad.push(`${label(s)}: ${command.join(' ')} — не команда`);
        if (extra.length > 0) bad.push(`${label(s)}: лишние поля шага ${extra.join(', ')}`);
      }
    }
    const logic = ['scripts/run.ts', 'scripts/commands.ts'];
    const declarations = (await srcFiles()).filter(
      (f) => layerOf(f) === 'scripts' && !logic.includes(f),
    );
    for (const f of declarations)
      if (/=>|\bfunction\b|\bif\s*\(|\bfor\s*\(|\bawait\b/.test(await readRepo(`${PKG}/src/${f}`)))
        bad.push(`${f}: логика в объявлении скрипта`);
    expect(bad).toEqual([]);
  }

  static nodeKinds(): void {
    const kinds: unknown[] = ['command', 'script', 'harness'];
    expect(COMMANDS.filter((n) => !kinds.includes(kindOf(n))).map(label)).toEqual([]);
  }

  static effects(): void {
    const bad: string[] = [];
    for (const n of COMMANDS) {
      if (kindOf(n) !== 'script') {
        if (!isEffect(effectOf(n))) bad.push(`${label(n)}: нет эффекта`);
        continue;
      }
      if (effectOf(n) !== undefined) bad.push(`${label(n)}: эффект скрипта объявлен, а не выведен`);
      for (const step of unknownList(at(n, 'steps'), 'steps')) {
        const command = stringList(at(step, 'command'), 'steps.command');
        if (!isEffect(effectOf(node(command))))
          bad.push(`${label(n)}: у шага ${command.join(' ')} нет эффекта`);
      }
    }
    expect(bad).toEqual([]);
  }

  static async queryReadOnly(): Promise<void> {
    await withGitProject(async (dir) => {
      const home = await tempDir();
      try {
        await writeFile(path.join(dir, 'AGENTS.md'), '# x\n');
        await writeFile(path.join(dir, 'CHANGELOG.md'), '- 2026-10-14 · без тега · b\n');
        await writeFile(
          path.join(dir, 'context/harness.yml'),
          'adapters: [claude-code, codex]\nchecks:\n  changelog: {}\n  context-index: {}\n  adapters: {}\n',
        );
        const session = await createSession(home, {
          harness: 'plan-review',
          title: 'демо',
          request: 'запрос',
          project: dir,
          initial: 'awaiting_user',
          now: new Date(),
        });
        await writeFile(path.join(session.dir, 'plan.md'), PLAN_SAMPLE);
        expect(cli(['plan-review', 'render', session.id, '--home', home])).toBe(0);

        const query = COMMANDS.filter((n) => effectOf(n) === 'query');
        expect(query.length).toBeGreaterThan(10);
        const notGit = (rel: string): boolean => rel === '.git' || rel.startsWith('.git/');
        const before = [await snapshot(dir, notGit), await snapshot(home)];
        for (const n of query) {
          const words = stringList(at(n, 'path'), 'path').map((seg) =>
            seg === '<id>' ? session.id : seg,
          );
          const args = ['--root', dir, '--home', home, '--raw-base', 'https://example.invalid'];
          spawnSync(process.execPath, [BIN(), ...words, ...args], {
            cwd: dir,
            encoding: 'utf8',
            env: { ...process.env, BROWSER: process.execPath },
          });
        }
        expect([await snapshot(dir, notGit), await snapshot(home)]).toEqual(before);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    });
  }

  static async ciQuery(): Promise<void> {
    const runs = ciRuns(await readRepo('.github/workflows/check-index.yml'));
    expect(runs).toEqual(['npm run ci']);
    const bad: string[] = [];
    for (const leaf of await npmLeaves(runs)) {
      const words = harnessWords(leaf);
      if (words !== undefined && effectOf(node(words)) !== 'query') bad.push(`${leaf}: не query`);
      if (/--write\b/.test(leaf)) bad.push(`${leaf}: пишет файлы проекта`);
    }
    expect(bad).toEqual([]);
  }

  static async stateTools(): Promise<void> {
    const home = await tempDir();
    try {
      const session = await createSession(home, {
        harness: 'plan-review',
        title: 'демо',
        request: 'запрос',
        project: home,
        initial: 'draft',
        now: new Date(),
      });
      const { harness } = await loadHarness(home, 'plan-review');
      if (harness === undefined) throw new Error('plan-review не загрузился');
      const ctx: PlanContext = {
        session,
        home,
        def: harness.def,
        criteria: harness.criteria,
        runner: planIo.runner(),
        prompter: planIo.prompter(),
        self: selfCommand(),
      };
      const planner = plannerTools(ctx);
      const bash = planner.allowed.flatMap((r) => /^Bash\((.*)\)$/.exec(r)?.[1] ?? []);
      expect(bash.length).toBeGreaterThan(0);
      expect(bash.filter((cmd) => effectOf(node(harnessWords(cmd) ?? [])) !== 'query')).toEqual([]);

      const toolsOf = (args: string[]): string[] =>
        (args[args.indexOf('--tools') + 1] ?? '').split(',');
      const interactive = interactiveArgs({
        cwd: home,
        model: 'opus',
        sessionId: 's',
        name: 'n',
        addDirs: [],
        systemPrompt: '',
        settings: {},
        tools: planner.tools,
        allowedTools: planner.allowed,
        prompt: '',
      });
      const headless = [planner.tools, ...Object.values(REVIEW_TOOLS)].map((tools) =>
        headlessArgs({
          cwd: home,
          model: 'opus',
          addDirs: [],
          systemPrompt: '',
          tools,
          allowedTools: [],
          prompt: '',
          persist: false,
          maxTurns: 1,
        }),
      );
      for (const args of [interactive, ...headless]) {
        expect(args).toContain('--disable-slash-commands');
        expect(args).toContain('--tools');
        expect(toolsOf(args)).not.toContain('Skill');
      }
      for (const tools of Object.values(REVIEW_TOOLS)) expect(tools).not.toContain('Bash');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }

  static async oneSchemaCheck(): Promise<void> {
    const users: string[] = [];
    for (const f of await srcFiles())
      if (/from 'ajv(?:\/[^']*)?'/.test(await readRepo(`${PKG}/src/${f}`))) users.push(f);
    expect(users).toEqual(['shared/schema.ts']);
  }

  static async npmScriptsFlat(): Promise<void> {
    const { root, workspaces } = await npmPackages();
    const bad: string[] = [];
    for (const pkg of [root, ...workspaces])
      for (const [name, body] of Object.entries(pkg.scripts)) {
        if (partsOf(body).length < 2) continue;
        for (const p of partsOf(body)) {
          const ref = npmRef(p);
          if (ref === undefined) continue;
          const target =
            ref.workspace === undefined ? pkg : workspaces.find((w) => w.name === ref.workspace);
          const referenced = target?.scripts[ref.script];
          if (referenced !== undefined && partsOf(referenced).length > 1)
            bad.push(`${pkg.name}: ${name} → ${target?.name ?? ''}:${ref.script}`);
        }
      }
    expect(bad).toEqual([]);
  }
}

const HARNESSES = `${PKG}/src/harnesses`;
const HARNESS_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const RUNS_ANCHOR = 'skill-runs';
const MENTION = /`harness [a-z]/;

interface SkillFile {
  name: string;
  path: string;
  text: string;
  runs: unknown;
}

async function skillFiles(): Promise<SkillFile[]> {
  const names = (await readdir(path.join(repoRoot(), 'skills'))).sort();
  return Promise.all(
    names.map(async (name) => {
      const rel = `skills/${name}/SKILL.md`;
      const text = await readRepo(rel);
      return { name, path: rel, text, runs: at(parseFrontmatter(text), 'metadata', 'runs') };
    }),
  );
}

const runsCall = (runs: string): string => `harness ${runs}`;

const outsideRuns = (s: SkillFile): string =>
  markdownRegions(s.text, s.path)
    .filter((r) => r.key === RUNS_ANCHOR)
    .reduce((text, r) => text.replace(r.text, ''), s.text);

class Skills {
  static async runsDeclared(): Promise<void> {
    const bad: string[] = [];
    let declared = 0;
    for (const s of await skillFiles()) {
      if (s.runs === undefined) continue;
      declared++;
      if (typeof s.runs !== 'string') {
        bad.push(`${s.name}: metadata.runs — не строка`);
        continue;
      }
      if (HARNESS_NAME.test(s.runs)) {
        if (!existsSync(path.join(repoRoot(), HARNESSES, s.runs, 'harness.yaml')))
          bad.push(`${s.name}: нет harness ${s.runs}`);
      } else if (!['script', 'command'].includes(String(kindOf(node(s.runs.split(' ')))))) {
        bad.push(`${s.name}: ${s.runs} — не скрипт и не команда`);
      }
    }
    expect(declared).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  }

  static async runsOnly(): Promise<void> {
    const bad: string[] = [];
    for (const s of await skillFiles()) {
      if (MENTION.test(outsideRuns(s)))
        bad.push(`${s.name}: команда harness вне expect:${RUNS_ANCHOR}`);
      if (typeof s.runs === 'string' && !s.text.includes(runsCall(s.runs)))
        bad.push(`${s.name}: в тексте нет запуска ${runsCall(s.runs)}`);
      const declared = markdownRegions(s.text, s.path)
        .filter((r) => r.key === RUNS_ANCHOR)
        .flatMap((r) => [...r.text.matchAll(/<!-- metadata\.runs: (.+?) -->/g)].map((m) => m[1]));
      const expected = typeof s.runs === 'string' ? [s.runs] : [];
      if (JSON.stringify(declared) !== JSON.stringify(expected))
        bad.push(
          `${s.name}: в регионах metadata.runs ${declared.join(', ')} ≠ ${expected.join(', ')}`,
        );
    }
    expect(bad).toEqual([]);
    await judged([`@${RUNS_ANCHOR}`]);
  }

  static async agentsRunNothing(): Promise<void> {
    const bad: string[] = [];
    for (const f of await readdir(path.join(repoRoot(), 'agents')))
      if (MENTION.test(await readRepo(`agents/${f}`))) bad.push(f);
    expect(bad).toEqual([]);
  }

  static async processSkills(): Promise<void> {
    const runs = Object.fromEntries((await skillFiles()).map((s) => [s.name, s.runs]));
    expect({ docs: runs['docs-keeper'], source: runs['source-sync'] }).toEqual({
      docs: 'docs-delta',
      source: 'source-sync',
    });
  }
}

async function machine(name: string): Promise<MachineDef> {
  const file = `${HARNESSES}/${name}/harness.yaml`;
  const { def, errors } = parseMachine(await readRepo(file), file);
  if (def === undefined) throw new Error(errors.join('\n'));
  return def;
}

const edges = (def: MachineDef, state: string, event: string): { to: string; count?: string }[] =>
  (def.states.find((s) => s.name === state)?.on[event] ?? []).map((t) =>
    t.count === undefined ? { to: t.to } : { to: t.to, count: t.count },
  );

const resets = (def: MachineDef, state: string, event: string): string[] =>
  def.states.find((s) => s.name === state)?.on[event]?.[0]?.reset ?? [];

const stepCommands = (steps: unknown): string[] =>
  unknownList(steps, 'steps').map((s) => stringList(at(s, 'command'), 'command').join(' '));

async function harnessDirs(): Promise<string[]> {
  return (await readdir(path.join(repoRoot(), HARNESSES), { withFileTypes: true }))
    .filter((e) => e.isDirectory() && e.name !== 'core')
    .map((e) => e.name)
    .sort();
}

async function withProcessSession(
  fn: (s: { dir: string; home: string; id: string; start: string }) => Promise<void>,
): Promise<void> {
  await withGitProject(async (dir) => {
    const home = await tempDir();
    try {
      await writeFile(path.join(dir, 'context/harness.yml'), 'checks: {}\n');
      const run = cliOut(['docs-delta', 'start', '--name', 'демо', '--root', dir, '--home', home]);
      expect(run.status).toBe(0);
      const [id = ''] = await readdir(path.join(home, 'sessions'));
      await fn({ dir, home, id, start: `${run.stdout}${run.stderr}` });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
}

class Processes {
  static resolve(harness: string): void {
    const ops = ['start', 'open x', 'list', 'status x', 'validate', 'graph'];
    expect(ops.filter((op) => node([harness, ...op.split(' ')]) === undefined)).toEqual([]);
  }

  static refresh(): void {
    const refresh = node(['refresh']);
    expect(kindOf(refresh)).toBe('script');
    expect(stepCommands(at(refresh, 'steps'))).toEqual([
      'context index',
      'adapters sync',
      ...stepCommands(at(node(['check']), 'steps')),
    ]);
  }

  static async docsDelta(): Promise<void> {
    const def = await machine('docs-delta');
    const counter = edges(def, 'verify', 'fail')[0]?.count ?? '';
    expect(def.initial).toBe('apply');
    expect({
      apply: edges(def, 'apply', 'done'),
      verifyOk: edges(def, 'verify', 'ok'),
      verifyFail: edges(def, 'verify', 'fail'),
      closeOk: edges(def, 'close', 'ok'),
      closeFail: edges(def, 'close', 'fail'),
      limit: def.limits[counter],
      retry: edges(def, 'failed', 'retry'),
      retryReset: resets(def, 'failed', 'retry'),
      done: def.states.find((s) => s.name === 'done')?.final,
    }).toEqual({
      apply: [{ to: 'verify' }],
      verifyOk: [{ to: 'close' }],
      verifyFail: [{ to: 'apply', count: counter }, { to: 'failed' }],
      closeOk: [{ to: 'done' }],
      closeFail: [{ to: 'apply', count: counter }, { to: 'failed' }],
      limit: 3,
      retry: [{ to: 'apply' }],
      retryReset: [counter],
      done: true,
    });
  }

  static async sourceSync(): Promise<void> {
    const def = await machine('source-sync');
    const counter = edges(def, 'refresh', 'fail')[0]?.count ?? '';
    expect(def.initial).toBe('outdated');
    expect({
      outdated: edges(def, 'outdated', 'done'),
      update: edges(def, 'update', 'done'),
      refreshOk: edges(def, 'refresh', 'ok'),
      refreshFail: edges(def, 'refresh', 'fail'),
      limit: def.limits[counter],
      retry: edges(def, 'failed', 'retry'),
      retryReset: resets(def, 'failed', 'retry'),
      done: def.states.find((s) => s.name === 'done')?.final,
    }).toEqual({
      outdated: [{ to: 'update' }],
      update: [{ to: 'refresh' }],
      refreshOk: [{ to: 'done' }],
      refreshFail: [{ to: 'update', count: counter }, { to: 'failed' }],
      limit: 3,
      retry: [{ to: 'update' }],
      retryReset: [counter],
      done: true,
    });
  }

  static docsVerify(): void {
    expect(stepCommands(at(harnessPkg, 'DOCS_VERIFY', 'steps'))).toEqual([
      'context index',
      'adapters sync',
      'delta check',
      ...stepCommands(at(node(['check']), 'steps')),
    ]);
  }

  static async handoff(): Promise<void> {
    await withGitProject(async (dir) => {
      const home = await tempDir();
      try {
        await writeFile(path.join(dir, 'context/harness.yml'), 'checks: {}\n');
        const start = cliOut([
          'docs-delta',
          'start',
          '--name',
          'демо',
          '--root',
          dir,
          '--home',
          home,
        ]);
        expect(start.status).toBe(0);
        expect(start.stdout).toMatch(/docs-delta open/);
        const [id = ''] = (await readdir(path.join(home, 'sessions'))).sort();
        const log = async (): Promise<unknown[]> =>
          (await readFile(path.join(home, 'sessions', id, 'log.jsonl'), 'utf8'))
            .trim()
            .split('\n')
            .map((l): unknown => JSON.parse(l));
        expect((await log()).filter((e) => at(e, 'from') === 'apply')).toEqual([]);
        expect(cli(['docs-delta', 'open', id.slice(0, 7), '--home', home])).toBe(0);
        expect(
          (await log()).some((e) => at(e, 'from') === 'apply' && at(e, 'to') === 'verify'),
        ).toBe(true);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    });
  }

  static async colocated(): Promise<void> {
    const dirs = await harnessDirs();
    expect(dirs.length).toBeGreaterThan(2);
    expect(
      dirs.filter((d) => !existsSync(path.join(repoRoot(), HARNESSES, d, 'harness.yaml'))),
    ).toEqual([]);
    for (const f of ['criteria.yaml', 'prompts'])
      expect({ f, ok: existsSync(path.join(repoRoot(), HARNESSES, 'plan-review', f)) }).toEqual({
        f,
        ok: true,
      });
    expect(existsSync(path.join(repoRoot(), PKG, 'harnesses'))).toBe(false);
    const files = stringList(
      at(parseJson(await readRepo(`${PKG}/package.json`)), 'files'),
      'files',
    );
    expect(files.filter((f) => !['dist', 'README.md', 'CHANGELOG.md'].includes(f))).toEqual([]);
  }

  static async names(): Promise<void> {
    const bad: string[] = [];
    for (const d of await harnessDirs()) {
      if (!HARNESS_NAME.test(d)) bad.push(`${d}: не категория-вид`);
      const text = await readRepo(`${HARNESSES}/${d}/harness.yaml`);
      if (/^harness: (\S+)$/m.exec(text)?.[1] !== d)
        bad.push(`${d}: harness в harness.yaml ≠ имени каталога`);
    }
    expect(bad).toEqual([]);
    expect(existsSync(path.join(repoRoot(), HARNESSES, 'core', 'harness.yaml'))).toBe(false);
  }

  static async shortIds(): Promise<void> {
    await withProcessSession(async ({ home, id, start }) => {
      expect(id).toMatch(/^[0-9a-f]{64}$/);
      expect(start).toContain(id.slice(0, 7));
      expect(start).not.toContain(id);
      const status = (prefix: string, process = 'docs-delta') =>
        cli([process, 'status', prefix, '--home', home]);
      expect(status(id.slice(0, 4))).toBe(0);
      expect(status(id.slice(0, 3))).toBe(2);
      expect(status('zzzz')).toBe(2);
      expect(status(id.slice(0, 7), 'source-sync')).toBe(2);
    });
  }

  static async pauseIsExit(): Promise<void> {
    await withProcessSession(async ({ dir, home, id }) => {
      const data = async (): Promise<unknown> =>
        parseJson(await readFile(path.join(home, 'sessions', id, 'session.json'), 'utf8'));
      expect(at(await data(), 'state')).toBe('apply');
      await writeFile(
        path.join(dir, 'context/conventions/naming.yml'),
        'key: naming\nsummary: snake_case\nrule: x\n',
      );
      const open = () => cli(['docs-delta', 'open', id.slice(0, 7), '--home', home]);
      for (let i = 0; i < 4; i++) expect(open()).toBe(0);
      expect(at(await data(), 'state')).toBe('failed');
      expect(open()).toBe(0);
      expect(at(await data(), 'state')).toBe('apply');
      expect(at(await data(), 'counters', 'verify') ?? 0).toBe(0);
    });
  }

  static async noCallerContext(): Promise<void> {
    const runs = [
      interactiveArgs({
        cwd: '.',
        model: 'opus',
        sessionId: 's',
        name: 'n',
        addDirs: [],
        systemPrompt: '',
        settings: {},
        tools: ['Read'],
        allowedTools: [],
        prompt: '',
      }),
      headlessArgs({
        cwd: '.',
        model: 'opus',
        addDirs: [],
        systemPrompt: '',
        tools: ['Read'],
        allowedTools: [],
        prompt: '',
        persist: false,
        maxTurns: 1,
      }),
    ];
    for (const args of runs) {
      expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
      expect(args).not.toContain('--continue');
    }
    const bad: string[] = [];
    for (const f of (await srcFiles()).filter((f) => layerOf(f) === 'harnesses')) {
      const text = await readRepo(`${PKG}/src/${f}`);
      if (/--continue|process\.env\[['"]CLAUDE/.test(text)) bad.push(f);
    }
    expect(bad).toEqual([]);
  }
}

const PLAN_IMPORTS =
  "import { describe, expect } from 'vitest';\nimport { budget, crit, warn, step, machine, Graph } from '@shahimat/harness/expect';\n";

const DEMO_MACHINE = `const M = machine('demo-flow', {
  initial: 'a',
  limits: { loop: 2 },
  states: {
    a: { actor: 'model', on: { go: 'b', fail: [{ to: 'a', count: 'loop' }, 'c'] } },
    b: { actor: 'user', on: { ok: 'done', back: 'a' } },
    c: { actor: 'script', on: { x: 'done' } },
    done: { final: true },
  },
});
`;

interface PlanRun {
  status: number | null;
  out: string;
  html: string;
}

async function withPlanFixture(
  files: Record<string, string>,
  fn: (dir: string, run: (extra?: string[]) => Promise<PlanRun>) => Promise<void>,
): Promise<void> {
  const base = path.join(repoRoot(), PKG, 'test/.tmp');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'expect-plan-'));
  const put = async (rel: string, text: string) => {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), text, 'utf8');
  };
  try {
    await put('package.json', '{"name":"fixture","private":true,"type":"module"}');
    await put(
      'expectations/vitest.config.ts',
      "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { include: ['expectations/**/*.expect.ts'] } });\n",
    );
    for (const [rel, text] of Object.entries(files)) await put(rel, text);
    cliOut(['expect', 'judge', '--root', dir]);
    const judgePlan = path.join(dir, 'expectations/.judge/plan.json');
    if (existsSync(judgePlan)) {
      for (const item of unknownList(
        at(parseJson(await readFile(judgePlan, 'utf8')), 'lint'),
        'lint',
      ))
        await put(stringAt(item, 'answer'), '{"contradictions": [], "unmeasurable": []}');
      cliOut(['expect', 'judge', '--apply', '--root', dir]);
    }
    const html = path.join(dir, 'report.html');
    await fn(dir, async (extra = []) => {
      await rm(html, { force: true });
      const r = cliOut(['expect', 'report', '--root', dir, '--html', html, ...extra]);
      return {
        status: r.status,
        out: `${r.stdout}\n${r.stderr}`,
        html: existsSync(html) ? await readFile(html, 'utf8') : '',
      };
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const planFile = (body: string): Record<string, string> => ({
  'expectations/plan.expect.ts': `${PLAN_IMPORTS}import { writeFileSync } from 'node:fs';\nimport path from 'node:path';\nbudget({ crit: 0, warn: 0 });\nconst mark = (name: string) => writeFileSync(path.join(import.meta.dirname, '..', name), 'x');\nvoid mark;\n${body}`,
});

function card(html: string, id: string): string {
  const m = new RegExp(`<section[^>]*id="${id}"[^>]*>([\\s\\S]*?)</section>`).exec(html);
  return m?.[1] ?? '';
}

function listItems(html: string): { cls: string; text: string }[] {
  return [...html.matchAll(/<li[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({
    cls: m[1] ?? '',
    text: m[2] ?? '',
  }));
}

const STEPS = (t2: string) => `step('T1', { title: 'Каркас', status: 'done' }, () => {
  crit('T1 проходит', () => expect(1).toBe(1));
});
step('T2', { title: 'Разбор', status: '${t2}', after: ['T1'] }, () => {
  crit('T2 ещё не готов', () => expect(1).toBe(2));
});
step('T3', { title: 'Рендер', status: 'todo', after: ['T2'] }, () => {
  crit('T3 не запускается', () => mark('ran-T3'));
  describe('вложенный раздел T3', () => {
    crit('вложенное в T3 не запускается', () => mark('ran-T3-nested'));
  });
});
step('T4', { title: 'Вложенный active', status: 'active', after: ['T1'] }, () => {
  describe('вложенный раздел T4', () => {
    crit('вложенное в T4 ещё не готово', () => expect(1).toBe(2));
  });
});
`;

function gitCommitAll(dir: string): void {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'v1');
}

class Plan {
  static async stepForm(): Promise<void> {
    await withPlanFixture(planFile(STEPS('active')), async (_dir, run) => {
      const { out, html } = await run();
      for (const [id, title, status] of [
        ['T1', 'Каркас', 'done'],
        ['T2', 'Разбор', 'active'],
        ['T3', 'Рендер', 'todo'],
      ] as const) {
        expect(out).toMatch(new RegExp(`${id}\\. ${title}.*${status}`));
        expect(card(html, `step-${id}`)).toContain(title);
      }
    });
  }

  static async stepStatuses(): Promise<void> {
    await withPlanFixture(planFile(STEPS('active')), async (dir, run) => {
      const active = await run();
      expect({
        status: active.status,
        ran: ['ran-T3', 'ran-T3-nested'].filter((m) => existsSync(path.join(dir, m))),
      }).toEqual({ status: 0, ran: [] });
      expect(active.out).toContain('T2 ещё не готов');
      const file = path.join(dir, 'expectations/plan.expect.ts');
      await writeFile(
        file,
        (await readFile(file, 'utf8')).replace("status: 'active'", "status: 'done'"),
      );
      expect((await run()).status).toBe(1);
    });
  }

  static async stepOrder(): Promise<void> {
    const cases = [
      `step('T1', { title: 'a', status: 'todo' }, () => {});\nstep('T2', { title: 'b', status: 'done', after: ['T1'] }, () => { crit('ok', () => {}); });\n`,
      `step('T1', { title: 'a', status: 'todo', after: ['T2'] }, () => {});\nstep('T2', { title: 'b', status: 'todo', after: ['T1'] }, () => {});\n`,
      `step('T1', { title: 'a', status: 'todo', after: ['T9'] }, () => {});\n`,
    ];
    for (const body of cases)
      await withPlanFixture(planFile(body), async (_dir, run) => {
        const { status, out } = await run();
        expect({ body, status }).toEqual({ body, status: 1 });
        expect(out).toMatch(/T1|T2|T9/);
      });
  }

  static async todoLevels(): Promise<void> {
    const body = `describe('будущее', () => {\n  crit.todo('будущее crit');\n  warn.todo('будущее warn');\n});\n`;
    await withPlanFixture(planFile(body), async (_dir, run) => {
      const { status, out } = await run();
      expect(status).toBe(0);
      expect(out).toMatch(/crit.*будущее crit/);
      expect(out).toMatch(/warn.*будущее warn/);
    });
  }

  static async machineData(): Promise<void> {
    const body = `${DEMO_MACHINE}describe('данные', () => {
  crit('machine возвращает объявление как есть', () => {
    expect(M.name).toBe('demo-flow');
    expect(M.def.initial).toBe('a');
    expect(M.def.limits).toEqual({ loop: 2 });
    expect(Object.keys(M.def.states)).toEqual(['a', 'b', 'c', 'done']);
    expect(M.def.states.a.actor).toBe('model');
    expect(M.def.states.a.on.fail).toEqual([{ to: 'a', count: 'loop' }, 'c']);
  });
});
`;
    await withPlanFixture(planFile(body), async (_dir, run) => {
      const { status, out } = await run();
      expect(status).toBe(0);
      expect(out).toContain('✓ machine возвращает объявление как есть');
    });
  }

  static async machineScopes(): Promise<void> {
    const body = `${DEMO_MACHINE}M.state('a', () => { crit('карточка a', () => {}); });
M.transition('a', 'go', () => { crit('карточка a-go', () => {}); });
M.whole(() => { crit('весь автомат', () => {}); });
`;
    await withPlanFixture(planFile(body), async (_dir, run) => {
      const { html } = await run();
      expect(card(html, 'state-a')).toContain('карточка a');
      expect(card(html, 'tr-a-go')).toContain('карточка a-go');
      expect(card(html, 'machine-demo-flow')).toContain('весь автомат');
      expect(card(html, 'state-b')).not.toContain('карточка a');
    });
  }

  static async machineTypos(): Promise<void> {
    const tsc = path.join(repoRoot(), 'node_modules/typescript/bin/tsc');
    const good = `${PLAN_IMPORTS}${DEMO_MACHINE}M.state('a', () => {});\nM.transition('b', 'back', () => {});\n`;
    const bad = [
      `M.state('zzz', () => {});`,
      `M.transition('a', 'nope', () => {});`,
      `M.transition('c', 'go', () => {});`,
      `const N = machine('n-n', { initial: 'a', states: { a: { actor: 'model', on: { go: 'missing' } } } });\nvoid N;`,
    ];
    const files = {
      'tsconfig.json': JSON.stringify({
        extends: path.join(repoRoot(), 'tsconfig.base.json'),
        compilerOptions: { noUnusedLocals: false },
        include: ['*.ts'],
      }),
      'good.ts': good,
      ...Object.fromEntries(
        bad.map((line, i) => [`bad${i}.ts`, `${PLAN_IMPORTS}${DEMO_MACHINE}${line}\n`]),
      ),
    };
    await withPlanFixture(files, async (dir) => {
      const r = spawnSync(process.execPath, [tsc, '-p', dir], { cwd: dir, encoding: 'utf8' });
      const out = `${r.stdout}${r.stderr}`;
      expect(out).not.toMatch(/good\.ts/);
      for (let i = 0; i < bad.length; i++) expect(out).toMatch(new RegExp(`bad${i}\\.ts`));
    });
  }

  static async graphProbes(): Promise<void> {
    const yaml = (to: string) =>
      `harness: demo-flow\ninitial: a\nlimits:\n  loop: 2\nstates:\n  a:\n    actor: model\n    action: x\n    on:\n      go: b\n      fail:\n        - { to: a, count: loop }\n        - c\n  b:\n    actor: user\n    action: x\n    on:\n      ok: done\n      back: ${to}\n  c:\n    actor: script\n    action: x\n    on:\n      x: done\n  done:\n    final: true\n`;
    const body = `import { parseMachine } from '@shahimat/harness';
${DEMO_MACHINE}const def = (text: string) => {
  const d = parseMachine(text, 'demo').def;
  if (d === undefined) throw new Error('не разобран');
  return d;
};
describe('зонды', () => {
  crit('sameAs: совпадает', () => Graph.sameAs(M, def(${JSON.stringify(yaml('a'))})));
  crit('sameAs: расхождение', () => expect(() => Graph.sameAs(M, def(${JSON.stringify(yaml('c'))}))).toThrow(/b/));
  crit('canReach: done', () => Graph.canReach(M, ['done']));
  crit('canReach: из done нет пути в c', () => expect(() => Graph.canReach(M, ['c'])).toThrow(/done/));
  crit('onlyVia: в b только через a', () => Graph.onlyVia(M, 'b', 'a'));
  crit('onlyVia: в done не только через c', () => expect(() => Graph.onlyVia(M, 'done', 'c')).toThrow());
});
`;
    await withPlanFixture(planFile(body), async (_dir, run) => {
      const { status, out } = await run();
      expect({ status, failed: out.split('\n').filter((l) => l.includes('✗')) }).toEqual({
        status: 0,
        failed: [],
      });
    });
  }

  static async htmlStandalone(): Promise<void> {
    const files = {
      ...planFile(`${DEMO_MACHINE}M.state('a', () => { crit('карточка a', () => {}); });\n`),
      'expectations/other.expect.ts': `${PLAN_IMPORTS}describe('другой файл', () => { crit('чужое ожидание', () => {}); });\n`,
    };
    await withPlanFixture(files, async (_dir, run) => {
      const first = await run(['--file', 'expectations/plan.expect.ts']);
      const second = await run(['--file', 'expectations/plan.expect.ts']);
      expect(first.html).toContain('карточка a');
      expect(first.html).not.toContain('чужое ожидание');
      expect(first.html).not.toMatch(/<script|<link[^>]+href=|(src|href)="https?:/i);
      expect(second.html).toBe(first.html);
    });
  }

  static async htmlGraphs(): Promise<void> {
    const body = `${DEMO_MACHINE}${STEPS('active')}M.transition('a', 'go', () => { crit('переход', () => {}); });\n`;
    await withPlanFixture(planFile(body), async (_dir, run) => {
      const { html } = await run();
      const svgs = [...html.matchAll(/<svg[\s\S]*?<\/svg>/g)].map((m) => m[0]);
      expect(html).toMatch(/Generated by graphviz/i);
      expect(svgs.some((s) => /href="#state-a"/.test(s) && /href="#tr-a-go"/.test(s))).toBe(true);
      expect(svgs.some((s) => /href="#step-T1"/.test(s) && /href="#step-T3"/.test(s))).toBe(true);
    });
  }

  static async htmlStatuses(): Promise<void> {
    const body = `${DEMO_MACHINE}M.state('a', () => { crit('a проходит', () => {}); });
M.state('b', () => { crit('b падает', () => expect(1).toBe(2)); });
M.state('c', () => { crit.todo('c впереди'); });
`;
    await withPlanFixture(planFile(body), async (_dir, run) => {
      const { html } = await run();
      const node = (name: string) =>
        new RegExp(`<g[^>]*class="node[^"]*"[^>]*>\\s*<title>${name}</title>`).exec(html)?.[0] ??
        '';
      expect(node('a')).toMatch(/pass/);
      expect(node('b')).toMatch(/fail/);
      expect(node('c')).toMatch(/todo/);
    });
  }

  static async htmlDiff(): Promise<void> {
    const v1 = `describe('X', () => {\n  crit('старое один', () => {});\n  crit('остаётся', () => {});\n});\ndescribe('Z', () => {\n  crit('уходит', () => {});\n});\n`;
    const v2 = `describe('X', () => {\n  crit('новое один', () => {});\n  crit('остаётся', () => {});\n});\ndescribe('W', () => {\n  crit('совсем новое', () => {});\n});\n`;
    await withPlanFixture(planFile(v1), async (dir, run) => {
      gitCommitAll(dir);
      await writeFile(
        path.join(dir, 'expectations/plan.expect.ts'),
        planFile(v2)['expectations/plan.expect.ts'] ?? '',
      );
      const list = listItems((await run()).html);
      const find = (text: string) => list.find((i) => i.text.includes(text));
      expect(find('совсем новое')?.cls).toMatch(/diff-added/);
      expect(find('уходит')?.cls).toMatch(/diff-removed/);
      expect(find('новое один')?.cls).toMatch(/diff-changed/);
      expect(find('новое один')?.text).toContain('старое один');
      expect(find('остаётся')?.cls).not.toMatch(/diff-/);
    });
  }
}
