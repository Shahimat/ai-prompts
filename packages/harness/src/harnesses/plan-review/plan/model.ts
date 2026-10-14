import { parse } from 'yaml';
import { isRecord } from '#shared/guards';

export const SCRIPT_SECTIONS = ['Схема', 'Точки улучшения'] as const;
export const REQUIRED_SECTIONS = ['Цель', 'Пункты', 'За горизонтом'] as const;
export const SECTION_ORDER = ['Цель', 'Схема', 'Пункты', 'За горизонтом', 'Точки улучшения'];
export const PLAN_STATUSES = ['draft', 'awaiting-user', 'approved'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const ITEM_KINDS = { T: 'task', S: 'spike' } as const;
export const TASK_FIELDS = ['Тип', 'Зависит от', 'Мотивация', 'DoD'] as const;
export const SPIKE_FIELDS = ['Тип', 'Вопрос', 'Ожидаемое решение', 'Таймбокс'] as const;

export interface PlanItem {
  id: string;
  prefix: 'T' | 'S';
  title: string;
  fields: Record<string, string>;
  dod: string[];
  deps: string[];
  raw: string;
  line: number;
}

export interface PlanSection {
  name: string;
  raw: string;
  line: number;
}

export interface PlanModel {
  frontmatter: Record<string, unknown>;
  frontmatterRaw: string;
  title: string | undefined;
  sections: PlanSection[];
  items: PlanItem[];
  duplicateIds: string[];
}

interface Block {
  kind: 'frontmatter' | 'preamble' | 'section' | 'item';
  name: string;
  raw: string;
  line: number;
}

const ITEM_HEADING = /^### ([TS])(\d+)\. (.*)$/;

function linesOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function blocks(text: string): Block[] {
  const lines = linesOf(text);
  const result: Block[] = [];
  let i = 0;
  if (lines[0]?.trimEnd() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && l.trimEnd() === '---');
    if (end > 0) {
      result.push({
        kind: 'frontmatter',
        name: '',
        raw: lines.slice(0, end + 1).join(''),
        line: 1,
      });
      i = end + 1;
    }
  }
  let current: Block = { kind: 'preamble', name: '', raw: '', line: i + 1 };
  let fence = false;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const bare = line.trimEnd();
    if (bare.startsWith('```')) fence = !fence;
    const heading = fence ? null : /^(##|###) (.*)$/.exec(bare);
    if (heading !== null) {
      result.push(current);
      current = {
        kind: heading[1] === '##' ? 'section' : 'item',
        name: (heading[2] ?? '').trim(),
        raw: '',
        line: i + 1,
      };
    }
    current.raw += line;
  }
  result.push(current);
  return result.filter((b) => b.raw !== '' || b.kind !== 'preamble');
}

function parseItem(block: Block): PlanItem | null {
  const heading = ITEM_HEADING.exec(block.raw.split('\n')[0]?.trimEnd() ?? '');
  if (heading === null) return null;
  const prefix = heading[1] === 'T' ? 'T' : 'S';
  const fields: Record<string, string> = {};
  const dod: string[] = [];
  let inDod = false;
  for (const line of block.raw.split('\n').slice(1)) {
    const field = /^- ([^:]+):\s*(.*)$/.exec(line.trimEnd());
    if (field !== null) {
      const key = (field[1] ?? '').trim();
      fields[key] = (field[2] ?? '').trim();
      inDod = key === 'DoD';
      continue;
    }
    const check = /^\s+- \[[ xX]\] (.*)$/.exec(line.trimEnd());
    if (inDod && check !== null) dod.push((check[1] ?? '').trim());
  }
  const depsText = fields['Зависит от'] ?? '';
  const deps = depsText
    .split(/[,\s]+/)
    .map((d) => d.trim())
    .filter((d) => d !== '' && d !== '—' && d !== '-');
  return {
    id: `${prefix}${heading[2] ?? ''}`,
    prefix,
    title: (heading[3] ?? '').trim(),
    fields,
    dod,
    deps,
    raw: block.raw,
    line: block.line,
  };
}

