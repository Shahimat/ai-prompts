export const unescape = (text: string): string =>
  text.replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)));

export const decode = (text: string): unknown => {
  const values = new Map<number, unknown>();
  const blocks = [
    ...text.matchAll(
      /Значение (\d+) — (объект|список|строка|число|логическое|пустое); родитель (корень|\d+)(?:; элемент (\d+))?(?:; значение ([^\n]+))?\./g,
    ),
  ];
  const index = new Map<string, { position: number; text: string }[]>();
  for (const m of text.matchAll(/(Текст|Ключ) (\d+), позиция (\d+):\n<pre>([\s\S]*?)<\/pre>/g)) {
    const key = `${m[1] ?? ''} ${m[2] ?? ''}`;
    const parts = index.get(key) ?? [];
    parts.push({ position: Number(m[3]), text: m[4] ?? '' });
    index.set(key, parts);
  }
  for (const parts of index.values()) parts.sort((a, b) => a.position - b.position);
  const fragments = (label: string, id: number): string =>
    (index.get(`${label} ${id}`) ?? []).map((part) => unescape(part.text)).join('');
  for (const m of blocks) {
    const id = Number(m[1]);
    const value: unknown =
      m[2] === 'объект'
        ? {}
        : m[2] === 'список'
          ? []
          : m[2] === 'строка'
            ? fragments('Текст', id)
            : m[2] === 'пустое'
              ? null
              : m[2] === 'логическое'
                ? m[5] === 'true'
                : Number(m[5]);
    values.set(id, value);
    if (m[3] === 'корень') continue;
    const parent = values.get(Number(m[3]));
    if (Array.isArray(parent)) parent.push(value);
    else if (typeof parent === 'object' && parent !== null)
      Object.defineProperty(parent, fragments('Ключ', id), { value, enumerable: true });
  }
  return values.get(0);
};
