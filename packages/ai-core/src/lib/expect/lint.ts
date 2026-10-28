export interface Title {
  file: string;
  path: string[];
  title: string;
}

export const MAX_TITLE = 200;

const VAGUE = [
  'удобно',
  'удобный',
  'быстро',
  'достаточно',
  'при необходимости',
  'по возможности',
  'и т.п',
  'и т.д',
  'стараться',
  'желательно',
  'хорошо',
  'красиво',
  'понятно',
  'оптимально',
  'как можно',
];

export interface TitleIssue {
  title: Title;
  message: string;
  level: 'crit' | 'warn';
}

export function lintTitles(titles: Title[]): TitleIssue[] {
  const out: TitleIssue[] = [];
  const seen = new Set<string>();
  for (const t of titles) {
    const full = `${t.file} :: ${[...t.path, t.title].join(' > ')}`;
    const length = [...t.title].length;
    if (length > MAX_TITLE)
      out.push({
        title: t,
        message: `длина ${length} > ${MAX_TITLE} символов — раздели ожидание`,
        level: 'crit',
      });
    const lower = t.title.toLowerCase();
    const vague = VAGUE.filter((w) =>
      new RegExp(`(^|[^а-яё])${w.replace('.', '\\.')}($|[^а-яё])`).test(lower),
    );
    if (vague.length > 0)
      out.push({
        title: t,
        message: `размыто: ${vague.join(', ')} — нужен порог, число или да/нет`,
        level: 'warn',
      });
    if (seen.has(full)) out.push({ title: t, message: 'дубль', level: 'crit' });
    seen.add(full);
  }
  return out;
}
