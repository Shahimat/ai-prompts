// Каталог встроенных harness и общее ядро слоя.

import type { CommandNode } from '../shared/node.ts';
import { harnessNodes } from './core/index.ts';
import { DOCS_DELTA } from './docs-delta/index.ts';
import { PLAN_REVIEW } from './plan-review/index.ts';
import { SOURCE_SYNC } from './source-sync/index.ts';

export * from './core/index.ts';
export * from './plan-review/index.ts';
export { DOCS_DELTA } from './docs-delta/index.ts';
export { SOURCE_SYNC } from './source-sync/index.ts';

/** Узлы CLI всех встроенных harness: `harness <имя> start | open | …`. */
export const HARNESS_NODES: readonly CommandNode[] = [PLAN_REVIEW, DOCS_DELTA, SOURCE_SYNC].flatMap(
  harnessNodes,
);
