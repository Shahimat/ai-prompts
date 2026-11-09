import { isRecord } from '#shared/guards';

const markdownLabel = (text: string): string =>
  text.replace(/[\\[\]()*_`<>\r\n]/g, (ch) => `&#${ch.codePointAt(0)};`);

const escaped = (ch: string): string => {
  const code = ch.codePointAt(0);
  if (code === undefined) return '';
  return '<>&[]()`\\«»'.includes(ch) || (code < 32 && ch !== '\n') ? `&#${code};` : ch;
};

export const oldProseUnits = (value: unknown, cap: number): string[] => {
  if (cap < 256) throw new Error(`cap ${cap}: невозможный минимальный frame проекции`);
  const units: string[] = [];
  let next = 0;
  const text = (label: string, id: number, raw: string): void => {
    let offset = 0;
    let chunk: string[] = [];
    let bytes = 0;
    let length = 0;
    const emit = (): void => {
      units.push(`${label} ${id}, позиция ${offset}:\n<pre>${chunk.join('')}</pre>\n\n`);
      offset += length;
      chunk = [];
      bytes = 0;
      length = 0;
    };
    for (const ch of raw) {
      const part = escaped(ch);
      const size = Buffer.byteLength(part);
      if (bytes + size > cap - 128) emit();
      chunk.push(part);
      bytes += size;
      length++;
    }
    emit();
  };
  const visit = (data: unknown, parent: string, key?: string, index?: number): void => {
    const id = next++;
    const kind =
      data === null
        ? 'пустое'
        : Array.isArray(data)
          ? 'список'
          : isRecord(data)
            ? 'объект'
            : typeof data === 'string'
              ? 'строка'
              : typeof data === 'boolean'
                ? 'логическое'
                : typeof data === 'number' && Number.isFinite(data)
                  ? 'число'
                  : undefined;
    if (kind === undefined) throw new Error(`значение ${id}: неподдерживаемый тип факта`);
    const scalar =
      typeof data === 'number' || typeof data === 'boolean'
        ? `; значение ${Object.is(data, -0) ? '-0' : String(data)}`
        : '';
    units.push(
      `Значение ${id} — ${kind}; родитель ${parent}${index === undefined ? '' : `; элемент ${index}`}${scalar}.\n\n`,
    );
    if (key !== undefined) text('Ключ', id, key);
    if (typeof data === 'string') text('Текст', id, data);
    else if (Array.isArray(data))
      for (const [i, child] of data.entries()) visit(child, String(id), undefined, i);
    else if (isRecord(data))
      for (const field of Object.keys(data).sort()) visit(data[field], String(id), field);
  };
  visit(value, 'корень');
  return units;
};

export const oldBoundedPages = (
  units: string[],
  header: string,
  cap: number,
  prefix: 'page' | 'part',
): Map<string, string> => {
  const name = (index: number): string =>
    index === 0 ? 'index.md' : `${prefix}-${String(index).padStart(6, '0')}.md`;
  const footer = (index: number): string => `\nПродолжение: [далее](${name(index)}).\n`;
  const reserve = Buffer.byteLength(header + footer(999999));
  if (reserve >= cap) throw new Error(`cap ${cap}: невозможный минимальный frame страницы`);
  const bodies: string[] = [];
  let body = '';
  let bytes = reserve;
  for (const unit of units) {
    const size = Buffer.byteLength(unit);
    if (size + reserve > cap)
      throw new Error(`cap ${cap}: обязательная строка каталога или frame не помещается`);
    if (bytes + size > cap) {
      bodies.push(body);
      body = '';
      bytes = reserve;
    }
    body += unit;
    bytes += size;
  }
  bodies.push(body);
  if (bodies.length > 999999) throw new Error('слишком много страниц памяти');
  return new Map(
    bodies.map((text, i) => [
      name(i),
      `${header}${text}${i + 1 < bodies.length ? footer(i + 1) : ''}`,
    ]),
  );
};

export const oldProjectionFiles = (
  value: unknown,
  source: string,
  cap: number,
): Map<string, string> => {
  const header = `# Полная проекция\n\nИсточник: ${markdownLabel(source)}\n\n`;
  const pages = oldBoundedPages(
    oldProseUnits(value, cap - Buffer.byteLength(header) - 256),
    header,
    cap,
    'part',
  );
  const out = new Map<string, string>();
  const units: string[] = [];
  let index = 1;
  for (const text of pages.values()) {
    const name = `part-${String(index).padStart(6, '0')}.md`;
    const next = `part-${String(index + 1).padStart(6, '0')}.md`;
    out.set(
      name,
      text.replace(
        /\nПродолжение: \[далее\]\(part-\d{6}\.md\)\.\n$/,
        `\nПродолжение: [далее](${next}).\n`,
      ),
    );
    units.push(`- [Часть ${index}](${name})\n`);
    index++;
  }
  for (const [name, text] of oldBoundedPages(units, header, cap, 'page')) out.set(name, text);
  return out;
};
