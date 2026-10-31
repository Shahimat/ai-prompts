import { formatDiagnostic, type Diagnostic } from './diagnostics.ts';

export function report(label: string, diags: Diagnostic[]): number {
  if (diags.length === 0) {
    console.log(`${label}: ok`);
    return 0;
  }
  for (const d of diags) console.error(formatDiagnostic(d));
  console.error(`${label}: нарушений ${diags.length}`);
  return 1;
}

export const WARNING_PREFIX = 'предупреждение: ';

export function warn(diags: Diagnostic[]): void {
  for (const d of diags) console.error(`${WARNING_PREFIX}${formatDiagnostic(d)}`);
}
