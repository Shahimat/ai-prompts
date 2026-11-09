import type { ProofRun } from '#shared/proof';

export interface CommandArgs {
  root: string;
  out?: string;
  file?: string;
  batch?: string;
  ticket?: string;
  baseline?: string;
  html?: string;
  port?: string;
  rawBase?: string;
  apply?: boolean;
  run?: boolean;
  force?: boolean;
  proofRun?: ProofRun;
  now: Date;
  params?: Record<string, string>;
  home?: string;
  name?: string;
  request?: string;
  all?: boolean;
  every?: string;
  until?: string;
  job?: string;
  timeout?: string;
  stale?: boolean;
  days?: string;
  forget?: boolean;
}
