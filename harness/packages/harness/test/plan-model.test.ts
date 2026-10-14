import { describe, expect, it } from 'vitest';
import {
  acceptFindings,
  findingsSchema,
  parseCriteria,
  verdict,
  type Criterion,
  type Finding,
} from '../src/harness/plan-iter/plan/criteria.ts';
import { formalCheck } from '../src/harness/plan-iter/plan/formal.ts';
import {
  changedParts,
  dependencyMermaid,
  parsePlan,
  replaceSection,
  serializeBlocks,
  setFrontmatter,
  withDependents,
} from '../src/harness/plan-iter/plan/model.ts';
import { dependencySvg, renderPlanHtml } from '../src/harness/plan-iter/plan/render.ts';

export const PLAN = `---
harness: plan/iter
session: demo-1
status: draft
revision: 1
---
# Демо

## Цель

Проверить разбор.

## Пункты

### S1. Какой парсер?
- Тип: spike
- Вопрос: какой парсер взять
- Ожидаемое решение: выбор библиотеки
- Таймбокс: полдня

### T1. Каркас
- Тип: task
- Зависит от: —
- Мотивация: точка входа.
- DoD:
  - [ ] \`harness\` запускается
  - [x] есть тест

### T2. Разбор
- Тип: task
- Зависит от: S1, T1
- Мотивация: модель плана.
- DoD:
  - [ ] разбор обратим

\`\`\`text
### не пункт, внутри кода
\`\`\`

## За горизонтом

- Исполнение плана — после S1.
`;

describe('plan.md: модель', () => {
  it('разбор и запись обратно — побайтно тот же файл, в том числе CRLF и без перевода в конце', () => {
    for (const text of [PLAN, PLAN.replace(/\n/g, '\r\n'), PLAN.trimEnd(), '', '# x']) {
      expect(serializeBlocks(text)).toBe(text);
    }
  });

  it('пункты, поля, DoD и зависимости', () => {
    const plan = parsePlan(PLAN);
    expect(plan.title).toBe('Демо');
    expect(plan.frontmatter['revision']).toBe(1);
    expect(plan.items.map((i) => i.id)).toEqual(['S1', 'T1', 'T2']);
    const t2 = plan.items[2];
    expect(t2?.deps).toEqual(['S1', 'T1']);
    expect(plan.items[1]?.dod).toEqual(['`harness` запускается', 'есть тест']);
    expect(plan.items[1]?.deps).toEqual([]);
    expect(t2?.raw).toContain('### не пункт, внутри кода');
    expect(plan.sections.map((s) => s.name)).toEqual(['Цель', 'Пункты', 'За горизонтом']);
  });

  it('setFrontmatter меняет только своё поле', () => {
    const next = setFrontmatter(PLAN, 'status', 'approved');
    expect(parsePlan(next).frontmatter['status']).toBe('approved');
    expect(next.replace('status: approved', 'status: draft')).toBe(PLAN);
    expect(parsePlan(setFrontmatter(PLAN, 'extra', 'x')).frontmatter['extra']).toBe('x');
  });

  it('replaceSection вставляет раздел скрипта по порядку и заменяет его без трогания пунктов', () => {
    const once = replaceSection(PLAN, 'Схема', dependencyMermaid(parsePlan(PLAN).items));
    const names = parsePlan(once).sections.map((s) => s.name);
    expect(names).toEqual(['Цель', 'Схема', 'Пункты', 'За горизонтом']);
    expect(once).toContain('S1 --> T2');
    const twice = replaceSection(once, 'Схема', 'другое');
    expect(parsePlan(twice).items.map((i) => i.raw)).toEqual(
      parsePlan(PLAN).items.map((i) => i.raw),
    );
    const tail = replaceSection(PLAN, 'Точки улучшения', '- warn · T1');
    expect(parsePlan(tail).sections.at(-1)?.name).toBe('Точки улучшения');
  });

  it('changedParts видит пункты и разделы, но не разделы скрипта и frontmatter', () => {
    const edited = PLAN.replace('точка входа.', 'точка входа CLI.');
    expect(changedParts(PLAN, edited)).toEqual(['T1']);
    const scripted = replaceSection(setFrontmatter(PLAN, 'revision', '2'), 'Точки улучшения', 'x');
    expect(changedParts(PLAN, scripted)).toEqual([]);
    expect(changedParts(PLAN, PLAN.replace('Проверить разбор.', 'Иначе.'))).toEqual(['## Цель']);
  });

  it('withDependents — транзитивно', () => {
    expect([...withDependents(parsePlan(PLAN).items, ['S1'])].sort()).toEqual(['S1', 'T2']);
    expect([...withDependents(parsePlan(PLAN).items, ['T1'])].sort()).toEqual(['T1', 'T2']);
  });
});

