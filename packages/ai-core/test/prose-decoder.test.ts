import { describe, expect, it, vi } from 'vitest';
import { proseUnits } from '#lib/memory-projection';
import { decode } from './prose-decoder.js';

const blocks = [
  'Значение 0 — объект; родитель корень.',
  'Значение 1 — строка; родитель 0.',
  'Значение 2 — список; родитель 0.',
  'Значение 3 — логическое; родитель 2; элемент 0; значение false.',
  'Значение 4 — пустое; родитель 2; элемент 1.',
  'Значение 5 — число; родитель 2; элемент 2; значение -0.',
  'Значение 6 — строка; родитель 2; элемент 3.',
  'Значение 7 — объект; родитель 2; элемент 4.',
  'Значение 8 — список; родитель 2; элемент 5.',
  'Значение 9 — строка; родитель 0.',
].join('\n');
const fragments = [
  'Ключ 1, позиция 0:\n<pre>a&#46;b</pre>',
  'Текст 1, позиция 0:\n<pre>  😀\n</pre>',
  'Текст 1, позиция 5:\n<pre>&#60;&#38;&#62;&#13;\n</pre>',
  'Ключ 2, позиция 0:\n<pre>items</pre>',
  'Текст 6, позиция 0:\n<pre></pre>',
  'Ключ 9, позиция 0:\n<pre></pre>',
  'Текст 9, позиция 0:\n<pre>true</pre>',
];
const text = [blocks, ...fragments].join('\n\n');
const expected = { 'a.b': '  😀\n<&>\r\n', items: [false, null, -0, '', {}, []], '': 'true' };
const representative = [
  { name: 'вложенные типы и буквальные пути', value: expected },
  { name: 'длинная multiline Unicode строка', value: '  Юникод 😀 é\n<&>\r\n'.repeat(64) },
  {
    name: 'длинный ключ и безопасный __proto__',
    value: { ['ключ[/]😀'.repeat(48)]: 'tail', ['__proto__']: { constructor: false } },
  },
  {
    name: 'пустые контейнеры и скаляры',
    value: [[], {}, null, false, true, 0, -0, -4.25, 'false'],
  },
  { name: 'корневое число', value: -0 },
  {
    name: 'экранированные заголовки фрагментов',
    value: 'Текст 1, позиция 0:\n<pre>not a frame</pre>',
  },
];

describe('test-only prose decoder', () => {
  it('восстанавливает независимый literal oracle: пути, порядок, escaping, Unicode и типы', () => {
    expect(decode(text)).toEqual(expected);
  });

  it('порядок доставки фрагментов не заменяет их числовые позиции', () => {
    expect(decode([blocks, ...fragments.toReversed()].join('\n\n'))).toEqual(expected);
  });

  it('позиции сортируются численно и стабильно, а ID не смешиваются после числового приведения', () => {
    const input = [
      'Значение 0 — строка; родитель корень.',
      'Текст 00, позиция 0:\n<pre>&#999999999;</pre>',
      'Текст 0, позиция 10:\n<pre>E</pre>',
      'Текст 0, позиция 2:\n<pre>C</pre>',
      'Текст 0, позиция 0:\n<pre>A</pre>',
      'Текст 0, позиция 2:\n<pre>D</pre>',
      'Текст 0, позиция 1:\n<pre>B</pre>',
    ].join('\n');
    expect(decode(input)).toBe('ABCDE');
  });

  it.each([
    { name: 'недостающий fragment', input: text.replace(fragments[2] ?? '', '') },
    { name: 'повреждённый payload', input: text.replace('&#60;&#38;&#62;', 'changed') },
    {
      name: 'переставленные позиции payload',
      input: text
        .replace('Текст 1, позиция 0:', 'Текст 1, позиция 5:')
        .replace('Текст 1, позиция 5:\n<pre>&#60;', 'Текст 1, позиция 0:\n<pre>&#60;'),
    },
    { name: 'повреждённый ключ', input: text.replace('a&#46;b', 'different.key') },
  ])('$name не проходит исходный expected reconstruction', ({ input }) => {
    expect(decode(input)).not.toEqual(expected);
  });

  it.each(representative)(
    '$name: bounded encoder round-trip сохраняет exact expected',
    ({ value }) => {
      expect(decode(proseUnits(value, 256).join('\n'))).toEqual(value);
    },
  );

  it('число полных поисков prose не растёт с числом строк и ключей', () => {
    const value = Object.fromEntries(
      Array.from({ length: 48 }, (_, id) => [
        `field.${id}`,
        { text: `Юникод 😀 ${id}`, values: [false, null, id] },
      ]),
    );
    const input = proseUnits(value, 256).join('\n');
    const scans = vi.spyOn(String.prototype, 'matchAll');
    let actual: unknown;
    let count = 0;
    try {
      actual = decode(input);
      count = scans.mock.calls.length;
    } finally {
      scans.mockRestore();
    }
    expect(actual).toEqual(value);
    expect(count).toBeLessThanOrEqual(2);
  });
});
