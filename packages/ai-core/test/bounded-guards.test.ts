import { describe, expect, it } from 'vitest';
import { isOneOf, isRecord, isStringArray } from '#shared/guards';

describe('bounded ordinary guard contract', () => {
  it('distinguishes records from null, arrays and primitive values', () => {
    for (const value of [null, [], 'text', 0, false, undefined])
      expect(isRecord(value)).toBe(false);
    for (const value of [{}, { code: 'ENOENT' }]) expect(isRecord(value)).toBe(true);
  });
  it('requires every array element to be a string without coercion', () => {
    for (const value of [null, 'text', {}, [1], ['a', false]])
      expect(isStringArray(value)).toBe(false);
    for (const value of [[], [''], ['a', 'б']]) expect(isStringArray(value)).toBe(true);
  });
  it('matches declared string choices without coercing unknown values', () => {
    for (const value of [1, null, undefined, false, 'other'])
      expect(isOneOf(['one', 'two'], value)).toBe(false);
    expect(isOneOf(['one', 'two'], 'two')).toBe(true);
    expect(isOneOf([], 'two')).toBe(false);
  });
});
