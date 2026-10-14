export { normalizeEol, parseFrontmatter, type Frontmatter } from './frontmatter.ts';
export {
  collectEntries,
  diffIndex,
  INDEX_PATH,
  renderIndex,
  sha256,
  stripTimestamp,
  type CollectResult,
  type FeatureInfo,
  type IndexDiff,
  type IndexEntry,
  type RenderOptions,
} from './prompt-index.ts';
export { checkChangelog, lintChangelog, CHANGELOG_PATH } from './checks/changelog.ts';
export { checkSecrets, scanSecrets, scanSecretsFile } from './checks/secrets.ts';
export {
  CONFIG_PATH,
  DEFAULT_CHANGELOG,
  KNOWN_CHECKS,
  loadConfig,
  parseConfig,
  type ChangelogOptions,
  type HarnessConfig,
  type SecretsAllow,
  type SecretsOptions,
} from './config.ts';
export { formatDiagnostic, UsageError, type Diagnostic } from './diagnostics.ts';
export {
  buildContextIndex,
  checkContextIndex,
  CONTEXT_INDEX_PATH,
  type ContextIndexResult,
} from './checks/context-index.ts';
export {
  applyActions,
  checkAdapters,
  computeSync,
  KNOWN_ADAPTERS,
  type Action,
  type AdapterName,
  type SyncResult,
} from './adapters/sync.ts';
export {
  changelogBetween,
  compareVersions,
  runOutdated,
  type Fetcher,
} from './commands/outdated.ts';
export {
  childrenOf,
  COMMANDS,
  findCommand,
  isNamespace,
  renderUsage,
  type Command,
  type Match,
} from './commands/tree.ts';
export { shellStep, splitWords } from './commands/shell.ts';
export { io as planIo, selfCommand } from './commands/plan.ts';
export {
  drive,
  machineMermaid,
  parseMachine,
  resolve,
  staticErrors,
  type ActionDef,
  type Guard,
  type MachineDef,
  type Registry,
} from './fsm/machine.ts';
export { FSM_SCHEMA } from './fsm/schema.ts';
export { loadHarness, type LoadedHarness } from './handlers/load.ts';
export {
  failureReport,
  hookSettings,
  plannerTools,
  planIterRegistry,
  REVIEW_TOOLS,
  type PlanContext,
} from './handlers/plan-iter.ts';
export {
  acceptFindings,
  CRITERIA_SCHEMA,
  findingsSchema,
  parseCriteria,
  verdict,
  type Criterion,
  type Finding,
} from './plan/criteria.ts';
export { FORMAL_CRITERIA, formalCheck } from './plan/formal.ts';
export {
  changedParts,
  parsePlan,
  replaceSection,
  serializeBlocks,
  setFrontmatter,
  withDependents,
  type PlanItem,
  type PlanModel,
} from './plan/model.ts';
export { renderPlanHtml } from './plan/render.ts';
export { headlessArgs, interactiveArgs, type ModelRunner } from './runner/claude.ts';
export { type Prompter } from './runner/terminal.ts';
export { BUILTIN_HARNESSES, createSession, harnessHome, openSession } from './store/session.ts';
export {
  checkDelta,
  DELTA_DIR,
  DELTA_SCHEMA,
  matchesTarget,
  revisionLines,
  unfinishedItems,
  type Delta,
  type DeltaItem,
  type DeltaResult,
  type Revision,
} from './checks/delta.ts';
