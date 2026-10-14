/** Найденное проверкой нарушение. */
export interface Diagnostic {
  /** Путь от корня проекта, через `/`. */
  file: string;
  /** Номер строки с 1; нет — нарушение относится к файлу целиком. */
  line?: number;
  message: string;
}

export function formatDiagnostic(d: Diagnostic): string {
  return d.line === undefined ? `${d.file}: ${d.message}` : `${d.file}:${d.line}: ${d.message}`;
}

/** Ошибка вызова или конфигурации: код выхода 2, а не 1. */
export class UsageError extends Error {}
