import { describe, expect } from 'vitest';
import { DEFAULT_CHANGELOG } from '@shahimat/harness';
import {
  budget,
  codeBlock,
  crit,
  expectAtMost,
  contract,
  dataFiles,
  doc,
  expectSchema,
  frontmatters,
  indexEntries,
  judged,
  module,
  modules,
  presets,
  readRepo,
  skill,
  skills,
  warn,
} from '@shahimat/harness/expect';
import { ticketCommits } from '@shahimat/expectations';
import { parse } from 'yaml';
import { anyContract } from './shared/any-contract.expect.ts';

budget({ crit: 0, warn: 5 });

anyContract('agent-operational-contract-v3');

describe('AGENTS.md', () => {
  crit('шаблон AGENTS.md в ядре — не больше 80 строк', () => Check.templateLength());
  crit('в любом пресете собранный AGENTS.md — не больше 150 строк и 8192 байт', () => Check.presetBudget());
  crit('жёстких правил — не больше 7, каждое не длиннее 200 символов', () => Check.hardRules());
  crit('маршрут «как сейчас устроено» ведёт на reality из context/project.yml', () => Check.realityRoute());
  crit('строки блоков модулей обязательны наравне с жёсткими правилами ядра', () => Check.moduleRulesBinding());
  warn('CLAUDE.md для Claude Code — импорт @AGENTS.md, генерирует harness adapters sync', () => Check.claudeMd());
});

describe('возможности и пресеты', () => {
  crit('у каждого модуля v3 есть feature с summary и default', () => Check.featureBlock());
  crit('у каждого модуля v3 есть блок AGENTS.md между маркерами module:<key>', () => Check.moduleBlocks());
  crit('блок модуля — не больше 5 строк, у модулей с guardrail-dual-level — до 8', () => Check.moduleBlockSize());
  crit('каждый skill из provides.skills модулей есть в skills/', () => Check.providedSkillsExist());
  crit('есть пресеты personal, analytical и external', () => Check.presetKeys());
  crit('каждый ответ пресета — существующий вариант вопроса модуля', () => Check.presetAnswers());
  crit('пресет включает все модули, которые требуют его модули', () => Check.presetRequires());
  warn('contract-setup первым вопросом предлагает пресет или ручной выбор', () => Check.presetFirst());
  warn('без инструмента multi-select чеклист — нумерованный список, ответ номерами через запятую', () => Check.checklistFallback());
  warn('модуль добавляет поля в чужие слои только через provides.extends', () => Check.extendsOnly());
});

describe('форматы по схемам', () => {
  crit('каждый пресет соответствует схеме preset', () => Check.presetSchema());
  crit('frontmatter каждого модуля соответствует схеме module-frontmatter', () => Check.moduleSchema());
  crit('frontmatter каждого SKILL.md соответствует схеме skill-frontmatter', () => Check.skillSchema());
  crit('provides каждого модуля соответствует схеме provides', () => Check.providesSchema());
  crit('шаблон manifest в skill contract-setup соответствует схеме manifest', () => Check.manifestSchema());
  crit('примеры context/harness.yml в skill harness и README пакета соответствуют схеме', () => Check.harnessConfigSchema());
});

describe('skills и субагенты', () => {
  crit('SKILL.md — не больше 300 строк', () => Check.skillLength());
  crit('skills ядра — contract-setup, workflow, docs-keeper, source-sync — есть в индексе', () => Check.coreSkills());
  crit('субагент docs-keeper предзагружает skill docs-keeper', () => Check.docsKeeperPreload());
});

describe('документация проекта', () => {
  crit('в основной сессии файлы проектной документации только читаются; правки — только через docs-keeper', () => Check.docsReadonly());
  crit('при подключённом harness генерируемые файлы (context/index.yml, адаптеры под инструменты) меняет только harness, не агент и не docs-keeper', () =>
    Check.generatedByHarness());
  warn('docs-keeper меняет только слои документации проекта и не трогает код', () => Check.docsKeeperScope());
  warn('правила контракта не копируются в context/conventions', () => Check.noRuleCopies());
});

describe('memory', () => {
  crit('memory агента запрещена правилом в шаблоне AGENTS.md', () => Check.memoryRule());
  warn('adapters sync выключает memory: autoMemoryEnabled false в Claude Code, memories false в Codex', () => Check.memoryOff());
});

