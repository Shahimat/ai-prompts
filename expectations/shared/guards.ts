export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function parseJson(text: string): unknown {
  return JSON.parse(text);
}

export function at(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

export function stringAt(value: unknown, ...keys: string[]): string {
  const found = at(value, ...keys);
  if (typeof found !== 'string') throw new Error(`${keys.join('.')} — ожидается строка`);
  return found;
}

export function stringList(value: unknown, what: string): string[] {
  if (value === undefined || value === null) return [];
  if (!isStringArray(value)) throw new Error(`${what} — ожидается список строк`);
  return value;
}

export function unknownList(value: unknown, what: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${what} — ожидается список`);
  return value.map((v: unknown) => v);
}

export function recordOrEmpty(value: unknown, what: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error(`${what} — ожидается объект`);
  return value;
}
