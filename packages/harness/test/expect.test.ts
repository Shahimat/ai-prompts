import { describe, expect, it } from 'vitest';
import {
  applyAnswers,
  applyLintAnswer,
  planBatches,
  renderBatch,
} from '../src/lib/expect/batch.ts';
import { containsQuote } from '../src/lib/expect/evidence.ts';
import type { PendingItem } from '../src/lib/expect/judge.ts';
import { lintTitles } from '../src/lib/expect/lint.ts';
import { codeBlock, extractSection } from '../src/lib/expect/repo.ts';

const NOW = new Date('2026-10-13T12:00:00Z');
const item = (id: string, refs: [string, number][]): PendingItem => ({
  id,
  question: `группа > ожидание ${id}`,
  evidence: refs.map(([ref, bytes]) => ({ ref, sha: `sha-${ref}`, bytes })),
});

describe('planBatches', () => {
  it('ожидания с общими доказательствами — в одном пакете, доказательство читается раз', () => {
    const batches = planBatches([
      item('a', [['x.md', 100]]),
      item('b', [['x.md', 100]]),
      item('c', [['y.md', 50]]),
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.refs).toEqual(['x.md', 'y.md']);
    expect(batches[0]?.bytes).toBe(150);
  });

  it('режет по числу вопросов и объёму доказательств', () => {
    const many = Array.from({ length: 5 }, (_, i) => item(`i${i}`, [['x.md', 10]]));
    expect(planBatches(many, { maxItems: 2, maxBytes: 1000 }).map((b) => b.items.length)).toEqual([
      2, 2, 1,
    ]);
    const big = [item('a', [['x.md', 600]]), item('b', [['y.md', 600]])];
    expect(planBatches(big, { maxItems: 10, maxBytes: 1000 })).toHaveLength(2);
  });

  it('одно большое доказательство не делится и не теряется', () => {
    expect(
      planBatches([item('a', [['huge.md', 10_000]])], { maxItems: 10, maxBytes: 1000 }),
    ).toHaveLength(1);
  });

  it('пакет описывает вопросы, доказательства и файл ответа', () => {
    const [batch] = planBatches([item('a', [['x.md#Раздел', 10]])]);
    if (batch === undefined) throw new Error('нет пакета');
    const text = renderBatch(batch, 'out.json');
    expect(text).toContain('`x.md#Раздел`');
    expect(text).toContain('`a` — группа → ожидание a');
    expect(text).toContain('`out.json`');
  });
});

describe('containsQuote', () => {
  it('игнорирует пробелы, переносы, регистр и маркеры markdown', () => {
    expect(
      containsQuote(
        'Строка до **120 символов**,\n  включая дату',
        'строка до 120 символов, включая дату',
      ),
    ).toBe(true);
    expect(containsQuote('abc def ghi', 'xyz qwe rty')).toBe(false);
    expect(containsQuote('коротко', 'кор')).toBe(false);
  });
});

describe('applyAnswers', () => {
  const items = [item('a', [['x.md', 1]]), item('b', [['x.md', 1]]), item('c', [['x.md', 1]])];
  const texts = new Map([['x.md', 'Memory агента запрещена полностью.']]);

  it('принимает ответ с настоящей цитатой и отклоняет выдуманную', () => {
    const result = applyAnswers(
      items,
      [
        { id: 'a', verdict: true, ref: 'x.md', quote: 'Memory агента запрещена', reason: '' },
        { id: 'b', verdict: true, ref: 'x.md', quote: 'memory разрешена в CI', reason: '' },
        { id: 'zzz', verdict: true, ref: 'x.md', quote: 'Memory агента запрещена', reason: '' },
      ],
      texts,
      NOW,
    );
    expect(Object.keys(result.accepted)).toEqual(['a']);
    expect(result.accepted['a']).toMatchObject({
      verdict: true,
      evidence: { 'x.md': 'sha-x.md' },
      at: '2026-10-13',
    });
    expect(result.rejected).toEqual([
      { id: 'b', reason: 'цитата не найдена в доказательстве дословно' },
      { id: 'zzz', reason: 'неизвестный id' },
      { id: 'c', reason: 'нет ответа' },
    ]);
  });

  it('ref не из доказательств вопроса и verdict не boolean — отклонены', () => {
    const r = applyAnswers(
      items.slice(0, 2),
      [
        { id: 'a', verdict: true, ref: 'other.md', quote: 'Memory агента запрещена' },
        { id: 'b', verdict: 'yes', ref: 'x.md', quote: 'Memory агента запрещена' },
      ],
      texts,
      NOW,
    );
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'ref «other.md» не из доказательств вопроса',
      'verdict — не true/false',
    ]);
  });

  it('не массив — один отказ', () => {
    expect(applyAnswers(items, { a: 1 }, texts, NOW).rejected).toEqual([
      { id: '*', reason: 'ответ — не JSON-массив' },
    ]);
  });
});