describe('журнал решений', () => {
  crit('строка журнала — не длиннее 120 символов', () => Check.changelogLine());
  crit('теги ядра — ровно arch, stack, dep, milestone', () => Check.coreTags());
  crit('журнал один: ни один модуль не ставит свой CHANGELOG-файл', () => Check.singleChangelog());
  warn('свой тег журнала модуль добавляет только через provides.changelog_tags', () => Check.moduleTags());
  crit('CHANGELOG.md сливается через merge=union в .gitattributes ядра', () => Check.mergeUnion());
});

ticketCommits('ticket-commits');

describe('harness и источник', () => {
  crit('в репозитории нет bash-скриптов: вся автоматизация на TS и Node ≥ 24', () => Check.noBash());
  crit('CI прогоняет harness на ubuntu, macos и windows', () => Check.ciMatrix());
  crit('у skill в индексе sha256 каждого файла', () => Check.skillFileShas());
  warn('context/index.yml генерируется harness context index и не содержит даты генерации', () => Check.contextIndexNoDate());
  warn('источники скачиваются только curl, WebFetch запрещён', () => Check.curlOnly());
  warn('«сверь всё» предупреждает о deprecated-контракте и называет замену', () => Check.syncWarnsDeprecated());
});

describe('приоритетные правила модулей', () => {
  crit('safety-boundaries: при признаке из списка red-flag агент прекращает сценарий и даёт контакт помощи', () => Check.safetyRule());
  crit('в skill safety-boundaries список red-flag категорий непустой', () => Check.redFlagsListed());
  warn('правило целостности атрибуции записано в блоке analysis для AGENTS.md', () => Check.attributionRule());
  crit('privacy: в документации, коммитах и журнале нет реальных персональных данных', () => Check.privacyRule());
});

describe('ядро', () => {
  warn('ядро ставится одной ссылкой на контракт, остальное агент берёт по индексу', () => Check.singleLink());
  crit('skill domain: verified: true ставится только вместе с verified_at (дата) и verified_note (чем проверено)', () =>
    Check.verifiedRule());
});

// ─────────────────────────────── проверки ───────────────────────────────
// Ниже — как проверяется каждое ожидание. Для чтения ожиданий не нужно.

const KEY = 'agent-operational-contract-v3';
const SCHEMAS = 'expectations/schemas';

const template = async (): Promise<string> => (await contract(KEY)).agentsMdTemplate ?? '';
const v3Modules = async (): Promise<Awaited<ReturnType<typeof modules>>> =>
  (await modules()).filter((m) => ((m.frontmatter?.['applicable_to'] ?? []) as string[]).includes(KEY));
const feature = async (key: string): Promise<Record<string, unknown>> =>
  ((await module(key)).frontmatter?.['feature'] ?? {}) as Record<string, unknown>;
const pathsOf = async (kind: string): Promise<string[]> =>
  (await indexEntries()).filter((e) => e.kind === kind).map((e) => (kind === 'skill' ? `${e.path}/SKILL.md` : e.path));

/** Утверждение по списку: все элементы проходят `ok`, иначе — список провалившихся. */
function expectAll<T>(items: T[], name: (x: T) => string, ok: (x: T) => boolean): void {
  expect(items.filter((x) => !ok(x)).map(name)).toEqual([]);
}

class Check {
  // AGENTS.md
  static async templateLength(): Promise<void> {
    expectAtMost((await template()).split('\n').length, 80, 'строк в шаблоне AGENTS.md');
  }

  static async presetBudget(): Promise<void> {
    for (const p of await presets()) {
      const md = await p.agentsMd();
      expectAtMost(md.lines, 150, `${p.key}: строк в AGENTS.md`);
      expectAtMost(md.bytes, 8192, `${p.key}: байт в AGENTS.md`);
    }
  }

  static async hardRules(): Promise<void> {
    const tpl = await template();
    const block = tpl.slice(tpl.indexOf('## Жёсткие правила'), tpl.indexOf('## Сценарии'));
    const rules = block
      .split(/\n(?=\d+\. )/)
      .slice(1)
      .map((r) => r.split('\n\n')[0]?.replace(/^\d+\. /, '').replace(/\s+/g, ' ').trim() ?? '');
    expectAtMost(rules.length, 7, 'жёстких правил');
    for (const [i, r] of rules.entries()) expectAtMost([...r].length, 200, `символов в правиле ${i + 1}`);
  }

  static async realityRoute(): Promise<void> {
    expect(await template()).toMatch(/как сейчас устроено X → источник реальности[\s\S]{0,40}reality/);
  }

