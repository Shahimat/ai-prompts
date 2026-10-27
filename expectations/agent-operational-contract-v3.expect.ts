import { describe, expect } from 'vitest';
import {
  budget,
  codeBlock,
  crit,
  expectAtMost,
  contract,
  dataFiles,
  expectSchema,
  frontmatters,
  indexEntries,
  judged,
  module,
  modules,
  presets,
  readRepo,
  skill,
  warn,
} from '@shahimat/harness/expect';
import { attention } from '@shahimat/expectations';
import { parse } from 'yaml';
import { anyContract } from './shared/any-contract.expect.ts';
import { at, parseJson, recordOrEmpty, stringList, unknownList } from './shared/guards.ts';

budget({ crit: 0, warn: 5 });

anyContract('agent-operational-contract-v3');
attention('attention');

describe('AGENTS.md', () => {
  crit('шаблон AGENTS.md в ядре — не больше 80 строк', () => Check.templateLength());
  crit('в любом пресете собранный AGENTS.md — не больше 150 строк и 8192 байт', () =>
    Check.presetBudget(),
  );
  crit('жёстких правил — не больше 7, каждое не длиннее 200 символов', () => Check.hardRules());
  crit('маршрут «как сейчас устроено» ведёт на reality из context/project.yml', () =>
    Check.realityRoute(),
  );
  crit('строки блоков модулей обязательны наравне с жёсткими правилами ядра', () =>
    Check.moduleRulesBinding(),
  );
  warn('CLAUDE.md для Claude Code — импорт @AGENTS.md, генерирует harness adapters sync', () =>
    Check.claudeMd(),
  );
});

describe('возможности и пресеты', () => {
  crit('у каждого модуля v3 есть feature с summary и default', () => Check.featureBlock());
  crit('у каждого модуля v3 есть блок AGENTS.md между маркерами module:<key>', () =>
    Check.moduleBlocks(),
  );
  crit('блок модуля — не больше 5 строк, у модулей с guardrail-dual-level — до 8', () =>
    Check.moduleBlockSize(),
  );

  crit('каждый ответ пресета — существующий вариант вопроса модуля', () => Check.presetAnswers());
  crit('пресет включает все модули, которые требуют его модули', () => Check.presetRequires());
  warn('contract-setup первым вопросом предлагает пресет или ручной выбор', () =>
    Check.presetFirst(),
  );
  warn(
    'без инструмента multi-select чеклист — нумерованный список, ответ номерами через запятую',
    () => Check.checklistFallback(),
  );
  warn('модуль добавляет поля в чужие слои только через provides.extends', () =>
    Check.extendsOnly(),
  );
});

describe('форматы по схемам', () => {
  crit('каждый пресет соответствует схеме preset', () => Check.presetSchema());
  crit('frontmatter каждого модуля соответствует схеме module-frontmatter', () =>
    Check.moduleSchema(),
  );
  crit('provides каждого модуля соответствует схеме provides', () => Check.providesSchema());
  crit('шаблон manifest в skill contract-setup соответствует схеме manifest', () =>
    Check.manifestSchema(),
  );
  crit('примеры context/harness.yml в skill harness и README пакета соответствуют схеме', () =>
    Check.harnessConfigSchema(),
  );
});

describe('документация проекта', () => {
  crit(
    'в основной сессии файлы проектной документации только читаются; правки — только через docs-keeper, генерируемые файлы — через harness',
    () => Check.docsReadonly(),
  );
  crit(
    'при подключённом harness генерируемые файлы (context/index.yml, адаптеры под инструменты) меняет только harness, не агент и не docs-keeper',
    () => Check.generatedByHarness(),
  );
  warn('docs-keeper меняет только слои документации проекта и не трогает код', () =>
    Check.docsKeeperScope(),
  );
  warn('правила контракта не копируются в context/conventions', () => Check.noRuleCopies());
  crit(
    'шаблон AGENTS.md и блоки модулей не содержат указаний основной сессии самой править документацию — только ссылки на skills и harness; guardrail о достоверности знания допустим',
    () => Check.noWriteCommands(),
  );
});

