import { describe, expect } from 'vitest';
import {
  budget,
  contract,
  crit,
  expectSchema,
  judged,
  presets,
  readRepo,
  skills,
  warn,
  type PresetDoc,
} from '@shahimat/ai-core/expect';
import { parse } from 'yaml';
import { recordOrEmpty, stringList } from './shared/guards.ts';

budget({ crit: 0, warn: 0 });

describe('виды контракта', () => {
  crit(
    'контракт собирается под вид проекта пресетом: operational, external, private, analytical — для каждого есть пресет',
    () => Check.allKinds(),
  );
  warn(
    'ядро контракта перечисляет виды и что каждый включает; неподходящий вид — ручной выбор в том же чеклисте',
    () => Check.kindsDeclared(),
  );
  crit('каждый пресет включает domain и manuals', () => Check.commonCore());
  crit('ни один пресет не включает deprecated goals и harness по умолчанию', () =>
    Check.noLegacyModules(),
  );
  crit('у каждого пресета каждая core-роль есть в role_skills или role_exceptions', () =>
    Check.roleCoverage(),
  );
  crit('все skills в role_skills и roles пресета существуют в источнике', () =>
    Check.roleSkillsExist(),
  );
  crit('external содержит полный external-executor и исключает core executor', () =>
    Check.externalExecutor(),
  );
  crit('autonomy пресета соответствует схеме autonomy', () => Check.autonomySchema());
});

describe('operational — операционный проект со своим кодом', () => {
  crit('operational: пресет включает domain и manuals', () =>
    Check.has('operational', ['domain', 'manuals']),
  );
  crit(
    'operational: в пресете нет модулей других видов — external-context, life, analysis, app-loop',
    () => Check.hasNot('operational', ['external-context', 'life', 'analysis', 'app-loop']),
  );
  crit(
    'operational: источник реальности по умолчанию — код этого репозитория (reality: this-repo)',
    () => Check.defaultReality(),
  );
});

describe('external — внешний операционный контекст поверх чужого проекта', () => {
  crit('external: пресет включает external-context и domain', () =>
    Check.has('external', ['external-context', 'domain']),
  );
  crit('external: в пресете нет code-rules и worktrees — своего кода в репозитории нет', () =>
    Check.hasNot('external', ['code-rules-fullstack-js-ts', 'worktrees']),
  );
  warn('external: источник реальности — целевые системы из external, а не this-repo', () =>
    Check.externalReality(),
  );
});

describe('private — личный проект', () => {
  crit('private: пресет включает life, privacy, safety-boundaries и app-loop с доменом life', () =>
    Check.lifeModules(),
  );
  crit('private: privacy по умолчанию — outbound none и приватный репозиторий', () =>
    Check.privacyDefaults('private'),
  );
  crit('private: safety-boundaries покрывает и физическое, и психическое состояние', () =>
    Check.safetyScope(),
  );
  warn(
    'private: решения о жизни — в общий журнал с тегом [life], без значений, диагнозов и персональных данных',
    () => Check.lifeJournal(),
  );
});

describe('analytical — аналитический проект', () => {
  crit(
    'analytical: пресет включает analysis, book-corpus, data-access и app-loop с доменом analysis',
    () => Check.analyticalModules(),
  );
  crit('analytical: privacy по умолчанию — outbound none и приватный репозиторий', () =>
    Check.privacyDefaults('analytical'),
  );
  crit('analytical: в пресете нет life и safety-boundaries', () =>
    Check.hasNot('analytical', ['life', 'safety-boundaries']),
  );
});

const KINDS = ['operational', 'external', 'private', 'analytical'];
const CORE_ROLES = ['operator', 'researcher', 'executor', 'judge', 'librarian'];
const SCHEMAS = 'expectations/schemas';

async function preset(key: string): Promise<PresetDoc> {
  const p = (await presets()).find((x) => x.key === key);
  if (p === undefined) throw new Error(`пресета ${key} нет`);
  return p;
}

const presetData = async (key: string): Promise<Record<string, unknown>> =>
  recordOrEmpty(parse(await readRepo(`presets/${key}.yml`)), `preset ${key}`);

const roleSkillsOf = (data: Record<string, unknown>): Record<string, unknown> =>
  recordOrEmpty(data['role_skills'], 'role_skills');

const roleSkills = (data: Record<string, unknown>): string[] =>
  Object.values(roleSkillsOf(data)).flatMap((v) => stringList(v, 'role_skills'));

const presetSkills = async (data: Record<string, unknown>): Promise<string[]> => {
  const roles = recordOrEmpty(data['roles'], 'roles');
  return [
    ...roleSkills(data),
    ...Object.values(roles).flatMap((r) =>
      stringList(recordOrEmpty(r, 'role')['skills'], 'skills'),
    ),
  ];
};

const keysOf = (p: PresetDoc): string[] => p.modules.map((m) => m.key);
const answer = (p: PresetDoc, module: string, ask: string): unknown =>
  p.modules.find((m) => m.key === module)?.answers[ask];