  static async moduleRulesBinding(): Promise<void> {
    expect(await template()).toContain('обязательны наравне');
  }

  static claudeMd = (): Promise<void> => judged(['@claude-md-import']);

  // возможности и пресеты
  static async featureBlock(): Promise<void> {
    const ms = await v3Modules();
    expectAll(ms, (m) => m.key, (m) => {
      const f = (m.frontmatter?.['feature'] ?? {}) as Record<string, unknown>;
      return typeof f['summary'] === 'string' && typeof f['default'] === 'boolean';
    });
  }

  static async moduleBlocks(): Promise<void> {
    expectAll(await v3Modules(), (m) => m.key, (m) => m.agentsMdBlock !== null);
  }

  static async moduleBlockSize(): Promise<void> {
    expectAll(await v3Modules(), (m) => m.key, (m) => {
      const lines = (m.agentsMdBlock ?? '').split('\n').filter((l) => l.trim() !== '' && !l.startsWith('<!--')).length;
      const guardrail = ((m.frontmatter?.['patterns'] ?? []) as string[]).includes('guardrail-dual-level');
      return lines <= (guardrail ? 8 : 5);
    });
  }

  static async providedSkillsExist(): Promise<void> {
    const known = (await skills()).map((s) => s.name);
    const provided = (await v3Modules()).flatMap((m) => (m.provides?.['skills'] ?? []) as string[]);
    expectAll(provided, (s) => s, (s) => known.includes(s));
  }

  static async presetKeys(): Promise<void> {
    expect((await presets()).map((p) => p.key).sort()).toEqual(['analytical', 'external', 'personal']);
  }

  static async presetAnswers(): Promise<void> {
    const answers: { name: string; ok: boolean }[] = [];
    for (const p of await presets()) {
      for (const pm of p.modules) {
        const asks = ((await feature(pm.key))['asks'] ?? []) as { key: string; options: unknown[] }[];
        for (const [k, v] of Object.entries(pm.answers)) {
          const options = asks.find((a) => a.key === k)?.options.map(String) ?? [];
          for (const x of Array.isArray(v) ? v : [v]) answers.push({ name: `${p.key}/${pm.key}/${k}=${String(x)}`, ok: options.includes(String(x)) });
        }
      }
    }
    expectAll(answers, (a) => a.name, (a) => a.ok);
  }

  static async presetRequires(): Promise<void> {
    const pairs: { name: string; ok: boolean }[] = [];
    for (const p of await presets()) {
      const keys = p.modules.map((m) => m.key);
      for (const k of keys) {
        for (const r of ((await feature(k))['requires'] ?? []) as string[]) pairs.push({ name: `${p.key}: ${k} → ${r}`, ok: keys.includes(r) });
      }
    }
    expectAll(pairs, (x) => x.name, (x) => x.ok);
  }

  static presetFirst = (): Promise<void> => judged(['@preset-first']);
  static checklistFallback = (): Promise<void> => judged(['@checklist-fallback']);
  static extendsOnly = (): Promise<void> => judged(['@extends-only']);

  // форматы по схемам
  static async presetSchema(): Promise<void> {
    await expectSchema(await dataFiles(await pathsOf('preset')), `${SCHEMAS}/preset.schema.json`);
  }

  static async moduleSchema(): Promise<void> {
    await expectSchema(await frontmatters(await pathsOf('module')), `${SCHEMAS}/module-frontmatter.schema.json`);
  }

  static async skillSchema(): Promise<void> {
    await expectSchema(await frontmatters(await pathsOf('skill')), `${SCHEMAS}/skill-frontmatter.schema.json`);
  }

  static async providesSchema(): Promise<void> {
    const instances = (await modules()).filter((m) => m.provides !== null).map((m) => ({ name: m.key, data: m.provides }));
    await expectSchema(instances, `${SCHEMAS}/provides.schema.json`);
  }

  static async manifestSchema(): Promise<void> {
    const block = codeBlock((await skill('contract-setup')).text, 'yaml', 'key: <key>');
    expect(block).not.toBeNull();
    // Шаблон с заглушками `<…>`: заглушки заменяются допустимым значением, форма проверяется строго.
    const fill = (v: unknown): unknown =>
      typeof v === 'string' && /^<.*>$/.test(v) ? 'placeholder' : Array.isArray(v) ? v.map(fill) : v !== null && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
        : v;
    await expectSchema([{ name: 'contract-setup', data: fill(parse(block ?? '')) }], `${SCHEMAS}/manifest.schema.json`);
  }

