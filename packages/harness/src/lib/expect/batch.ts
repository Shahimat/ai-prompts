// expect:judge-clean-context
import { isRecord } from '../../shared/guards.ts';
import { containsQuote } from './evidence.ts';
import type { PendingItem } from './judge.ts';
import { isContradictions, isUnmeasurable, type LintVerdict, type Verdict } from './verdicts.ts';

export interface BatchLimits {
  maxItems: number;
  maxBytes: number;
}

export const DEFAULT_LIMITS: BatchLimits = { maxItems: 25, maxBytes: 80_000 };

export interface Batch {
  items: PendingItem[];
  /** Уникальные доказательства пакета — судья читает каждое один раз. */
  refs: string[];
  bytes: number;
}

/**
 * Пакеты для судьи: ожидания с одинаковыми доказательствами — вместе,
 * группы складываются в пакеты до лимита вопросов и объёма доказательств.
 */
export function planBatches(items: PendingItem[], limits: BatchLimits = DEFAULT_LIMITS): Batch[] {
  const groups = new Map<string, PendingItem[]>();
  for (const item of [...items].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const key = item.evidence
      .map((e) => e.ref)
      .sort()
      .join('\n');
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const batches: Batch[] = [];
  const sizes = new Map<string, number>();
  const bytesOf = (refs: Set<string>): number =>
    [...refs].reduce((n, r) => n + (sizes.get(r) ?? 0), 0);
  let current: { items: PendingItem[]; refs: Set<string> } = { items: [], refs: new Set() };
  const flush = (): void => {
    if (current.items.length === 0) return;
    batches.push({
      items: current.items,
      refs: [...current.refs].sort(),
      bytes: bytesOf(current.refs),
    });
    current = { items: [], refs: new Set() };
  };
  for (const group of groups.values()) {
    for (const e of group[0]?.evidence ?? []) sizes.set(e.ref, e.bytes);
    for (const item of group) {
      const refs = new Set([...current.refs, ...item.evidence.map((e) => e.ref)]);
      if (
        current.items.length >= limits.maxItems ||
        (current.items.length > 0 && bytesOf(refs) > limits.maxBytes)
      )
        flush();
      current.items.push(item);
      for (const e of item.evidence) current.refs.add(e.ref);
    }
  }
  flush();
  return batches;
}

/** `texts` — текст якорных доказательств `@KEY`: они вставляются в задание целиком. */
export function renderBatch(
  batch: Batch,
  answerFile: string,
  texts: Map<string, string> = new Map(),
): string {
  const lines = [
    '# Пакет для судьи ожиданий',
    '',
    'Ты — судья. Прочитай доказательства (каждое один раз) и ответь на',
    'каждый вопрос: выполнено ли утверждение — да (true) или нет (false).',
    'Отвечай только по доказательствам, без догадок.',
    '',
    'Для каждого ответа — дословная цитата (8–300 символов) из одного',
    'доказательства и его ссылка (`ref`). Цитата проверяется программно:',
    'не найдена в тексте — ответ отклоняется. Для «нет» — цитата того, что',
    'противоречит или ближе всего к утверждению, и причина.',
    '',
    `Ответ — JSON-массив в файл \`${answerFile}\`:`,
    '',
    '```json',
    '[{"id": "<id>", "verdict": true, "ref": "<ref>", "quote": "<цитата>", "reason": "<одна строка>"}]',
    '```',
    '',
    '## Доказательства',
    '',
    'Ссылка `path#Заголовок` — раздел markdown с этим заголовком;',
    '`@KEY` — размеченные области реализации, их текст приведён ниже.',
    '',
    ...batch.refs.map((r) => `- \`${r}\``),
    '',
    ...batch.refs
      .filter((r) => r.startsWith('@'))
      .flatMap((r) => [`### \`${r}\``, '', '````text', texts.get(r) ?? '', '````', '']),
    '## Вопросы',
    '',
  ];
  for (const item of batch.items) {
    lines.push(`- \`${item.id}\` — ${item.question.split(' > ').join(' → ')}`);
    lines.push(`  доказательства: ${item.evidence.map((e) => `\`${e.ref}\``).join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

export interface Answer {
  id: string;
  verdict: boolean;
  ref: string;
  quote: string;
  reason: string;
}

export interface ApplyResult {
  accepted: Record<string, Verdict>;
  rejected: { id: string; reason: string }[];
}

/** Проверяет ответы судьи; цитата должна дословно встречаться в доказательстве. */
export function applyAnswers(
  items: PendingItem[],
  answers: unknown,
  evidenceText: Map<string, string>,
  now: Date,
): ApplyResult {
  const result: ApplyResult = { accepted: {}, rejected: [] };
  if (!Array.isArray(answers)) {
    result.rejected.push({ id: '*', reason: 'ответ — не JSON-массив' });
    return result;
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  // Поля ответа — строки; нестроковое значение считается отсутствующим.
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');
  for (const entry of answers) {
    const raw = isRecord(entry) ? entry : {};
    const id = text(raw['id']);
    const item = byId.get(id);
    if (item === undefined) {
      result.rejected.push({ id, reason: 'неизвестный id' });
      continue;
    }
    const verdict = raw['verdict'];
    if (typeof verdict !== 'boolean') {
      result.rejected.push({ id, reason: 'verdict — не true/false' });
      continue;
    }
    const ref = text(raw['ref']);
    if (!item.evidence.some((e) => e.ref === ref)) {
      result.rejected.push({ id, reason: `ref «${ref}» не из доказательств вопроса` });
      continue;
    }
    const quote = text(raw['quote']);
    if (quote.length > 300 || !containsQuote(evidenceText.get(ref) ?? '', quote)) {
      result.rejected.push({ id, reason: 'цитата не найдена в доказательстве дословно' });
      continue;
    }
    result.accepted[id] = {
      question: item.question,
      evidence: Object.fromEntries(item.evidence.map((e) => [e.ref, e.sha])),
      verdict,
      quote,
      ref,
      reason: text(raw['reason']),
      at: now.toISOString().slice(0, 10),
    };
  }
  for (const item of items) {
    if (!(item.id in result.accepted) && !result.rejected.some((r) => r.id === item.id)) {
      result.rejected.push({ id: item.id, reason: 'нет ответа' });
    }
  }
  return result;
}

/** Смысловая проверка заголовков одного файла ожиданий — один проход. */
export function renderLintBatch(
  file: string,
  titles: { id: string; title: string }[],
  answerFile: string,
): string {
  return [
    '# Проверка заголовков ожиданий',
    '',
    `Файл: \`${file}\`. Каждая строка — ожидание человека к реализации.`,
    'Найди:',
    '',
    '1. Противоречия — пары ожиданий, которые не могут быть выполнены',
    '   одновременно.',
    '2. Неизмеримые — ожидания, на которые нельзя ответить «да/нет» или',
    '   числом (размыто, оценочно, без порога).',
    '',
    'Ничего не нашёл — пустые массивы. Не выдумывай проблем.',
    '',
    `Ответ — JSON в файл \`${answerFile}\`:`,
    '',
    '```json',
    '{"contradictions": [{"a": "<id>", "b": "<id>", "reason": "<строка>"}], "unmeasurable": [{"id": "<id>", "reason": "<строка>"}]}',
    '```',
    '',
    '## Ожидания',
    '',
    ...titles.map((t) => `- \`${t.id}\` — ${t.title}`),
    '',
  ].join('\n');
}

export function applyLintAnswer(
  titlesSha: string,
  ids: Set<string>,
  answer: unknown,
  now: Date,
): { verdict: LintVerdict | null; error: string | null } {
  const contradictions = isRecord(answer) ? answer['contradictions'] : undefined;
  const unmeasurable = isRecord(answer) ? answer['unmeasurable'] : undefined;
  if (!isContradictions(contradictions) || !isUnmeasurable(unmeasurable)) {
    return { verdict: null, error: 'ответ — не {contradictions: [], unmeasurable: []}' };
  }
  const bad = [
    ...contradictions.flatMap((c) => [c.a, c.b]),
    ...unmeasurable.map((u) => u.id),
  ].filter((id) => !ids.has(id));
  if (bad.length > 0) return { verdict: null, error: `неизвестные id: ${bad.join(', ')}` };
  return {
    verdict: {
      titles: titlesSha,
      contradictions,
      unmeasurable,
      at: now.toISOString().slice(0, 10),
    },
    error: null,
  };
}
