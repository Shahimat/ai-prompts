// Проверка 1a: структура plan.md без модели. Её запускают планер
// (`session <id> check`), Stop-hook и автомат.

import type { Finding } from './criteria.ts';
import {
  ITEM_KINDS,
  malformedItems,
  parsePlan,
  PLAN_STATUSES,
  REQUIRED_SECTIONS,
  SPIKE_FIELDS,
  TASK_FIELDS,
  type PlanItem,
  type PlanModel,
} from './model.ts';

/** Критерии 1a, которые реализует скрипт; criteria.yaml ссылается на них по id. */
export const FORMAL_CRITERIA = [
  'frontmatter',
  'sections',
  'item-fields',
  'deps-exist',
  'deps-acyclic',
  'duplicates',
] as const;
export type FormalCriterion = (typeof FORMAL_CRITERIA)[number];

function finding(criterion: FormalCriterion, item: string, text: string): Finding {
  return { criterion, level: 'crit', stage: '1a', item, text };
}

function checkFrontmatter(plan: PlanModel, session: string | undefined): Finding[] {
  const fm = plan.frontmatter;
  const out: Finding[] = [];
  if (plan.frontmatterRaw === '') return [finding('frontmatter', 'plan', 'нет frontmatter')];
  if (fm['harness'] !== 'plan-review')
    out.push(finding('frontmatter', 'plan', 'harness: должно быть plan-review'));
  if (session !== undefined && fm['session'] !== session)
    out.push(finding('frontmatter', 'plan', `session: должно быть ${session}`));
  if (!PLAN_STATUSES.some((s) => s === fm['status']))
    out.push(finding('frontmatter', 'plan', `status: одно из ${PLAN_STATUSES.join(', ')}`));
  const revision = fm['revision'];
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1)
    out.push(finding('frontmatter', 'plan', 'revision: целое число ≥ 1'));
  return out;
}

function checkSections(text: string, plan: PlanModel): Finding[] {
  const out: Finding[] = [];
  if (plan.title === undefined) out.push(finding('sections', 'plan', 'нет заголовка «# Название»'));
  for (const name of REQUIRED_SECTIONS) {
    const count = plan.sections.filter((s) => s.name === name).length;
    if (count === 0) out.push(finding('sections', 'plan', `нет раздела «## ${name}»`));
    if (count > 1) out.push(finding('sections', 'plan', `раздел «## ${name}» повторяется`));
  }
  if (plan.items.length === 0)
    out.push(finding('sections', 'plan', 'в «Пунктах» нет ни одного пункта'));
  for (const m of malformedItems(text))
    out.push(
      finding(
        'sections',
        'plan',
        `строка ${m.line}: «### ${m.heading}» — пункт оформляется «### T1. Название» или «### S1. Вопрос»`,
      ),
    );
  return out;
}

function checkFields(item: PlanItem): Finding[] {
  const out: Finding[] = [];
  const kind = ITEM_KINDS[item.prefix];
  const required = item.prefix === 'T' ? TASK_FIELDS : SPIKE_FIELDS;
  if (item.title === '') out.push(finding('item-fields', item.id, 'пустое название'));
  for (const field of required) {
    if (field === 'DoD') continue;
    if ((item.fields[field] ?? '') === '')
      out.push(finding('item-fields', item.id, `нет поля «${field}»`));
  }
  const type = item.fields['Тип'];
  if (type !== undefined && type !== '' && type !== kind)
    out.push(finding('item-fields', item.id, `Тип: ${type}, а префикс ${item.prefix} — ${kind}`));
  if (item.prefix === 'T' && item.dod.length === 0)
    out.push(finding('item-fields', item.id, 'DoD: нужен хотя бы один пункт «- [ ] …»'));
  return out;
}

function checkDeps(plan: PlanModel): Finding[] {
  const out: Finding[] = [];
  const ids = new Set(plan.items.map((i) => i.id));
  for (const item of plan.items) {
    for (const dep of item.deps) {
      if (!ids.has(dep))
        out.push(finding('deps-exist', item.id, `зависит от несуществующего ${dep}`));
      if (dep === item.id) out.push(finding('deps-acyclic', item.id, 'зависит от самого себя'));
    }
  }
  // Цикл: обход в глубину с цветами.
  const color = new Map<string, 'grey' | 'black'>();
  const byId = new Map(plan.items.map((i) => [i.id, i]));
  const reported = new Set<string>();
  const visit = (id: string, stack: string[]): void => {
    if (color.get(id) === 'black') return;
    if (color.get(id) === 'grey') {
      const cycle = stack.slice(stack.indexOf(id));
      const key = [...cycle].sort().join(',');
      if (!reported.has(key) && cycle.length > 1) {
        reported.add(key);
        out.push(finding('deps-acyclic', id, `цикл зависимостей: ${[...cycle, id].join(' → ')}`));
      }
      return;
    }
    color.set(id, 'grey');
    for (const dep of byId.get(id)?.deps ?? []) if (byId.has(dep)) visit(dep, [...stack, id]);
    color.set(id, 'black');
  };
  for (const item of plan.items) visit(item.id, []);
  return out;
}

function checkDuplicates(plan: PlanModel): Finding[] {
  const out = plan.duplicateIds.map((id) => finding('duplicates', id, `ID ${id} повторяется`));
  const byTitle = new Map<string, string>();
  for (const item of plan.items) {
    const key = item.title.toLowerCase().replace(/\s+/g, ' ');
    const first = byTitle.get(key);
    if (first !== undefined && first !== item.id)
      out.push(finding('duplicates', item.id, `то же название, что у ${first}`));
    else byTitle.set(key, item.id);
  }
  for (const item of plan.items) {
    const seen = new Set<string>();
    for (const d of item.dod) {
      if (seen.has(d)) out.push(finding('duplicates', item.id, `пункт DoD повторяется: ${d}`));
      seen.add(d);
    }
  }
  return out;
}

/** Нарушения 1a; `session` — ожидаемое значение одноимённого поля frontmatter. */
export function formalCheck(text: string, session?: string): Finding[] {
  const plan = parsePlan(text);
  return [
    ...checkFrontmatter(plan, session),
    ...checkSections(text, plan),
    ...plan.items.flatMap(checkFields),
    ...checkDeps(plan),
    ...checkDuplicates(plan),
  ];
}

export function formatFinding(f: Finding): string {
  return `${f.level} [${f.stage}/${f.criterion}] ${f.item}: ${f.text}`;
}
