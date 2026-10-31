import { describe, expect, it } from 'vitest';
import { InputError, parseIntents, UsageError } from '@shahimat/ai-core';

const REVISE =
  '- kind: revise\n  target: naming\n  summary: имена в snake_case\n  was: имена в kebab-case\n  why: внешний API\n  evidence: решение пользователя\n';

describe('намерения intents', () => {
  it('прежние виды проходят без изменений', () => {
    expect(JSON.parse(parseIntents('- kind: rule\n  summary: s\n  evidence: e\n', 't'))).toEqual({
      intents: [{ kind: 'rule', summary: 's', evidence: 'e' }],
    });
  });

  it('revise с target, was, why и evidence проходит схему', () => {
    expect(JSON.parse(parseIntents(REVISE, 't'))).toEqual({
      intents: [
        {
          kind: 'revise',
          target: 'naming',
          summary: 'имена в snake_case',
          was: 'имена в kebab-case',
          why: 'внешний API',
          evidence: 'решение пользователя',
        },
      ],
    });
  });

  it('revise без was отклоняется; was у прежнего вида — тоже', () => {
    expect(() => parseIntents(REVISE.replace('  was: имена в kebab-case\n', ''), 't')).toThrow(
      "must have required property 'was'",
    );
    expect(() =>
      parseIntents('- kind: rule\n  summary: s\n  evidence: e\n  was: x\n', 't'),
    ).toThrow('не по схеме intents');
  });

  it('ошибка входа — InputError с ожидаемой формой, видами и формой revise', () => {
    let caught: unknown;
    try {
      parseIntents('- kind: idea\n  summary: x\n', 'bad.yml');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InputError);
    expect(caught).toBeInstanceOf(UsageError);
    const text = caught instanceof Error ? caught.message : '';
    expect(text).toContain('intents: [{kind, summary, evidence}]');
    expect(text).toContain('decision | fact | rule | behavior-change | task | manual');
    expect(text).toContain('{kind: revise, target, was, why, summary, evidence}');
    expect(() => parseIntents('a: [', 'bad.yml')).toThrow('ожидается: intents');
  });
});
