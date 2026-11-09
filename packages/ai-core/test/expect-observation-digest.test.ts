import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { observedDigest } from '#lib/expect/observation-digest';
import { canonicalJson } from '#lib/proof/inputs';

const oldDigest = (value: unknown): string =>
  createHash('sha256')
    .update(canonicalJson(value === undefined ? { defined: false } : { defined: true, value }))
    .digest('hex');

afterEach(() => vi.restoreAllMocks());

const stringifyInputs = (calls: readonly (readonly unknown[])[]): unknown[] =>
  calls.map(([value]) => value);

it('preserves the independent old equality relation across strings, domains and canonical fallback values', () => {
  const values: unknown[] = [
    '',
    'a',
    'b',
    'aa',
    'ab',
    '\n"\\\0',
    '\0',
    '\uFEFF',
    '🌍',
    '\ud800',
    '\ud801',
    '\udc00',
    '\udc01',
    '\ufffd',
    'é',
    'e\u0301',
    'true',
    'null',
    'undefined',
    '{"defined":false}',
    'observation-string-utf16le-v1\0',
    undefined,
    null,
    true,
    false,
    0,
    1,
    [],
    [''],
    ['a', 'b'],
    ['ab'],
    {},
    { defined: false },
    { value: '' },
    { b: 2, a: 1 },
    { a: 1, b: 2 },
    ['', '\ud800'],
    '',
    '\ud800',
  ];
  const old = values.map(oldDigest);
  const current = values.map(observedDigest);
  for (let a = 0; a < values.length; a++)
    for (let b = 0; b < values.length; b++)
      expect(current[a] === current[b]).toBe(old[a] === old[b]);
  for (const value of values.filter((value) => typeof value !== 'string'))
    expect(observedDigest(value)).toBe(oldDigest(value));
});

it('keeps actual UTF-8 replacement aliases distinct with length-delimited UTF-16 code units', () => {
  const values = ['\ud800', '\udc00', '\ufffd'];
  expect(new Set(values.map((value) => Buffer.from(value, 'utf8').toString('hex'))).size).toBe(1);
  expect(new Set(values.map(observedDigest)).size).toBe(3);
  for (const value of ['', '🌍', '\ud800\0\udc00', '\uFEFF\r\n']) {
    const bytes = Buffer.alloc(value.length * 2);
    for (let index = 0; index < value.length; index++)
      bytes.writeUInt16LE(value.charCodeAt(index), index * 2);
    const independent = createHash('sha256')
      .update(`observation-string-utf16le-v1\0${value.length}\0`)
      .update(bytes)
      .digest('hex');
    expect(observedDigest(value)).toBe(independent);
  }
});

it('retains strict fallback rejects for nested undefined, aliases, cycles, descriptors and proxies', () => {
  const shared = {};
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  const sparse: unknown[] = [];
  sparse.length = 1;
  const rejected: unknown[] = [
    { value: undefined },
    [undefined],
    { nested: { value: undefined } },
    NaN,
    Infinity,
    -0,
    1n,
    Symbol('synthetic'),
    () => 1,
    sparse,
    cycle,
    [shared, shared],
    Object.freeze({}),
    Object.create(null),
    Object.create(String.prototype),
    new Proxy({}, {}),
    { nested: new Proxy({}, {}) },
    Object.defineProperty({}, 'value', { get: () => 'a', enumerable: true }),
    Object.defineProperty({}, 'value', { value: 'a', enumerable: false }),
    { [Symbol('synthetic')]: 'a' },
  ];
  for (const value of rejected) {
    expect(() => oldDigest(value)).toThrow('PROOF_NON_CANONICAL_INPUT');
    expect(() => observedDigest(value)).toThrow('PROOF_NON_CANONICAL_INPUT');
  }
  expect(observedDigest(undefined)).not.toBe(observedDigest({}));
  expect(observedDigest({})).not.toBe(observedDigest({ value: null }));
});

it('removes actual string JSON materialization without changing fallback JSON work', () => {
  const text = 'synthetic\n"\\\0\ud800🌍'.repeat(2048);
  const stringify = vi.spyOn(JSON, 'stringify');
  const previous = oldDigest(text);
  const oldCalls = stringifyInputs(stringify.mock.calls);
  stringify.mockClear();
  const current = observedDigest(text);
  expect(stringify).not.toHaveBeenCalled();
  expect(oldCalls).toEqual(['defined', true, 'value', text]);
  expect(current).not.toBe(previous);
  stringify.mockClear();
  oldDigest(['synthetic', null]);
  const oldFallbackCalls = stringifyInputs(stringify.mock.calls);
  stringify.mockClear();
  observedDigest(['synthetic', null]);
  expect(stringifyInputs(stringify.mock.calls)).toEqual(oldFallbackCalls);
});
