import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChangelogOptions } from '../config.ts';
import type { Diagnostic } from '../diagnostics.ts';
import { normalizeEol } from '../frontmatter.ts';

export const CHANGELOG_PATH = 'CHANGELOG.md';
const SEPARATOR = ' · ';
const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDate(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m === null) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const time = Date.UTC(y, mo - 1, d);
  const date = new Date(time);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d)
    return null;
  return time;
}

/**
 * Проверяет журнал решений. Формат записи:
 * `- YYYY-MM-DD · [tag] суть · почему`. До первой записи — свободный
 * текст (заголовок, пояснение), после — только записи и пустые строки.
 */
export function lintChangelog(
  text: string,
  options: ChangelogOptions,
  now: Date,
  file: string = CHANGELOG_PATH,
): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const latest = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS;
  const tagHint = `[${options.tags.join('|')}]`;
  let seenEntry = false;
  let prev: { time: number; date: string } | null = null;

  normalizeEol(text)
    .split('\n')
    .forEach((line, i) => {
      const report = (message: string): void => {
        diags.push({ file, line: i + 1, message });
      };
      if (line.trim() === '') return;
      if (!line.startsWith('- ')) {
        if (seenEntry) report('после первой записи допустимы только записи и пустые строки');
        return;
      }
      seenEntry = true;

      // Символы, а не UTF-16 и не байты: кириллица не должна считаться вдвое.
      const length = [...line].length;
      if (length > options.maxLine) report(`длина ${length} символов > ${options.maxLine}`);

      const parts = line.slice(2).split(SEPARATOR);
      if (parts.length !== 3) {
        report(
          `ожидается «- YYYY-MM-DD · ${tagHint} суть · почему»: частей через « · » ${parts.length}, нужно 3`,
        );
        return;
      }
      const [date, what, why] = parts as [string, string, string];

      const time = parseIsoDate(date);
      if (time === null) {
        report(`дата «${date}» — не YYYY-MM-DD или такого дня нет`);
      } else {
        if (time > latest) report(`дата ${date} в будущем`);
        if (prev !== null && time > prev.time)
          report(`порядок: ${date} новее предыдущей записи ${prev.date}`);
        prev = { time, date };
      }

      const tagged = /^\[([^\]]*)\] (.*\S.*)$/.exec(what);
      if (tagged === null) {
        report(`нет тега: суть начинается с ${tagHint}`);
      } else if (!options.tags.includes(tagged[1] ?? '')) {
        report(`тег [${tagged[1] ?? ''}] не из списка ${tagHint}`);
      }
      if (why.trim() === '') report('пустая часть «почему»');
    });
  return diags;
}

export async function checkChangelog(
  root: string,
  options: ChangelogOptions,
  now: Date,
): Promise<Diagnostic[]> {
  let text: string;
  try {
    text = await readFile(path.join(root, CHANGELOG_PATH), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [{ file: CHANGELOG_PATH, message: 'файл не найден' }];
    }
    throw error;
  }
  return lintChangelog(text, options, now);
}
