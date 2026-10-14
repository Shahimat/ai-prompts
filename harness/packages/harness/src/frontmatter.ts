import { parse } from 'yaml';
import { isRecord } from './guards.ts';

export type Frontmatter = Record<string, unknown>;

/** Приводит переводы строк к LF: результат не зависит от core.autocrlf. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Достаёт YAML-frontmatter: блок между `---` в первой строке и следующей
 * строкой `---`. Нет блока — `null`. Невалидный YAML — исключение.
 */
export function parseFrontmatter(text: string): Frontmatter | null {
  const lines = normalizeEol(text).split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const data: unknown = parse(lines.slice(1, end).join('\n'));
  if (data === null || data === undefined) return {};
  if (!isRecord(data)) throw new Error('frontmatter должен быть YAML-объектом');
  return data;
}
