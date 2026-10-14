// Каталог встроенных harness и общее ядро слоя.

import { catalog } from './core/index.ts';
import { DOCS_DELTA } from './docs-delta/index.ts';
import { PLAN_ITER } from './plan-iter/index.ts';
import { SOURCE_SYNC } from './source-sync/index.ts';

export * from './core/index.ts';
export * from './plan-iter/index.ts';
export { DOCS_DELTA, runDocsStart } from './docs-delta/index.ts';
export { runSourceStart, SOURCE_SYNC } from './source-sync/index.ts';

const CATALOG = catalog([PLAN_ITER, DOCS_DELTA, SOURCE_SYNC]);

export const runPlanList = CATALOG.list('plan');
export const runPlanValidate = CATALOG.validate('plan');
export const runPlanGraph = CATALOG.graph('plan');
export const runDocsValidate = CATALOG.validate('docs');
export const runDocsGraph = CATALOG.graph('docs');
export const runSourceValidate = CATALOG.validate('source');
export const runSourceGraph = CATALOG.graph('source');
export const runSessionList = CATALOG.sessionList;
export const runSessionStatus = CATALOG.sessionStatus;
export const runSessionResume = CATALOG.sessionResume;
export const runSessionRetry = CATALOG.sessionRetry;
