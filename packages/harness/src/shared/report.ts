import { formatDiagnostic, type Diagnostic } from './diagnostics.ts';

/** Печатает нарушения и возвращает код выхода. */
export function report(label: string, diags: Diagnostic[]): number {
  if (diags.length === 0) {
    console.log(`${label}: ok`);
    return 0;
  }
  for (const d of diags) console.error(formatDiagnostic(d));
  console.error(`${label}: нарушений ${diags.length}`);
  return 1;
}
