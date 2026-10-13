import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { computeSync, DEFAULT_CHANGELOG, parseConfig, runOutdated, UsageError } from '@shahimat/harness';
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

describe('harness — основа', () => {
  crit('в репозитории нет bash-скриптов: вся автоматизация на TS и Node ≥ 24', () => Check.noBash());
  crit('CI прогоняет harness на ubuntu, macos и windows', () => Check.ciMatrix());
  crit('TypeScript в режиме strict: strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes', () => Check.tsStrict());
  crit('у каждой команды CLI из справки есть юнит-тест', () => Check.commandsTested());
  crit('коды выхода CLI: 0 — ok, 1 — нарушения, 2 — ошибка вызова или конфигурации', () => Check.exitCodes());
  crit('неизвестный ключ в context/harness.yml — ошибка конфига, а не молча выключенная проверка', () => Check.strictConfig());
});

describe('ожидания (expect)', () => {
  crit('смысловая проверка заголовков файла запускается только при изменении его заголовков', () => Check.lintOnTitleChange());
  crit('судья вызывается только для вердиктов, у которых изменились заголовок или доказательства', () => Check.judgeOnlyStale());
  crit('пакет судьи — не больше 25 вопросов и 80 KB доказательств', () => Check.batchLimits());
  crit('ответ судьи без дословной цитаты из доказательства отклоняется', () => Check.quoteRequired());
  crit('в кэше вердиктов только вердикты живых ожиданий', () => Check.cachePruned());
  crit('CI проверяет ожидания без вызова LLM', () => Check.ciWithoutLlm());
  crit('файлы ожиданий ссылаются на доказательства только якорями @KEY, без путей', () => Check.anchorsOnly());
  crit('ожидание — не длиннее 200 символов', () => Check.titleLimit());
});

describe('генерация', () => {
  crit('adapters sync не меняет и не удаляет файлы без метки harness', () => Check.adaptersSafe());
  warn('context/index.yml генерируется harness context index и не содержит даты генерации', () => Check.contextIndexNoDate());
  warn('adapters sync выключает memory: autoMemoryEnabled false в Claude Code, memories false в Codex', () => Check.memoryOff());
  crit('у skill в индексе sha256 каждого файла', () => Check.skillFileShas());
});

describe('журнал и версии', () => {
  crit('строка журнала — не длиннее 120 символов', () => Check.changelogLine());
  crit('теги ядра — ровно arch, stack, dep, milestone', () => Check.coreTags());
  crit('harness outdated сообщает текущую и последнюю версию и записи журнала между ними', () => Check.outdatedReport());
});

// ─────────────────────────────── проверки ───────────────────────────────

const PKG = 'harness/packages/harness';
const BIN = () => path.join(repoRoot(), PKG, 'dist/bin.js');
const cli = (args: string[], cwd = repoRoot()) =>
  spawnSync(process.execPath, [BIN(), ...args], { cwd, encoding: 'utf8' }).status;

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'harness-expect-'));
}

class Check {
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
    const usage = (await readRepo(`${PKG}/src/cli.ts`)).split('`')[1] ?? '';
    const commands = [...usage.matchAll(/^\s+harness ([a-z]+)(?: ([a-z|]+(?: \| [a-z]+)*))?/gm)].flatMap((m) =>
      (m[2] ?? '').split(/\s*\|\s*/).filter(Boolean).map((c) => `${m[1]} ${c}`).concat(m[2] ? [] : [m[1] ?? '']),
    );
    const tests = (
      await Promise.all(
        (await readdir(path.join(repoRoot(), PKG, 'test'))).filter((f) => f.endsWith('.test.ts')).map((f) => readRepo(`${PKG}/test/${f}`)),
      )
    ).join('\n');
    const untested = commands.filter((c) => {
      const [group, sub] = c.split(' ');
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
      .concat('harness/packages/expectations/src/ticket-commits.ts');
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