describe('memory', () => {
  crit('memory агента запрещена правилом в шаблоне AGENTS.md', () => Check.memoryRule());
});

describe('журнал решений', () => {
  crit('журнал один: ни один модуль не ставит свой CHANGELOG-файл', () => Check.singleChangelog());
  warn('свой тег журнала модуль добавляет только через provides.changelog_tags', () =>
    Check.moduleTags(),
  );
  crit('CHANGELOG.md сливается через merge=union в .gitattributes ядра', () => Check.mergeUnion());
});

describe('источник', () => {
  warn('источники скачиваются только curl, WebFetch запрещён', () => Check.curlOnly());
  warn('обновление из источника предупреждает о deprecated-контракте и называет замену', () =>
    Check.syncWarnsDeprecated(),
  );
});

describe('приоритетные правила модулей', () => {
  crit(
    'safety-boundaries: при признаке из списка red-flag агент прекращает сценарий и даёт контакт помощи',
    () => Check.safetyRule(),
  );
  crit('в skill safety-boundaries список red-flag категорий непустой', () =>
    Check.redFlagsListed(),
  );
  warn('правило целостности атрибуции записано в блоке analysis для AGENTS.md', () =>
    Check.attributionRule(),
  );
  crit('privacy: в документации, коммитах и журнале нет реальных персональных данных', () =>
    Check.privacyRule(),
  );
});

describe('обновление', () => {
  crit(
    'есть skill обновления: сверяет источник, показывает новые и устаревшие модули, пресеты, версию harness и предлагает включить или отключить возможности',
    () => Check.updateSkill(),
  );
  crit('в ядре контракта нет протокола обновления — он только в skill source-sync', () =>
    Check.noUpdateProtocolInCore(),
  );
});

describe('предложения в источник', () => {
  crit(
    'skill source-feedback собирает из проекта предложения в источник: дрейф поставленных частей, локальные обобщения, пробелы и обходы схемы',
    () => Check.feedbackProtocol(),
  );
  crit('пример предложения в skill source-feedback соответствует схеме source-proposal', () =>
    Check.proposalSchema(),
  );
  crit('агент только формирует файл предложения; передать его в источник решает пользователь', () =>
    Check.feedbackNotSent(),
  );
  warn('дрейф поставленных частей определяется сверкой SHA с parts и индексом, а не на глаз', () =>
    Check.driftBySha(),
  );
  crit(
    'перед передачей файл предложения проходит harness secrets scan --file; без harness агент проверяет по тем же правилам сам',
    () => Check.feedbackSecrets(),
  );
  warn(
    'в предложении нет персональных данных и ссылок из external — только обезличенные выдержки',
    () => Check.feedbackSanitized(),
  );
});

describe('ядро', () => {
  warn('ядро ставится одной ссылкой на контракт, остальное агент берёт по индексу', () =>
    Check.singleLink(),
  );
});

const KEY = 'agent-operational-contract-v3';
const SCHEMAS = 'expectations/schemas';

const template = async (): Promise<string> => (await contract(KEY)).agentsMdTemplate ?? '';
const v3Modules = async (): Promise<Awaited<ReturnType<typeof modules>>> =>
  (await modules()).filter(
    (m) =>
      m.frontmatter?.['deprecated'] === undefined &&
      stringList(m.frontmatter?.['applicable_to'], `${m.key}: applicable_to`).includes(KEY),
  );
const feature = async (key: string): Promise<Record<string, unknown>> =>
  recordOrEmpty((await module(key)).frontmatter?.['feature'], `${key}: feature`);
const parseYaml = (text: string): unknown => parse(text);
const pathsOf = async (kind: string): Promise<string[]> =>
  (await indexEntries())
    .filter((e) => e.kind === kind)
    .map((e) => (kind === 'skill' ? `${e.path}/SKILL.md` : e.path));

function expectAll<T>(items: T[], name: (x: T) => string, ok: (x: T) => boolean): void {
  expect(items.filter((x) => !ok(x)).map(name)).toEqual([]);
}

