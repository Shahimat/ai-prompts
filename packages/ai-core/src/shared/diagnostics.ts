export interface Diagnostic {
  file: string;
  line?: number;
  message: string;
}

export function formatDiagnostic(d: Diagnostic): string {
  return d.line === undefined ? `${d.file}: ${d.message}` : `${d.file}:${d.line}: ${d.message}`;
}

export class UsageError extends Error {}

export class InputError extends UsageError {}
