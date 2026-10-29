import type { CommandNode } from '@shahimat/ai-core';
import { harnessNodes, OPS_NODES } from './core/index.ts';
import { DOCS_DELTA } from './docs-delta/index.ts';
import { PLAN_REVIEW } from './plan-review/index.ts';
import { SOURCE_SYNC } from './source-sync/index.ts';
import { TICKET_WORK } from './ticket-work/index.ts';

export * from './core/index.ts';
export * from './plan-review/index.ts';
export { DOCS_DELTA } from './docs-delta/index.ts';
export { SOURCE_SYNC } from './source-sync/index.ts';
export { TICKET_WORK, parseVerdicts, quoted, type Verdict } from './ticket-work/index.ts';

export const HARNESS_NODES: readonly CommandNode[] = [
  ...[PLAN_REVIEW, DOCS_DELTA, SOURCE_SYNC, TICKET_WORK].flatMap(harnessNodes),
  ...OPS_NODES,
];
