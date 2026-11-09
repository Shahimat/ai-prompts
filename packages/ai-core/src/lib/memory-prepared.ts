import { isRecord } from '#shared/guards';
import { projectionFromUnits, projectionHeader } from '#lib/memory-projection';

export type PreparedProjection = { header: string; units: string[] } | { error: Error };

const sink = (cap: number) => {
  const units: string[] = [];
  let offset = 0;
  let chunk: string[] = [];
  let bytes = 0;
  let length = 0;
  let label = '';
  let id = 0;
  const emit = (): void => {
    units.push(`${label} ${id}, позиция ${offset}:\n<pre>${chunk.join('')}</pre>\n\n`);
    offset += length;
    chunk = [];
    bytes = 0;
    length = 0;
  };
  return {
    units,
    start: (nextLabel: string, nextId: number): void => {
      label = nextLabel;
      id = nextId;
      offset = 0;
    },
    part: (part: string, size: number): void => {
      if (bytes + size > cap - 128) emit();
      chunk.push(part);
      bytes += size;
      length++;
    },
    emit,
  };
};

export const prepareProse = (
  value: unknown,
  source: string,
  cap: number,
): { text: string; projection: PreparedProjection } => {
  const sealCap = cap - 512;
  if (sealCap < 256) throw new Error(`cap ${sealCap}: невозможный минимальный frame проекции`);
  const seal = sink(sealCap);
  const header = projectionHeader(source);
  const projectionCap = cap - Buffer.byteLength(header) - 256;
  const projection = projectionCap < 256 ? undefined : sink(projectionCap);
  const sinks = projection === undefined ? [seal] : [seal, projection];
  let next = 0;
  const text = (label: string, id: number, raw: string): void => {
    for (const target of sinks) target.start(label, id);
    for (const ch of raw) {
      const code = ch.codePointAt(0);
      const part =
        code === undefined
          ? ''
          : '<>&[]()`\\«»'.includes(ch) || (code < 32 && ch !== '\n')
            ? `&#${code};`
            : ch;
      const size = Buffer.byteLength(part);
      for (const target of sinks) target.part(part, size);
    }
    for (const target of sinks) target.emit();
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
    const unit = `Значение ${id} — ${kind}; родитель ${parent}${index === undefined ? '' : `; элемент ${index}`}${scalar}.\n\n`;
    for (const target of sinks) target.units.push(unit);
    if (key !== undefined) text('Ключ', id, key);
    if (typeof data === 'string') text('Текст', id, data);
    else if (Array.isArray(data))
      for (const [i, child] of data.entries()) visit(child, String(id), undefined, i);
    else if (isRecord(data))
      for (const field of Object.keys(data).sort()) visit(data[field], String(id), field);
  };
  visit(value, 'корень');
  return {
    text: seal.units.join(''),
    projection:
      projection === undefined
        ? { error: new Error(`cap ${projectionCap}: невозможный минимальный frame проекции`) }
        : { header, units: projection.units },
  };
};

export const preparedFiles = (prepared: PreparedProjection, cap: number): Map<string, string> => {
  if ('error' in prepared) throw prepared.error;
  return projectionFromUnits(prepared.units, prepared.header, cap);
};