export function parsePlan(text: string): PlanModel {
  const all = blocks(text);
  const fmBlock = all.find((b) => b.kind === 'frontmatter');
  let frontmatter: Record<string, unknown> = {};
  if (fmBlock !== undefined) {
    try {
      const data: unknown = parse(fmBlock.raw.replace(/^---\r?\n/, '').replace(/---\s*$/, ''));
      if (isRecord(data)) frontmatter = data;
    } catch {
      frontmatter = {};
    }
  }
  const preamble = all.find((b) => b.kind === 'preamble');
  const title = preamble === undefined ? undefined : /^# (.+)$/m.exec(preamble.raw)?.[1]?.trim();
  const items = all.flatMap((b) => {
    if (b.kind !== 'item') return [];
    const item = parseItem(b);
    return item === null ? [] : [item];
  });
  const seen = new Set<string>();
  const duplicateIds = items.filter((i) => seen.size === seen.add(i.id).size).map((i) => i.id);
  return {
    frontmatter,
    frontmatterRaw: fmBlock?.raw ?? '',
    title,
    sections: all
      .filter((b) => b.kind === 'section')
      .map((b) => ({ name: b.name, raw: b.raw, line: b.line })),
    items,
    duplicateIds,
  };
}

export function malformedItems(text: string): { line: number; heading: string }[] {
  return blocks(text)
    .filter((b) => b.kind === 'item' && parseItem(b) === null)
    .map((b) => ({ line: b.line, heading: b.name }));
}

export function serializeBlocks(text: string): string {
  return blocks(text)
    .map((b) => b.raw)
    .join('');
}

export function setFrontmatter(text: string, key: string, value: string): string {
  const all = blocks(text);
  const fm = all.find((b) => b.kind === 'frontmatter');
  if (fm === undefined) {
    return `---\n${key}: ${value}\n---\n${text}`;
  }
  const lines = linesOf(fm.raw);
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (at >= 0) lines[at] = `${key}: ${value}\n`;
  else lines.splice(lines.length - 1, 0, `${key}: ${value}\n`);
  fm.raw = lines.join('');
  return all.map((b) => b.raw).join('');
}

export function replaceSection(text: string, name: string, body: string): string {
  const all = blocks(text);
  const content = `## ${name}\n\n${body.trimEnd()}\n\n`;
  const at = all.findIndex((b) => b.kind === 'section' && b.name === name);
  if (at >= 0) {
    const block = all[at];
    if (block !== undefined) block.raw = content;
  } else {
    const rank = SECTION_ORDER.indexOf(name);
    const next = all.findIndex(
      (b) => b.kind === 'section' && SECTION_ORDER.indexOf(b.name) > rank && rank >= 0,
    );
    const block: Block = { kind: 'section', name, raw: content, line: 0 };
    if (next >= 0) all.splice(next, 0, block);
    else {
      const last = all.at(-1);
      if (last !== undefined && !last.raw.endsWith('\n\n')) last.raw = `${last.raw.trimEnd()}\n\n`;
      all.push(block);
    }
  }
  return all.map((b) => b.raw).join('');
}

export function withoutScriptSections(text: string): string {
  return blocks(text)
    .filter((b) => !(b.kind === 'section' && SCRIPT_SECTIONS.some((s) => s === b.name)))
    .map((b) => b.raw)
    .join('');
}

export function withDependents(items: PlanItem[], ids: Iterable<string>): Set<string> {
  const result = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      if (!result.has(item.id) && item.deps.some((d) => result.has(d))) {
        result.add(item.id);
        grew = true;
      }
    }
  }
  return result;
}

export function changedParts(before: string, after: string): string[] {
  const a = parsePlan(before);
  const b = parsePlan(after);
  const changed: string[] = [];
  const ids = new Set([...a.items.map((i) => i.id), ...b.items.map((i) => i.id)]);
  for (const id of ids) {
    const x = a.items.find((i) => i.id === id)?.raw.trimEnd();
    const y = b.items.find((i) => i.id === id)?.raw.trimEnd();
    if (x !== y) changed.push(id);
  }
  const names = new Set([...a.sections.map((s) => s.name), ...b.sections.map((s) => s.name)]);
  for (const name of names) {
    if (SCRIPT_SECTIONS.some((s) => s === name)) continue;
    const x = a.sections.find((s) => s.name === name)?.raw.trimEnd();
    const y = b.sections.find((s) => s.name === name)?.raw.trimEnd();
    if (x !== y) changed.push(`## ${name}`);
  }
  if (a.title !== b.title) changed.push('# заголовок');
  return changed;
}

export function dependencyMermaid(items: PlanItem[]): string {
  const lines = ['```mermaid', 'flowchart LR'];
  const linked = new Set<string>();
  for (const item of items) {
    for (const dep of item.deps) {
      lines.push(`    ${dep} --> ${item.id}`);
      linked.add(dep);
      linked.add(item.id);
    }
  }
  for (const item of items) if (!linked.has(item.id)) lines.push(`    ${item.id}`);
  lines.push('```');
  return lines.join('\n');
}
