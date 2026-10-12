import { describe, expect, it } from 'vitest';
import { lintChangelog } from '../src/checks/changelog.ts';
import { DEFAULT_CHANGELOG } from '../src/config.ts';

const NOW = new Date('2026-10-13T12:00:00Z');
const HEADER = '# Журнал решений\n\nФормат: «когда» и «почему».\n\n';

function lint(body: string, options = DEFAULT_CHANGELOG): string[] {
  return lintChangelog(HEADER + body, options, NOW).map((d) => `${d.line}: ${d.message}`);
}

describe('lintChangelog', () => {
  it('принимает корректный журнал', () => {
    expect(
      lint(
        '- 2026-10-13 · [arch] harness на TS · кроссплатформенность\n' +
          '- 2026-10-13 · [dep] Node 24 · type stripping\n\n' +
          '- 2026-09-01 · [milestone] первый релиз · готово\n',
      ),
    ).toEqual([]);
  });

  it('пустой журнал и журнал без записей — ok', () => {
    expect(lintChangelog('', DEFAULT_CHANGELOG, NOW)).toEqual([]);
    expect(lint('')).toEqual([]);
  });

  it('считает длину в символах, а не в байтах', () => {
    const prefix = '- 2026-10-13 · [arch] ';
    const suffix = ' · я';
    const fill = (n: number): string => 'ж'.repeat(n - prefix.length - suffix.length);
    expect(lint(`${prefix}${fill(120)}${suffix}\n`)).toEqual([]);
    expect(lint(`${prefix}${fill(121)}${suffix}\n`)).toEqual(['5: длина 121 символов > 120']);
  });

  it('берёт лимит и теги из параметров', () => {
    const options = { maxLine: 30, tags: ['infra'] };
    expect(lint('- 2026-10-13 · [infra] a · b\n', options)).toEqual([]);
    expect(lint('- 2026-10-13 · [arch] длинная суть · почему\n', options)).toEqual([
      '5: длина 43 символов > 30',
      '5: тег [arch] не из списка [infra]',
    ]);
  });

  it('требует ровно три части через « · »', () => {
    expect(lint('- 2026-10-13 · [arch] без причины\n')).toEqual([
      '5: ожидается «- YYYY-MM-DD · [arch|stack|dep|milestone] суть · почему»: частей через « · » 2, нужно 3',
    ]);
    expect(lint('- 2026-10-13 · [arch] a · b · c\n')).toHaveLength(1);
    expect(lint('- 2026-10-13 - [arch] a - b\n')[0]).toMatch(/частей через « · » 1/);
  });

  it('проверяет тег', () => {
    expect(lint('- 2026-10-13 · суть без тега · почему\n')).toEqual([
      '5: нет тега: суть начинается с [arch|stack|dep|milestone]',
    ]);
    expect(lint('- 2026-10-13 · [fix] суть · почему\n')).toEqual(['5: тег [fix] не из списка [arch|stack|dep|milestone]']);
    expect(lint('- 2026-10-13 · [arch] · почему\n')).toEqual(['5: нет тега: суть начинается с [arch|stack|dep|milestone]']);
  });

  it('проверяет «почему»', () => {
    expect(lint('- 2026-10-13 · [arch] суть ·  \n')).toEqual(['5: пустая часть «почему»']);
  });

  it('проверяет дату', () => {
    expect(lint('- 2026-02-30 · [arch] a · b\n')).toEqual(['5: дата «2026-02-30» — не YYYY-MM-DD или такого дня нет']);
    expect(lint('- 13.10.2026 · [arch] a · b\n')).toHaveLength(1);
    expect(lint('- 2026-10-14 · [arch] a · b\n')).toEqual([]);
    expect(lint('- 2026-10-15 · [arch] a · b\n')).toEqual(['5: дата 2026-10-15 в будущем']);
  });

  it('требует обратный хронологический порядок', () => {
    expect(lint('- 2026-09-01 · [arch] a · b\n- 2026-10-01 · [arch] a · b\n')).toEqual([
      '6: порядок: 2026-10-01 новее предыдущей записи 2026-09-01',
    ]);
  });

  it('после первой записи — только записи и пустые строки', () => {
    expect(lint('- 2026-10-13 · [arch] a · b\n  - вложенный пункт\nабзац\n\n## Раздел\n')).toEqual([
      '6: после первой записи допустимы только записи и пустые строки',
      '7: после первой записи допустимы только записи и пустые строки',
      '9: после первой записи допустимы только записи и пустые строки',
    ]);
  });

  it('номера строк не сбиваются от CRLF', () => {
    const text = '# Журнал\r\n\r\n- 2026-10-13 · [fix] a · b\r\n';
    expect(lintChangelog(text, DEFAULT_CHANGELOG, NOW).map((d) => d.line)).toEqual([3]);
  });
});
