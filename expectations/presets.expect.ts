import { describe, expect } from 'vitest';
import {
  budget,
  contract,
  crit,
  judged,
  presets,
  warn,
  type PresetDoc,
} from '@shahimat/harness/expect';
import { stringList } from './shared/guards.ts';

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
  crit('каждый пресет включает goals, harness и ticket-commits с mode on', () =>
    Check.commonCore(),
  );
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

async function preset(key: string): Promise<PresetDoc> {
  const p = (await presets()).find((x) => x.key === key);
  if (p === undefined) throw new Error(`пресета ${key} нет`);
  return p;
}

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
        missing: ['goals', 'harness', 'ticket-commits'].filter((k) => !keys.includes(k)),
      }).toEqual({
        preset: p.key,
        missing: [],
      });
      expect({ preset: p.key, mode: answer(p, 'ticket-commits', 'mode') }).toEqual({
        preset: p.key,
        mode: 'on',
      });
    }
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
