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
  DELTA_SCHEMA,
  DEFAULT_CHANGELOG,
  KNOWN_ADAPTERS,
  KNOWN_CHECKS,
  parseConfig,
  renderUsage,
  runOutdated,
  UsageError,
} from '@shahimat/harness';
import {
  applyAnswers,
  budget,
  crit,
  DEFAULT_LIMITS,
  indexEntries,
  judged,
  MAX_TITLE,
  readRepo,
  repoRoot,
  warn,
} from '@shahimat/harness/expect';

budget({ crit: 0, warn: 0 });

describe('[harness] common', () => {
  crit(
    'процессы harness: check, changelog, context, adapters, delta, outdated, expect, index; plan_iter — в разработке: его команд нет в CLI, ожидания — только todo',
    () => Check.processes(),
  );
  crit('пакеты: @shahimat/harness — CLI и механизм ожиданий, @shahimat/expectations — наборы ожиданий; других нет', () => Check.packages());
  crit('других команд, кроме перечисленных в разделах [harness] <процесс>, у harness нет', () => Check.noOtherCommands());
  crit('в репозитории нет bash-скриптов: вся автоматизация на TS и Node ≥ 24', () => Check.noBash());
  crit('CI прогоняет harness на ubuntu, macos и windows', () => Check.ciMatrix());
  crit('TypeScript в режиме strict: strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes', () => Check.tsStrict());
  crit('у каждой команды CLI из справки есть юнит-тест', () => Check.commandsTested());
  crit('коды выхода CLI: 0 — ok, 1 — нарушения, 2 — ошибка вызова или конфигурации', () => Check.exitCodes());
  crit('неизвестный ключ в context/harness.yml — ошибка конфига, а не молча выключенная проверка', () => Check.strictConfig());
  crit('справка CLI строится из декларативного дерева команд', () => Check.commandTree());
  crit('ошибка конфига называет путь до поля', () => Check.configErrorPath());
  crit('слои пакета зависят в одну сторону: cli → commands → ядро', () => Check.layers());
  crit('проверки ничего не пишут в проект: файлы пишут только генерация (adapters sync, context index, index build, expect init | judge, delta close) и session clone из plan_iter', () => Check.checksReadOnly());
  warn('итог прогона считает код по бюджету и ответам модели, а не модель', () => Check.verdictByCode());
  crit('ответ модели вне схемы отклоняется', () => Check.answerSchema());
  warn('задание проверяющей модели содержит только вопросы и доказательства, без контекста автора', () => Check.cleanContext());
  crit('уровни замечаний общие для ожиданий и критериев плана: crit, warn, info', () => Check.sharedLevels());
  it.todo('дополнения проекта и пользователя подключаются из конфига динамическим import, без форка пакета');
});

describe('[harness] check', () => {
  crit('команда harness check — все проверки из context/harness.yml разом', () => Check.commands(['check']));
  crit('проверки harness check: changelog, context-index, adapters — других нет', () => Check.checks());
});

describe('[harness] changelog', () => {
  crit('команда harness changelog lint — формат CHANGELOG.md', () => Check.commands(['changelog lint']));
  crit('строка журнала — не длиннее 120 символов', () => Check.changelogLine());
  crit('теги ядра — ровно arch, stack, dep, milestone', () => Check.coreTags());
});

describe('[harness] context', () => {
  crit('команда harness context index — генерация context/index.yml из слоёв документации', () => Check.commands(['context index']));
  warn('context/index.yml генерируется harness context index и не содержит даты генерации', () => Check.contextIndexNoDate());
});

describe('[harness] adapters', () => {
  crit('команда harness adapters sync — файлы под Claude Code и Codex из AGENTS.md и .agents/', () => Check.commands(['adapters sync']));
  crit('адаптеры под инструменты: claude-code и codex — других нет', () => Check.adapters());
  crit('adapters sync не меняет и не удаляет файлы без метки harness', () => Check.adaptersSafe());
  warn('adapters sync выключает memory: autoMemoryEnabled false в Claude Code, memories false в Codex', () => Check.memoryOff());
});

