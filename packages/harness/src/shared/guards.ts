// Проверки типов во время выполнения: данные извне (JSON, YAML, ошибки)
// сужаются проверкой, а не приведением `as`.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Значение — один из литералов `values`. */
export function isOneOf<const T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.some((v) => v === value);
}

/** `code` системной ошибки Node (`ENOENT`, `ERR_PARSE_ARGS_*`…) или `undefined`. */
export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