describe('проверка 1a', () => {
  const ids = (text: string) => formalCheck(text, 'demo-1').map((f) => `${f.criterion}:${f.item}`);

  it('корректный план проходит', () => {
    expect(formalCheck(PLAN, 'demo-1')).toEqual([]);
  });

  it('frontmatter: нет, чужая сессия, плохой статус и ревизия', () => {
    expect(ids(PLAN.replace(/^---[\s\S]*?---\n/, ''))).toContain('frontmatter:plan');
    expect(formalCheck(PLAN, 'other')[0]?.text).toContain('session');
    expect(ids(PLAN.replace('status: draft', 'status: done'))).toEqual(['frontmatter:plan']);
    expect(ids(PLAN.replace('revision: 1', 'revision: x'))).toEqual(['frontmatter:plan']);
  });

  it('разделы: нет обязательного, нет пунктов, кривой заголовок пункта', () => {
    expect(ids(PLAN.replace('## Цель', '## Задача'))).toEqual(['sections:plan']);
    expect(ids(PLAN.replace('### T1. Каркас', '### Т1 Каркас'))).toContain('sections:plan');
  });

  it('поля пункта: нет поля, тип не по префиксу, задача без DoD', () => {
    expect(ids(PLAN.replace('- Таймбокс: полдня\n', ''))).toEqual(['item-fields:S1']);
    expect(
      ids(PLAN.replace('- Тип: task\n- Зависит от: —', '- Тип: spike\n- Зависит от: —')),
    ).toEqual(['item-fields:T1']);
    expect(ids(PLAN.replace('  - [ ] разбор обратим\n', ''))).toEqual(['item-fields:T2']);
  });

  it('зависимости: несуществующая и цикл', () => {
    expect(ids(PLAN.replace('Зависит от: S1, T1', 'Зависит от: S9'))).toEqual(['deps-exist:T2']);
    const cyclic = PLAN.replace('- Зависит от: —', '- Зависит от: T2');
    expect(ids(cyclic)).toEqual(['deps-acyclic:T1']);
  });

  it('дубли: ID, название, пункт DoD', () => {
    expect(ids(PLAN.replace('### T2. Разбор', '### T1. Разбор'))).toContain('duplicates:T1');
    expect(ids(PLAN.replace('### T2. Разбор', '### T2. Каркас'))).toEqual(['duplicates:T2']);
    expect(
      ids(
        PLAN.replace(
          '  - [ ] разбор обратим\n',
          '  - [ ] разбор обратим\n  - [ ] разбор обратим\n',
        ),
      ),
    ).toEqual(['duplicates:T2']);
  });
});

describe('критерии и вердикт', () => {
  const CRITERIA: Criterion[] = parseCriteria(
    `criteria:
  - { id: dod-checkable, stage: 1b, level: crit, text: DoD проверяем }
  - { id: no-filler, stage: 1b, level: warn, text: нет воды }
  - { id: typos, stage: 1b, level: info, text: нет опечаток }
  - { id: facts-project, stage: '2', level: crit, text: факты о проекте верны }
`,
    'criteria.yaml',
  );

  it('неверная форма criteria.yaml — ошибка с путём до поля', () => {
    expect(() =>
      parseCriteria('criteria:\n  - { id: X, stage: 1b, level: crit, text: t }\n', 'c.yaml'),
    ).toThrow('c.yaml/criteria/0/id');
    expect(() =>
      parseCriteria('criteria:\n  - { id: a, stage: 3, level: crit, text: t }\n', 'c.yaml'),
    ).toThrow('/criteria/0/stage');
  });

  it('уровень берётся из критерия, а не из ответа; чужой критерий и ответ вне схемы отклоняются', () => {
    const findings = acceptFindings(
      { findings: [{ criterion: 'no-filler', item: 'T1', text: 'вода' }] },
      CRITERIA,
      '1b',
    );
    expect(findings).toEqual([
      { criterion: 'no-filler', level: 'warn', stage: '1b', item: 'T1', text: 'вода' },
    ]);
    expect(() =>
      acceptFindings(
        { findings: [{ criterion: 'facts-project', item: 'T1', text: 'x' }] },
        CRITERIA,
        '1b',
      ),
    ).toThrow('ответ стадии 1b');
    expect(() =>
      acceptFindings(
        { findings: [{ criterion: 'no-filler', item: 'T1', text: 'x', level: 'info' }] },
        CRITERIA,
        '1b',
      ),
    ).toThrow();
    expect(() => acceptFindings('нет', CRITERIA, '1b')).toThrow();
    expect(findingsSchema(CRITERIA, '2')).toMatchObject({ type: 'object' });
  });

  it('бюджет стадии: crit 0, warn не больше 3, info не блокирует, бюджеты стадий не суммируются', () => {
    const f = (level: Finding['level'], stage: Finding['stage'] = '1b'): Finding => ({
      criterion: 'c',
      level,
      stage,
      item: 'T1',
      text: 't',
    });
    const budget = { crit: 0, warn: 3 };
    expect(
      verdict([f('warn'), f('warn'), f('warn'), f('info'), f('info')], budget).every((v) => v.pass),
    ).toBe(true);
    expect(verdict([f('warn'), f('warn'), f('warn'), f('warn')], budget)[0]?.pass).toBe(false);
    expect(verdict([f('crit', '2')], budget)[0]?.pass).toBe(false);
    const split = [f('warn'), f('warn'), f('warn'), f('warn', '2'), f('warn', '2')];
    expect(verdict(split, budget).every((v) => v.pass)).toBe(true);
  });
});

describe('HTML', () => {
  it('самодостаточный: без внешних скриптов, схема — SVG, разметка экранирована', () => {
    const html = renderPlanHtml(PLAN.replace('Проверить разбор.', 'Проверить <script>.'));
    expect(html).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org)/);
    expect(html).toContain('<svg');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('id="T2"');
    expect(html).toContain('checked');
    expect(dependencySvg(parsePlan(PLAN).items)).toContain('marker-end');
  });
});