class Check {
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
      .map(
        (r) =>
          r
            .split('\n\n')[0]
            ?.replace(/^\d+\. /, '')
            .replace(/\s+/g, ' ')
            .trim() ?? '',
      );
    expectAtMost(rules.length, 7, 'жёстких правил');
    for (const [i, r] of rules.entries())
      expectAtMost([...r].length, 200, `символов в правиле ${i + 1}`);
  }

  static async realityRoute(): Promise<void> {
    expect(await template()).toMatch(
      /как сейчас устроено X → источник реальности[\s\S]{0,40}reality/,
    );
  }

  static async moduleRulesBinding(): Promise<void> {
    expect(await template()).toContain('обязательны наравне');
  }

  static claudeMd = (): Promise<void> => judged(['@claude-md-import']);

  static async featureBlock(): Promise<void> {
    const ms = await v3Modules();
    expectAll(
      ms,
      (m) => m.key,
      (m) => {
        const f = recordOrEmpty(m.frontmatter?.['feature'], `${m.key}: feature`);
        return typeof f['summary'] === 'string' && typeof f['default'] === 'boolean';
      },
    );
  }

  static async moduleBlocks(): Promise<void> {
    expectAll(
      await v3Modules(),
      (m) => m.key,
      (m) => m.agentsMdBlock !== null,
    );
  }

  static async moduleBlockSize(): Promise<void> {
    expectAll(
      await v3Modules(),
      (m) => m.key,
      (m) => {
        const lines = (m.agentsMdBlock ?? '')
          .split('\n')
          .filter((l) => l.trim() !== '' && !l.startsWith('<!--')).length;
        const guardrail = stringList(m.frontmatter?.['patterns'], `${m.key}: patterns`).includes(
          'guardrail-dual-level',
        );
        return lines <= (guardrail ? 8 : 5);
      },
    );
  }

  static async presetAnswers(): Promise<void> {
    const answers: { name: string; ok: boolean }[] = [];
    for (const p of await presets()) {
      for (const pm of p.modules) {
        const asks = unknownList((await feature(pm.key))['asks'], `${pm.key}: feature.asks`);
        for (const [k, v] of Object.entries(pm.answers)) {
          const ask = asks.find((a) => at(a, 'key') === k);
          const options = unknownList(at(ask, 'options'), `${pm.key}: asks.${k}.options`).map(
            String,
          );
          for (const x of Array.isArray(v) ? v : [v])
            answers.push({
              name: `${p.key}/${pm.key}/${k}=${String(x)}`,
              ok: options.includes(String(x)),
            });
        }
      }
    }
    expectAll(
      answers,
      (a) => a.name,
      (a) => a.ok,
    );
  }

  static async presetRequires(): Promise<void> {
    const pairs: { name: string; ok: boolean }[] = [];
    for (const p of await presets()) {
      const keys = p.modules.map((m) => m.key);
      for (const k of keys) {
        for (const r of stringList((await feature(k))['requires'], `${k}: feature.requires`))
          pairs.push({ name: `${p.key}: ${k} → ${r}`, ok: keys.includes(r) });
      }
    }
    expectAll(
      pairs,
      (x) => x.name,
      (x) => x.ok,
    );
  }

  static presetFirst = (): Promise<void> => judged(['@preset-first']);
  static checklistFallback = (): Promise<void> => judged(['@checklist-fallback']);
  static extendsOnly = (): Promise<void> => judged(['@extends-only']);

  static async presetSchema(): Promise<void> {
    await expectSchema(await dataFiles(await pathsOf('preset')), `${SCHEMAS}/preset.schema.json`);
  }

  static async moduleSchema(): Promise<void> {
    await expectSchema(
      await frontmatters(await pathsOf('module')),
      `${SCHEMAS}/module-frontmatter.schema.json`,
    );
  }

  static async providesSchema(): Promise<void> {
    const instances = (await modules())
      .filter((m) => m.provides !== null)
      .map((m) => ({ name: m.key, data: m.provides }));
    await expectSchema(instances, `${SCHEMAS}/provides.schema.json`);
  }

  static async manifestSchema(): Promise<void> {
    const block = codeBlock((await skill('contract-setup')).text, 'yaml', 'key: <key>');
    expect(block).not.toBeNull();
    const fill = (v: unknown): unknown =>
      typeof v === 'string' && /^<.*>$/.test(v)
        ? 'placeholder'
        : Array.isArray(v)
          ? v.map(fill)
          : v !== null && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
            : v;
    await expectSchema(
      [{ name: 'contract-setup', data: fill(parse(block ?? '')) }],
      `${SCHEMAS}/manifest.schema.json`,
    );
  }

  static async harnessConfigSchema(): Promise<void> {
    const sources = ['skills/harness/SKILL.md', 'packages/harness/README.md'];
    const instances = await Promise.all(
      sources.map(async (s) => ({
        name: s,
        data: parseYaml(codeBlock(await readRepo(s), 'yaml', 'version:') ?? 'null'),
      })),
    );
    await expectSchema(instances, `${SCHEMAS}/harness-config.schema.json`);
  }

  static docsReadonly = (): Promise<void> => judged(['@docs-readonly']);
  static generatedByHarness = (): Promise<void> => judged(['@docs-readonly']);
  static docsKeeperScope = (): Promise<void> => judged(['@docs-readonly']);
  static noWriteCommands = (): Promise<void> => judged(['@agents-md-readonly']);
  static noRuleCopies = (): Promise<void> => judged(['@no-rule-copies']);

  static async memoryRule(): Promise<void> {
    expect(await template()).toContain('Memory агента запрещена');
  }

  static async singleChangelog(): Promise<void> {
    const files = (await modules()).flatMap((m) =>
      stringList(m.provides?.['files'], `${m.key}: provides.files`).map((f) => `${m.key}: ${f}`),
    );
    expectAll(
      files,
      (f) => f,
      (f) => !/changelog/i.test(f),
    );
  }

  static moduleTags = (): Promise<void> => judged(['@module-tags']);

  static async mergeUnion(): Promise<void> {
    expect((await contract(KEY)).text).toContain('CHANGELOG.md merge=union');
  }

  static curlOnly = (): Promise<void> => judged(['@curl-only']);
  static syncWarnsDeprecated = (): Promise<void> => judged(['@sync-warns-deprecated']);

  static safetyRule = (): Promise<void> => judged(['@safety-rule']);

  static async redFlagsListed(): Promise<void> {
    const section = (await skill('safety-boundaries')).section('Red-flag категории') ?? '';
    expect(section.split('\n').filter((l) => l.startsWith('- ')).length).toBeGreaterThan(0);
  }
  static attributionRule = (): Promise<void> => judged(['@attribution-rule']);
  static privacyRule = (): Promise<void> => judged(['@privacy-rule']);

  static feedbackProtocol = (): Promise<void> => judged(['@source-feedback']);
  static feedbackNotSent = (): Promise<void> => judged(['@source-feedback']);
  static driftBySha = (): Promise<void> => judged(['@feedback-drift']);
  static feedbackSecrets = (): Promise<void> => judged(['@feedback-sanitized']);
  static feedbackSanitized = (): Promise<void> => judged(['@feedback-sanitized']);

  static async proposalSchema(): Promise<void> {
    const block = codeBlock((await skill('source-feedback')).text, 'json', '{\n  "format"');
    expect(block).not.toBeNull();
    await expectSchema(
      [{ name: 'source-feedback', data: parseJson(block ?? 'null') }],
      `${SCHEMAS}/source-proposal.schema.json`,
    );
  }

  static singleLink = (): Promise<void> => judged(['@single-link']);

  static updateSkill = (): Promise<void> => judged(['@update-report', '@sync-warns-deprecated']);

  static async noUpdateProtocolInCore(): Promise<void> {
    const core = await contract(KEY);
    expect(core.headings.filter((h) => /обновлени|сверь/i.test(h))).toEqual([]);
  }
}