describe('applyLintAnswer', () => {
  it('проверяет формат и id', () => {
    const ids = new Set(['a', 'b']);
    expect(
      applyLintAnswer('sha', ids, { contradictions: [], unmeasurable: [] }, NOW).verdict,
    ).toEqual({
      titles: 'sha',
      contradictions: [],
      unmeasurable: [],
      at: '2026-10-13',
    });
    expect(
      applyLintAnswer(
        'sha',
        ids,
        { contradictions: [{ a: 'a', b: 'x', reason: '' }], unmeasurable: [] },
        NOW,
      ).error,
    ).toBe('неизвестные id: x');
    expect(applyLintAnswer('sha', ids, [], NOW).error).toMatch(/не \{contradictions/);
  });
});

describe('lintTitles', () => {
  const t = (title: string, path = ['g']): { file: string; path: string[]; title: string } => ({
    file: 'f.expect.ts',
    path,
    title,
  });

  it('длина, размытые слова, дубли', () => {
    expect(
      lintTitles([
        t('a'.repeat(201)),
        t('агент отвечает быстро и удобно'),
        t('строка ≤ 120 символов'),
        t('строка ≤ 120 символов'),
      ]).map((d) => d.message),
    ).toEqual([
      'длина 201 > 200 символов — раздели ожидание',
      'размыто: удобно, быстро — нужен порог, число или да/нет',
      'дубль',
    ]);
    expect(lintTitles([t('a'.repeat(201)), t('быстро')]).map((d) => d.level)).toEqual([
      'crit',
      'warn',
    ]);
  });

  it('корректные ожидания проходят', () => {
    expect(
      lintTitles([t('AGENTS.md — не больше 150 строк'), t('memory выключена', ['другая группа'])]),
    ).toEqual([]);
  });

  it('слово внутри другого слова — не размытость', () => {
    expect(lintTitles([t('проверка хорошопрописанного id')])).toEqual([]);
  });
});

describe('extractSection / codeBlock', () => {
  const md = '# A\nintro\n## B\nb text\n```\n## не заголовок\n```\n### C\nc\n## D\nd\n';

  it('раздел до заголовка того же уровня, с подразделами, без заголовков в коде', () => {
    expect(extractSection(md, 'B')).toBe('## B\nb text\n```\n## не заголовок\n```\n### C\nc');
    expect(extractSection(md, 'D')).toBe('## D\nd');
    expect(extractSection(md, 'не заголовок')).toBeNull();
  });

  it('блок кода по языку и префиксу, в том числе в ```` ограде', () => {
    const text = 'x\n```yaml\na: 1\n```\n````markdown\n# T\n```\ninner\n```\n````\n';
    expect(codeBlock(text, 'yaml', 'a:')).toBe('a: 1');
    expect(codeBlock(text, 'markdown', '# ')).toBe('# T\n```\ninner\n```');
    expect(codeBlock(text, 'yaml', 'b:')).toBeNull();
    const listed = '1. шаг:\n\n   ```yaml\n   key: x\n   list:\n     - a\n   ```\n';
    expect(codeBlock(listed, 'yaml', 'key:')).toBe('key: x\nlist:\n  - a');
  });
});

describe('якоря expect:KEY', async () => {
  const { markdownRegions, fileAnchorKeys } = await import('../src/lib/expect/anchors.ts');

  it('области в markdown, несколько ключей и повтор ключа', () => {
    const md = [
      '# Правила',
      '<!-- expect:ticket-commits -->',
      'шаг — один коммит',
      '<!-- /expect:ticket-commits -->',
      'вне якоря',
      '<!-- expect:docs-readonly -->',
      'документация только читается',
      '<!-- /expect:docs-readonly -->',
      '<!-- expect:ticket-commits -->',
      'amend для подряд одного типа',
      '<!-- /expect:ticket-commits -->',
    ].join('\n');
    expect(markdownRegions(md, 'a.md')).toEqual([
      { key: 'ticket-commits', path: 'a.md', text: 'шаг — один коммит' },
      { key: 'docs-readonly', path: 'a.md', text: 'документация только читается' },
      { key: 'ticket-commits', path: 'a.md', text: 'amend для подряд одного типа' },
    ]);
  });

  it('разметка внутри блоков кода — пример, не якорь', () => {
    const md = ['```markdown', '<!-- expect:x -->', 'пример', '<!-- /expect:x -->', '```'].join(
      '\n',
    );
    expect(markdownRegions(md, 'a.md')).toEqual([]);
  });

  it('незакрытый якорь — ошибка', () => {
    expect(() => markdownRegions('<!-- expect:x -->\nтекст', 'a.md')).toThrow(/expect:x не закрыт/);
  });

  it('файловый якорь в YAML — строка-комментарий', () => {
    expect(fileAnchorKeys('key: a\n# expect:ticket-commits:project\nrule: |\n  x\n')).toEqual([
      'ticket-commits:project',
    ]);
    expect(fileAnchorKeys('note: "# expect:x" в строке\n')).toEqual([]);
    expect(fileAnchorKeys('// expect:memory-off\nexport const a = 1;\n', '//')).toEqual([
      'memory-off',
    ]);
  });
});

describe('pruneStore', async () => {
  const { pruneStore } = await import('../src/lib/expect/verdicts.ts');
  const v = {
    question: 'q',
    evidence: {},
    verdict: true,
    quote: 'x',
    ref: 'r',
    reason: '',
    at: '2026-10-13',
  };
  const l = { titles: 'sha', contradictions: [], unmeasurable: [], at: '2026-10-13' };

  it('удаляет вердикты без живого ожидания и проверки удалённых файлов', () => {
    const store = { verdicts: { a: v, old: v }, lint: { 'x.expect.ts': l, 'gone.expect.ts': l } };
    expect(pruneStore(store, new Set(['a']), new Set(['x.expect.ts']))).toBe(2);
    expect(Object.keys(store.verdicts)).toEqual(['a']);
    expect(Object.keys(store.lint)).toEqual(['x.expect.ts']);
  });
});
