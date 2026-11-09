export interface ProofDeclaration {
  cacheability: 'runtime-bound' | 'run-only';
  files: readonly string[];
  optionalFiles?: readonly string[];
  implementation: readonly string[];
  loadedImplementation?: Readonly<Record<string, string>>;
  membership?: readonly string[];
  projectFiles?: boolean;
  complete: boolean;
  diagnostics?: readonly string[];
  environment?: Readonly<Record<string, readonly string[]>>;
  secretDependent?: boolean;
  config?: unknown;
}

export interface ProofInputs {
  key: string;
  cacheable: boolean;
  currentReusable: boolean;
  generationValid: boolean;
  diagnostics: string[];
  manifest: {
    files: { file: string; hash: string | null }[];
    membership: { directory: string; files: string[] }[];
    environment: Record<string, string | null>;
    runtime: { node: string; executable: string; platform: string; arch: string };
    config: { provided: boolean; value: unknown };
    loadedImplementation: Readonly<Record<string, string>> | null;
  };
}

export interface ProofOutcome {
  status: 'pass' | 'fail' | 'pending' | 'error';
  code: number;
  diagnostics: string[];
}

export interface ProofReceipt {
  version: 1;
  run: string;
  node: string;
  input: string;
  after: string;
  currentReusable: boolean;
  status: ProofOutcome['status'] | 'stale';
  code: number;
  diagnostics: string[];
  origin: 'executed' | 'baseline' | 'current-run';
}

export interface ProofNode {
  id: string;
  declaration: ProofDeclaration;
  execute: () => Promise<ProofOutcome>;
}

export interface ProofRecord {
  version: 1;
  node: string;
  input: string;
  manifest: ProofInputs['manifest'];
  status: 'pass';
  code: 0;
}

export type { ProofPolicy, ProofRun } from '#shared/proof';
