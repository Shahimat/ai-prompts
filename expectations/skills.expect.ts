import { describe, expect } from 'vitest';
import {
  budget,
  crit,
  doc,
  expectSchema,
  frontmatters,
  indexEntries,
  judged,
  modules,
  readRepo,
  skill,
  skills,
  warn,
} from '@shahimat/harness/expect';
import { stringList } from './shared/guards.ts';

budget({ crit: 0, warn: 0 });

describe('состав skills', () => {
  crit('skills ядра: contract-setup, workflow, docs-keeper, source-sync, source-feedback', () =>
    Check.coreSkills(),
  );
  crit(
    'skills модулей, по имени модуля: domain, manuals, goals, harness, worktrees, ticket-commits, app-loop, data-access',
    () =>
      Check.moduleSkills([
        'domain',
        'manuals',
        'goals',
        'harness',
        'worktrees',
        'ticket-commits',
        'app-loop',
        'data-access',
      ]),
  );
  crit(
    'skills модулей, по имени модуля: privacy, life, safety-boundaries, analysis, book-corpus, external-context, knowledge-external-gui',
    () =>
      Check.moduleSkills([
        'privacy',
        'life',
        'safety-boundaries',
        'analysis',
        'book-corpus',
        'external-context',
        'knowledge-external-gui',
      ]),
  );
  crit('других skills нет — всего 20', () => Check.skillCount());
  crit('субагенты: только docs-keeper', () => Check.onlyDocsKeeper());
});

describe('skills — общее', () => {
  crit(
    'frontmatter каждого SKILL.md соответствует схеме skill-frontmatter: только name и description',
    () => Check.skillSchema(),
  );
  crit('name skill совпадает с именем его каталога', () => Check.nameMatchesDir());
  crit('description каждого skill говорит, когда его загружать', () => Check.whenToLoad());
  crit('SKILL.md — не больше 300 строк', () => Check.skillLength());
  crit('каждый skill из provides.skills модулей есть в skills/', () => Check.providedSkillsExist());
  crit('нет skills, которые не ставит ни ядро, ни один модуль', () => Check.noOrphanSkills());
});

describe('копии источников', () => {
  crit('skill goals совпадает с inline-блоком паттерна goals', () => Check.goalsCopy());
  crit('skill knowledge-external-gui совпадает с разделами своего модуля', () =>
    Check.knowledgeCopy(),
  );
  crit(
    'skills privacy, safety-boundaries и analysis содержат inline-блок паттерна guardrail-dual-level',
    () => Check.guardrailCopies(),
  );
});

describe('субагенты', () => {
  crit('субагент docs-keeper предзагружает skill docs-keeper', () => Check.docsKeeperPreload());
  crit(
    'у каждого субагента name совпадает с файлом, а skills ссылаются на существующие skills',
    () => Check.agentsConsistent(),
  );
});

describe('поведение ключевых skills', () => {
  warn(
    'workflow: блокирующий вопрос — нумерованные варианты, дефолт с обоснованием, стоп до ответа',
    () => Check.blockingQuestion(),
  );
  warn('contract-setup: модули подключаются по одному, каждый — с manifest и отчётом', () =>
    Check.moduleInstall(),
  );
  warn('docs-keeper: факт без evidence не записывается как проверенный', () =>
    Check.intentsEvidence(),
  );
  crit(
    'domain: verified: true ставится только вместе с verified_at (дата) и verified_note (чем проверено)',
    () => Check.verifiedRule(),
  );
});

// ─────────────────────────────── проверки ───────────────────────────────

const CORE_SKILLS = ['contract-setup', 'workflow', 'docs-keeper', 'source-sync', 'source-feedback'];
const SCHEMAS = 'expectations/schemas';

/** Inline-блок паттерна: текст между `---` в разделе «Inline-блок для целевого промпта». */
async function inlineBlock(pattern: string): Promise<string> {
  const text = await readRepo(`patterns/${pattern}.md`);
  return text.slice(text.indexOf('## Inline-блок для целевого промпта')).split('\n---\n')[1] ?? '';
}

class Check {
  // общее
  static async skillSchema(): Promise<void> {
    const paths = (await indexEntries())
      .filter((e) => e.kind === 'skill')
      .map((e) => `${e.path}/SKILL.md`);
    await expectSchema(await frontmatters(paths), `${SCHEMAS}/skill-frontmatter.schema.json`);
  }

  static async nameMatchesDir(): Promise<void> {
    const bad = (await skills())
      .filter((s) => s.frontmatter?.['name'] !== s.name)
      .map((s) => s.name);
    expect(bad).toEqual([]);
  }

  static async whenToLoad(): Promise<void> {
    const bad = (await skills()).filter((s) => !/загруж/i.test(s.description)).map((s) => s.name);
    expect(bad).toEqual([]);
  }