describe('[harness] outdated', () => {
  crit('команда harness outdated — версия проекта против npm и журнал изменений между ними', () => Check.commands(['outdated']));
  crit('harness outdated сообщает текущую и последнюю версию и записи журнала между ними', () => Check.outdatedReport());
});

describe('[harness] expect', () => {
  crit('команды harness expect init | report | lint | judge — ожидания проекта', () =>
    Check.commands(['expect init', 'expect report', 'expect lint', 'expect judge']));
  crit('смысловая проверка заголовков файла запускается только при изменении его заголовков', () => Check.lintOnTitleChange());
  crit('судья вызывается только для вердиктов, у которых изменились заголовок или доказательства', () => Check.judgeOnlyStale());
  crit('пакет судьи — не больше 25 вопросов и 80 KB доказательств', () => Check.batchLimits());
  crit('ответ судьи без дословной цитаты из доказательства отклоняется', () => Check.quoteRequired());
  crit('в кэше вердиктов только вердикты живых ожиданий', () => Check.cachePruned());
  crit('CI проверяет ожидания без вызова LLM', () => Check.ciWithoutLlm());
  crit('файлы ожиданий ссылаются на доказательства только якорями @KEY, без путей', () => Check.anchorsOnly());
  crit('ожидание — не длиннее 200 символов', () => Check.titleLimit());
});

describe('[harness] delta', () => {
  crit('команды harness delta check | close — дельта проектной документации в context/.delta/', () =>
    Check.commands(['delta check', 'delta close']));
  crit('delta check: удалённая или изменённая относительно HEAD сущность слоёв документации без пункта revise — нарушение', () =>
    Check.deltaCheck());
  crit('delta close удаляет дельту только при чистом delta check и выполненных пунктах', () => Check.deltaClose());
  crit('context index не включает context/.delta/', () => Check.deltaNotIndexed());
  crit('схема дельты в пакете совпадает с expectations/schemas/docs-delta.schema.json', () => Check.deltaSchema());
});

describe('[harness] index', () => {
  crit('команды harness index build | check — индекс prompts/index.yml источника промптов', () =>
    Check.commands(['index build', 'index check']));
  crit('у skill в индексе sha256 каждого файла', () => Check.skillFileShas());
});

// ─────────────────────────────── проверки ───────────────────────────────

const PKG = 'harness/packages/harness';
const SCHEMAS = 'expectations/schemas';
const BIN = () => path.join(repoRoot(), PKG, 'dist/bin.js');
const cli = (args: string[], cwd = repoRoot()) =>
  spawnSync(process.execPath, [BIN(), ...args], { cwd, encoding: 'utf8' }).status;

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'harness-expect-'));
}

/** Содержимое всех файлов каталога: путь → текст. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const files = (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile());
  return Object.fromEntries(
    await Promise.all(
      files.map(async (e) => {
        const file = path.join(e.parentPath, e.name);
        return [path.relative(dir, file), await readFile(file, 'utf8')] as const;
      }),
    ),
  );
}

const REVISE_NAMING =
  'summary: s\nitems:\n  - op: revise\n    kind: rule\n    target: naming\n    summary: snake_case\n    evidence: e\n    was: kebab-case\n    why: w\n';

/** Временный git-проект с одной convention и пустой context/.delta/. */
async function withGitProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await tempDir();
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    await mkdir(path.join(dir, 'context/conventions'), { recursive: true });
    await mkdir(path.join(dir, 'context/.delta'), { recursive: true });
    await mkdir(path.join(dir, 'context/modules'), { recursive: true });
    await writeFile(path.join(dir, 'context/project.yml'), 'name: demo\nnamespaces:\n  core: ядро\n');
    await writeFile(path.join(dir, 'context/conventions/naming.yml'), 'key: naming\nsummary: kebab-case\nrule: x\n');
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init', '--allow-empty');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'docs');
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Слой файла пакета: 0 — cli, 1 — commands, 2 — ядро. */
const layerOf = (file: string): number => (file === 'cli.ts' || file === 'bin.ts' ? 0 : file.startsWith('commands/') ? 1 : 2);