class Check {
  static async allKinds(): Promise<void> {
    const keys = (await presets()).map((p) => p.key);
    expect(KINDS.filter((k) => !keys.includes(k))).toEqual([]);
  }

  static kindsDeclared = (): Promise<void> => judged(['@contract-kinds']);

  static async commonCore(): Promise<void> {
    for (const p of await presets()) {
      const keys = keysOf(p);
      expect({
        preset: p.key,
        missing: ['domain', 'manuals'].filter((k) => !keys.includes(k)),
      }).toEqual({
        preset: p.key,
        missing: [],
      });
    }
  }

  static async noLegacyModules(): Promise<void> {
    for (const p of await presets()) {
      expect({
        preset: p.key,
        legacy: ['goals', 'harness'].filter((k) => keysOf(p).includes(k)),
      }).toEqual({ preset: p.key, legacy: [] });
    }
  }

  static async roleCoverage(): Promise<void> {
    for (const p of await presets()) {
      const data = await presetData(p.key);
      const covered = new Set([
        ...Object.keys(roleSkillsOf(data)),
        ...stringList(data['role_exceptions'], 'role_exceptions'),
      ]);
      expect({
        preset: p.key,
        missing: CORE_ROLES.filter((r) => !covered.has(r)),
      }).toEqual({ preset: p.key, missing: [] });
    }
  }

  static async roleSkillsExist(): Promise<void> {
    const names = (await skills()).map((s) => s.name);
    for (const p of await presets()) {
      const data = await presetData(p.key);
      expect({
        preset: p.key,
        missing: (await presetSkills(data)).filter((s) => !names.includes(s)),
      }).toEqual({ preset: p.key, missing: [] });
    }
  }

  static async externalExecutor(): Promise<void> {
    const data = await presetData('external');
    const role = recordOrEmpty(recordOrEmpty(data['roles'], 'roles')['external-executor'], 'role');
    expect({
      kind: role['kind'],
      lifecycle: role['lifecycle'],
      concurrency: role['concurrency'],
      output: role['output'],
      skills: stringList(role['skills'], 'external-executor: skills').sort(),
      artifacts: stringList(role['artifacts'], 'external-executor: artifacts'),
      exceptions: stringList(data['role_exceptions'], 'role_exceptions'),
    }).toEqual({
      kind: 'custom',
      lifecycle: 'resumable',
      concurrency: 5,
      output: 'result',
      skills: ['browser', 'data-access', 'domain', 'executor', 'external-context', 'manuals'],
      artifacts: ['.oc3/reports/<ticket>/'],
      exceptions: ['executor'],
    });
  }

  static async autonomySchema(): Promise<void> {
    const instances = [];
    for (const p of await presets()) {
      const autonomy = (await presetData(p.key))['autonomy'];
      if (autonomy !== undefined) instances.push({ name: p.key, data: autonomy });
    }
    if (instances.length === 0) return;
    await expectSchema(instances, `${SCHEMAS}/autonomy.schema.json`);
  }

  static async has(key: string, modules: string[]): Promise<void> {
    const keys = keysOf(await preset(key));
    expect(modules.filter((m) => !keys.includes(m))).toEqual([]);
  }

  static async hasNot(key: string, modules: string[]): Promise<void> {
    const keys = keysOf(await preset(key));
    expect(modules.filter((m) => keys.includes(m))).toEqual([]);
  }

  static async defaultReality(): Promise<void> {
    expect((await contract('agent-operational-contract-v3')).text).toMatch(
      /^reality: \[this-repo\]/m,
    );
  }

  static externalReality = (): Promise<void> => judged(['@external-reality']);

  static async lifeModules(): Promise<void> {
    const p = await preset('private');
    await Check.has('private', ['life', 'privacy', 'safety-boundaries', 'app-loop']);
    expect(answer(p, 'app-loop', 'counterpart')).toBe('life');
  }

  static async privacyDefaults(key: string): Promise<void> {
    const p = await preset(key);
    expect({
      outbound: answer(p, 'privacy', 'outbound'),
      visibility: answer(p, 'privacy', 'repo-visibility'),
    }).toEqual({
      outbound: 'none',
      visibility: 'private',
    });
  }

  static async safetyScope(): Promise<void> {
    expect(
      stringList(
        answer(await preset('private'), 'safety-boundaries', 'scope'),
        'private: safety-boundaries.scope',
      ).sort(),
    ).toEqual(['physical', 'psyche']);
  }

  static lifeJournal = (): Promise<void> => judged(['@life-journal']);

  static async analyticalModules(): Promise<void> {
    const p = await preset('analytical');
    await Check.has('analytical', ['analysis', 'book-corpus', 'data-access', 'app-loop']);
    expect(answer(p, 'app-loop', 'counterpart')).toBe('analysis');
  }
}
