import { describe, expect } from 'vitest';
import { AI_CORE, DELTA_DIR } from '@shahimat/ai-core';
import { HARNESS } from '@shahimat/harness';
import {
  allAnchors,
  anchorEvidence,
  budget,
  codeBlock,
  contract,
  crit,
  expectSchema,
  judged,
  modules,
  warn,
} from '@shahimat/ai-core/expect';
import { parse } from 'yaml';

budget({ crit: 0, warn: 0 });

describe('[flow] ownership', () => {
  crit(
    'у каждой записи в проектную документацию один ответственный — skill docs-keeper или команда harness; таблица — в skill docs-keeper',
    () => Check.owners(),
  );
  warn(
    'основная сессия передаёт docs-keeper только намерения и получает отчёт не длиннее 10 строк',
    () => Check.shortReport(),
  );
});

describe('[flow] delta', () => {
  crit(
    'формат дельты — JSON Schema docs-delta: пункты add, refine, revise; у revise — что было и почему',
    () => Check.deltaFormat(),
  );
  crit('дельта лежит в context/.delta/ и удаляется после приёмки', () => Check.deltaLifecycle());
  crit(
    '.delta не входит в контекст проекта: context/index.yml и маршруты AGENTS.md её не включают',
    () => Check.deltaOutOfContext(),
  );
  warn(
    'дельту ведёт docs-keeper: собирает из намерений, сверяет с текущей документацией, применяет',
    () => Check.deltaByKeeper(),
  );
  warn('add и refine не требуют внимания пользователя: строка в итоговом отчёте', () =>
    Check.deltaByKeeper(),
  );
  warn(
    'revise не блокирует работу: объявлен в дельте, попадает в отчёт и в тело сообщения коммита',
    () => Check.reviseTrace(),
  );
  warn(
    'приёмка: пункты дельты выполнены, прежние ожидания документации без revise не нарушены',
    () => Check.deltaByKeeper(),
  );
  warn(
    'утерянное знание восстанавливается из истории git через docs-keeper, причина потери записывается как rule',
    () => Check.recover(),
  );
  warn(
    'own-позиция записывается только в формулировке пользователя; вывод агента — разбор или tension',
    () => Check.ownVoice(),
  );
});

const SCHEMAS = 'expectations/schemas';

const OWNED = [
  'context/project.yml',
  'context/conventions/',
  'CHANGELOG.md',
  'provides.layers',
  '`context/.delta/` — создание',
  '`context/.delta/` — удаление',
  'context/index.yml',
  'адаптеры',
];

const anchorText = async (key: string): Promise<string> =>
  (await allAnchors())
    .filter((r) => r.key === key)
    .map((r) => r.text)
    .join('\n');

class Check {
  static async owners(): Promise<void> {
    const rows = (await anchorText('docs-owners'))
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| Что') && !l.startsWith('| ---'))
      .map((l) => l.split('|').map((c) => c.trim()))
      .map(([, what = '', owner = '']) => ({ what, owner }));
    expect(OWNED.filter((o) => !rows.some((r) => r.what.includes(o)))).toEqual([]);
    const commands = [AI_CORE, HARNESS].flatMap((t) =>
      t.commands.map((c) => `${t.bin} ${c.path.join(' ')}`),
    );
    const bad = rows.filter((r) => {
      const main = r.owner.split(';')[0]?.trim() ?? '';
      return main !== 'docs-keeper' && !commands.includes(main.replace(/`/g, ''));
    });
    expect(bad).toEqual([]);
  }

  static shortReport = (): Promise<void> =>
    judged(['@docs-keeper-report', '@docs-intents-triggers', '@attention']);

  static async deltaFormat(): Promise<void> {
    const block = codeBlock(await anchorEvidence('docs-delta'), 'yaml', 'summary:');
    expect(block).not.toBeNull();
    await expectSchema(
      [{ name: 'skill docs-keeper', data: parse(block ?? '') }],
      `${SCHEMAS}/docs-delta.schema.json`,
    );
  }

  static async deltaLifecycle(): Promise<void> {
    expect(DELTA_DIR).toBe('context/.delta');
    const text = await anchorText('docs-delta');
    expect(text).toContain('context/.delta/<имя>.yml');
    expect(text).toContain('ai-core delta close');
  }

  static async deltaOutOfContext(): Promise<void> {
    const template = (await contract('agent-operational-contract-v3')).agentsMdTemplate ?? '';
    expect(template).not.toBe('');
    const blocks = (await modules()).map((m) => `${m.key}: ${m.agentsMdBlock ?? ''}`);
    expect([template, ...blocks].filter((t) => t.includes('.delta'))).toEqual([]);
  }

  static deltaByKeeper = (): Promise<void> => judged(['@docs-delta']);
  static reviseTrace = (): Promise<void> => judged(['@docs-delta', '@docs-keeper-report']);
  static recover = (): Promise<void> => judged(['@recover']);
  static ownVoice = (): Promise<void> => judged(['@own-voice']);
}