  static async skillLength(): Promise<void> {
    const bad = (await skills()).filter((s) => s.lines > 300).map((s) => `${s.name}: ${s.lines}`);
    expect(bad).toEqual([]);
  }

  static async coreSkills(): Promise<void> {
    const names = (await skills()).map((s) => s.name);
    expect(CORE_SKILLS.filter((n) => !names.includes(n))).toEqual([]);
  }

  static async moduleSkills(names: string[]): Promise<void> {
    const skillNames = (await skills()).map((s) => s.name);
    const mods = await modules();
    for (const name of names) {
      const owner = mods.find((m) => m.key === name);
      const provides =
        owner?.providesAll.some((p) =>
          stringList(p['skills'], `${name}: provides.skills`).includes(name),
        ) ?? false;
      expect({ name, skill: skillNames.includes(name), provides }).toEqual({
        name,
        skill: true,
        provides: true,
      });
    }
  }

  static async skillCount(): Promise<void> {
    expect((await skills()).length).toBe(20);
  }

  static async onlyDocsKeeper(): Promise<void> {
    expect((await indexEntries()).filter((e) => e.kind === 'agent').map((e) => e.key)).toEqual([
      'docs-keeper',
    ]);
  }

  static async providedSkillsExist(): Promise<void> {
    const names = (await skills()).map((s) => s.name);
    const provided = (await modules()).flatMap((m) =>
      m.providesAll.flatMap((p) => stringList(p['skills'], `${m.key}: provides.skills`)),
    );
    expect(provided.filter((s) => !names.includes(s))).toEqual([]);
  }

  static async noOrphanSkills(): Promise<void> {
    const provided = new Set([
      ...CORE_SKILLS,
      ...(await modules()).flatMap((m) =>
        m.providesAll.flatMap((p) => stringList(p['skills'], `${m.key}: provides.skills`)),
      ),
    ]);
    expect((await skills()).map((s) => s.name).filter((n) => !provided.has(n))).toEqual([]);
  }

  // копии источников
  static async goalsCopy(): Promise<void> {
    // Заголовки в skill на два уровня выше: ### → #, #### → ##.
    const expected = (await inlineBlock('goals'))
      .trim()
      .split('\n')
      .map((l) =>
        l.startsWith('#### ') ? `## ${l.slice(5)}` : l.startsWith('### ') ? `# ${l.slice(4)}` : l,
      )
      .join('\n');
    expect((await skill('goals')).text).toContain(`${expected}\n`);
  }

  static async knowledgeCopy(): Promise<void> {
    const module = await readRepo('prompts/modules/knowledge-external-gui.md');
    const at = (heading: string): number => module.indexOf(`\n${heading}\n`) + 1;
    const expected =
      module.slice(
        at('## Назначение и границы'),
        module.indexOf('\n## Что модуль привносит в проект') + 1,
      ) + module.slice(at('## Обфусцированный пример'));
    const text = (await skill('knowledge-external-gui')).text;
    expect(text.slice(text.indexOf('\n## ') + 1)).toBe(`${expected.trimEnd()}\n`);
  }

  static async guardrailCopies(): Promise<void> {
    // Заголовок блока в skill на уровень выше: ### → ##.
    const expected = (await inlineBlock('guardrail-dual-level')).trim().replace(/^### /m, '## ');
    for (const name of ['privacy', 'safety-boundaries', 'analysis']) {
      expect({ name, ok: (await skill(name)).text.includes(expected) }).toEqual({ name, ok: true });
    }
  }

  // субагенты
  static async docsKeeperPreload(): Promise<void> {
    expect((await doc('agents/docs-keeper.md')).frontmatter?.['skills']).toContain('docs-keeper');
  }

  static async agentsConsistent(): Promise<void> {
    const names = (await skills()).map((s) => s.name);
    for (const a of (await indexEntries()).filter((e) => e.kind === 'agent')) {
      const fm = (await doc(a.path)).frontmatter ?? {};
      const missing = stringList(fm['skills'], `${a.path}: skills`).filter(
        (s) => !names.includes(s),
      );
      expect({ agent: a.key, name: fm['name'], missing }).toEqual({
        agent: a.key,
        name: a.key,
        missing: [],
      });
    }
  }

  // поведение ключевых skills
  static blockingQuestion = (): Promise<void> => judged(['@blocking-question']);
  static moduleInstall = (): Promise<void> => judged(['@module-install']);
  static intentsEvidence = (): Promise<void> => judged(['@docs-keeper-intents']);

  static async verifiedRule(): Promise<void> {
    const section = (await skill('domain')).section('Верификация') ?? '';
    expect(section).toMatch(/`verified: true`, `verified_at`[^\n]*\n?[^\n]*`verified_note`/);
  }
}