/** Команды из дерева CLI: `check`, `adapters sync`, `expect init`, … */
async function usageCommands(): Promise<string[]> {
  return COMMANDS.map((c) => c.path.join(' '));
}

const DECLARED_COMMANDS = [
  'check',
  'changelog lint',
  'context index',
  'adapters sync',
  'expect init',
  'expect report',
  'expect lint',
  'expect judge',
  'delta check',
  'delta close',
  'outdated',
  'index build',
  'index check',
];

class Check {
  // состав
  static async packages(): Promise<void> {
    const dirs = (await readdir(path.join(repoRoot(), 'harness/packages'))).sort();
    const names = await Promise.all(dirs.map(async (d) => (JSON.parse(await readRepo(`harness/packages/${d}/package.json`)) as { name: string }).name));
    expect(names.sort()).toEqual(['@shahimat/expectations', '@shahimat/harness']);
  }

  static async commands(list: string[]): Promise<void> {
    const usage = await usageCommands();
    expect(list.filter((c) => !usage.includes(c))).toEqual([]);
  }

  static async processes(): Promise<void> {
    expect([...new Set(COMMANDS.map((c) => c.path[0] ?? ''))].sort()).toEqual(
      ['adapters', 'changelog', 'check', 'context', 'delta', 'expect', 'index', 'outdated'],
    );
    const planIter = await readRepo('expectations/harness-plan-iter.expect.ts');
    expect(planIter).toContain("describe('[harness] plan_iter'");
    expect(planIter).not.toMatch(/\b(crit|warn)\(/);
  }

  static async noOtherCommands(): Promise<void> {
    expect((await usageCommands()).filter((c) => !DECLARED_COMMANDS.includes(c))).toEqual([]);
  }

  static checks(): void {
    expect([...KNOWN_CHECKS].sort()).toEqual(['adapters', 'changelog', 'context-index']);
  }

  static adapters(): void {
    expect([...KNOWN_ADAPTERS].sort()).toEqual(['claude-code', 'codex']);
  }

  // основа
  static async noBash(): Promise<void> {
    const pkg = JSON.parse(await readRepo(`${PKG}/package.json`)) as { engines: { node: string } };
    expect(pkg.engines.node).toBe('>=24');
    expect(await readRepo('.gitattributes')).toContain('eol=lf');
    const out = spawnSync('git', ['ls-files', '*.sh'], { cwd: repoRoot(), encoding: 'utf8' }).stdout.trim();
    expect(out).toBe('');
  }

  static async ciMatrix(): Promise<void> {
    expect(await readRepo('.github/workflows/check-index.yml')).toMatch(/os: \[ubuntu-latest, macos-latest, windows-latest\]/);
  }

  static async tsStrict(): Promise<void> {
    for (const pkg of ['harness', 'expectations']) {
      const opts = (JSON.parse(await readRepo(`harness/packages/${pkg}/tsconfig.json`)) as { compilerOptions: Record<string, unknown> })
        .compilerOptions;
      expect({ pkg, strict: opts['strict'], nui: opts['noUncheckedIndexedAccess'], eopt: opts['exactOptionalPropertyTypes'] }).toEqual({
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
        (await readdir(path.join(repoRoot(), PKG, 'test'))).filter((f) => f.endsWith('.test.ts')).map((f) => readRepo(`${PKG}/test/${f}`)),
      )
    ).join('\n');
    const untested = commands.filter((c) => {
      const [group = '', sub] = c.split(' ');
      return sub === undefined
        ? !new RegExp(`\\['${group}'|run${group[0]?.toUpperCase()}${group.slice(1)}\\(`).test(tests)
        : !tests.includes(`'${group}', '${sub}'`);
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
    expect(COMMANDS.map((c) => c.path.join(' ')).filter((c) => !usage.includes(`harness ${c}`))).toEqual([]);
    expect(await readRepo(`${PKG}/src/cli.ts`)).not.toMatch(/switch \(|Использование:/);
  }

  static configErrorPath(): void {
    expect(() => parseConfig('checks:\n  changelog:\n    max_line: x\n')).toThrow('checks.changelog.max_line');
    expect(() => parseConfig('checks:\n  changelog:\n    bogus: 1\n')).toThrow('checks.changelog');
  }

  static async layers(): Promise<void> {
    const src = path.join(repoRoot(), PKG, 'src');
    // index.ts — фасад пакета: экспортирует все слои.
    const files = (await readdir(src, { recursive: true }))
      .map((f) => f.split(path.sep).join('/'))
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts');
    const upward: string[] = [];
    for (const file of files) {
      for (const m of (await readRepo(`${PKG}/src/${file}`)).matchAll(/from '(\.[^']+)'/g)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1] ?? ''));
        if (layerOf(target) < layerOf(file)) upward.push(`${file} → ${target}`);
      }
    }
    expect(files.length).toBeGreaterThan(10);
    expect(upward).toEqual([]);
  }

  static async checksReadOnly(): Promise<void> {
    const dir = await tempDir();
    try {
      await writeFile(path.join(dir, 'AGENTS.md'), '# x\n');
      await writeFile(path.join(dir, 'CHANGELOG.md'), '- 2026-10-14 · без тега · b\n');
      await mkdir(path.join(dir, 'context'));
      await writeFile(
        path.join(dir, 'context/harness.yml'),
        'adapters: [claude-code, codex]\nchecks:\n  changelog: {}\n  context-index: {}\n  adapters: {}\n',
      );
      const before = await snapshot(dir);
      expect(cli(['check', '--root', dir])).toBe(1);
      expect(cli(['changelog', 'lint', '--root', dir])).toBe(1);
      expect(await snapshot(dir)).toEqual(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // модели
  static verdictByCode = (): Promise<void> => judged(['@verdict-by-code']);

  static answerSchema(): void {
    const item = { id: 'a', question: 'q', evidence: [{ ref: 'x', sha: 's', bytes: 1 }] };
    const texts = new Map([['x', 'текст доказательства про memory']]);
    const notArray = applyAnswers([item], { id: 'a' }, texts, new Date());
    const notBool = applyAnswers([item], [{ id: 'a', verdict: 'да', ref: 'x', quote: 'доказательства про memory' }], texts, new Date());
    expect(Object.keys({ ...notArray.accepted, ...notBool.accepted })).toEqual([]);
    expect([...notArray.rejected, ...notBool.rejected].map((r) => r.id)).toEqual(['*', 'a']);
  }

  static cleanContext = (): Promise<void> => judged(['@judge-clean-context']);

  static async sharedLevels(): Promise<void> {
    const schema = JSON.parse(await readRepo(`${SCHEMAS}/plan-criteria.schema.json`)) as {
      properties: { criteria: { items: { properties: { level: { enum: string[] } } } } };
    };
    expect(schema.properties.criteria.items.properties.level.enum).toEqual(['crit', 'warn', 'info']);
  }

  // ожидания
  static lintOnTitleChange = (): Promise<void> => judged(['@expect-cycles']);
  static judgeOnlyStale = (): Promise<void> => judged(['@expect-cycles']);

  static batchLimits(): void {
    expect(DEFAULT_LIMITS).toEqual({ maxItems: 25, maxBytes: 80_000 });
  }

  static quoteRequired(): void {
    const item = { id: 'a', question: 'q', evidence: [{ ref: 'x', sha: 's', bytes: 1 }] };
    const texts = new Map([['x', 'текст доказательства про memory']]);
    const ok = applyAnswers([item], [{ id: 'a', verdict: true, ref: 'x', quote: 'доказательства про memory' }], texts, new Date());
    const bad = applyAnswers([item], [{ id: 'a', verdict: true, ref: 'x', quote: 'придуманная цитата судьи' }], texts, new Date());
    expect(Object.keys(ok.accepted)).toEqual(['a']);
    expect(bad.rejected.map((r) => r.id)).toEqual(['a']);
  }

  static cachePruned = (): Promise<void> => judged(['@verdict-prune']);

  static async ciWithoutLlm(): Promise<void> {
    const ci = await readRepo('.github/workflows/check-index.yml');
    expect(ci).toContain('run: npm run expect');
    expect(ci).not.toMatch(/secrets\.|ANTHROPIC|OPENAI|expect:judge/);
  }

  static async anchorsOnly(): Promise<void> {
    const files = (await readdir(path.join(repoRoot(), 'expectations'), { recursive: true }))
      .filter((f) => f.endsWith('.expect.ts'))
      .map((f) => `expectations/${f.split(path.sep).join('/')}`)
      .concat('harness/packages/expectations/src/ticket-commits.ts', 'harness/packages/expectations/src/attention.ts');
    const paths: string[] = [];
    for (const f of files) {
      for (const m of (await readRepo(f)).matchAll(/judged\(\[([^\]]*)\]\)/g)) {
        for (const ref of (m[1] ?? '').matchAll(/'([^']*)'/g)) if (!(ref[1] ?? '').startsWith('@')) paths.push(`${f}: ${ref[1]}`);
      }
    }
    expect(paths).toEqual([]);
  }

  static titleLimit(): void {
    expect(MAX_TITLE).toBe(200);
  }

  // генерация
  static async adaptersSafe(): Promise<void> {
    const dir = await tempDir();
    try {
      await writeFile(path.join(dir, 'AGENTS.md'), '# x\n');
      await writeFile(path.join(dir, 'CLAUDE.md'), 'ручной CLAUDE.md\n');
      await mkdir(path.join(dir, '.claude/agents'), { recursive: true });
      await writeFile(path.join(dir, '.claude/agents/mine.md'), '---\nname: mine\n---\nсвой\n');
      const { actions, diagnostics } = await computeSync(dir, ['claude-code']);
      expect(actions.filter((a) => a.path === 'CLAUDE.md' || a.path === '.claude/agents/mine.md')).toEqual([]);
      expect(diagnostics.some((d) => d.file === 'CLAUDE.md')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  static contextIndexNoDate = (): Promise<void> => judged(['@context-index-no-date']);
  static memoryOff = (): Promise<void> => judged(['@memory-off']);

  static async skillFileShas(): Promise<void> {
    const bad = (await indexEntries()).filter(
      (e) => e.kind === 'skill' && !((e.files?.length ?? 0) > 0 && (e.files ?? []).every((f) => /^[0-9a-f]{64}$/.test(f.sha256))),
    );
    expect(bad.map((e) => e.key)).toEqual([]);
  }

  // delta
  static async deltaCheck(): Promise<void> {
    await withGitProject(async (dir) => {
      await writeFile(path.join(dir, 'context/conventions/naming.yml'), 'key: naming\nsummary: snake_case\nrule: x\n');
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
      await writeFile(path.join(dir, 'context/conventions/naming.yml'), 'key: naming\nsummary: snake_case\nrule: x\n');
      expect(cli(['delta', 'close', '--root', dir])).toBe(0);
      expect(existsSync(delta)).toBe(false);
    });
  }

  static async deltaNotIndexed(): Promise<void> {
    await withGitProject(async (dir) => {
      await writeFile(path.join(dir, 'context/modules/m.yml'), 'provides:\n  index_layers:\n    - { section: drafts, dir: context, format: yml }\n');
      await writeFile(path.join(dir, 'context/.delta/leak.yml'), 'id: leak\nnamespace: core\nsummary: утечка\n');
      expect((await buildContextIndex(dir)).text).not.toContain('leak');
    });
  }

  static async deltaSchema(): Promise<void> {
    expect(DELTA_SCHEMA).toEqual(JSON.parse(await readRepo(`${SCHEMAS}/docs-delta.schema.json`)));
  }

  // журнал и версии
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
        text: async () => (url.includes('registry') ? JSON.stringify({ 'dist-tags': { latest: '0.3.0' } }) : changelog),
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