  static async harnessConfigSchema(): Promise<void> {
    const sources = ['skills/harness/SKILL.md', 'harness/packages/harness/README.md'];
    const instances = await Promise.all(
      sources.map(async (s) => ({ name: s, data: parse(codeBlock(await readRepo(s), 'yaml', 'version:') ?? 'null') as unknown })),
    );
    await expectSchema(instances, `${SCHEMAS}/harness-config.schema.json`);
  }

  // skills и субагенты
  static async skillLength(): Promise<void> {
    for (const s of await skills()) expectAtMost(s.lines, 300, `строк в skill ${s.name}`);
  }

  static async coreSkills(): Promise<void> {
    const names = (await skills()).map((s) => s.name);
    expectAll(['contract-setup', 'workflow', 'docs-keeper', 'source-sync'], (n) => n, (n) => names.includes(n));
  }

  static async docsKeeperPreload(): Promise<void> {
    expect((await doc('agents/docs-keeper.md')).frontmatter?.['skills']).toContain('docs-keeper');
  }

  // документация и memory
  static docsReadonly = (): Promise<void> => judged(['@docs-readonly']);
  static generatedByHarness = (): Promise<void> => judged(['@docs-readonly']);
  static docsKeeperScope = (): Promise<void> => judged(['@docs-readonly']);
  static noRuleCopies = (): Promise<void> => judged(['@no-rule-copies']);

  static async memoryRule(): Promise<void> {
    expect(await template()).toContain('Memory агента запрещена');
  }

  static memoryOff = (): Promise<void> => judged(['@memory-off']);

  // журнал решений
  static changelogLine(): void {
    expect(DEFAULT_CHANGELOG.maxLine).toBe(120);
  }

  static coreTags(): void {
    expect([...DEFAULT_CHANGELOG.tags].sort()).toEqual(['arch', 'dep', 'milestone', 'stack']);
  }

  static async singleChangelog(): Promise<void> {
    const files = (await modules()).flatMap((m) => ((m.provides?.['files'] ?? []) as string[]).map((f) => `${m.key}: ${f}`));
    expectAll(files, (f) => f, (f) => !/changelog/i.test(f));
  }

  static moduleTags = (): Promise<void> => judged(['@module-tags']);

  static async mergeUnion(): Promise<void> {
    expect((await contract(KEY)).text).toContain('CHANGELOG.md merge=union');
  }

  // harness и источник
  static async noBash(): Promise<void> {
    const pkg = JSON.parse(await readRepo('harness/packages/harness/package.json')) as { engines: { node: string } };
    expect(pkg.engines.node).toBe('>=24');
    expect(await readRepo('.gitattributes')).toContain('eol=lf');
  }

  static async ciMatrix(): Promise<void> {
    expect(await readRepo('.github/workflows/check-index.yml')).toMatch(/os: \[ubuntu-latest, macos-latest, windows-latest\]/);
  }

  static async skillFileShas(): Promise<void> {
    const entries = (await indexEntries()).filter((e) => e.kind === 'skill');
    expectAll(entries, (e) => e.key, (e) => (e.files?.length ?? 0) > 0 && (e.files ?? []).every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  }

  static contextIndexNoDate = (): Promise<void> => judged(['@context-index-no-date']);
  static curlOnly = (): Promise<void> => judged(['@curl-only']);
  static syncWarnsDeprecated = (): Promise<void> => judged(['@sync-warns-deprecated']);

  // приоритетные правила модулей
  static safetyRule = (): Promise<void> => judged(['@safety-rule']);

  static async redFlagsListed(): Promise<void> {
    const section = (await skill('safety-boundaries')).section('Red-flag категории') ?? '';
    expect(section.split('\n').filter((l) => /^- /.test(l)).length).toBeGreaterThan(0);
  }
  static attributionRule = (): Promise<void> => judged(['@attribution-rule']);
  static privacyRule = (): Promise<void> => judged(['@privacy-rule']);

  // ядро
  static singleLink = (): Promise<void> => judged(['@single-link']);

  static async verifiedRule(): Promise<void> {
    const section = (await skill('domain')).section('Верификация') ?? '';
    expect(section).toMatch(/`verified: true`, `verified_at`[^\n]*\n?[^\n]*`verified_note`/);
  }
}
