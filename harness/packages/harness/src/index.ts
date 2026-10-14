export { normalizeEol, parseFrontmatter, type Frontmatter } from './shared/frontmatter.ts';
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
} from './lib/prompt-index.ts';
export { checkChangelog, lintChangelog, CHANGELOG_PATH } from './commands/changelog/index.ts';
export { checkSecrets, scanSecrets, scanSecretsFile } from './commands/secrets/index.ts';
export {
  CONFIG_PATH,
  DEFAULT_CHANGELOG,
  KNOWN_ADAPTERS,
  KNOWN_CHECKS,
  loadConfig,
  type AdapterName,
  parseConfig,
  type ChangelogOptions,
  type HarnessConfig,
  type SecretsAllow,
  type SecretsOptions,
} from './shared/config.ts';
export { formatDiagnostic, UsageError, type Diagnostic } from './shared/diagnostics.ts';
export {
  buildContextIndex,
  checkContextIndex,
  type ContextIndexResult,
} from './commands/context/index.ts';
export {
  applyActions,
  checkAdapters,
  computeSync,
  type Action,
  type SyncResult,
} from './commands/adapters/index.ts';
export {
  changelogBetween,
  compareVersions,
  runOutdated,
  type Fetcher,
} from './commands/outdated/index.ts';
export {
  childrenOf,
  COMMANDS,
  findCommand,
  isNamespace,
  renderUsage,
  type Command,
  type Match,
} from './tree.ts';
export { shellStep, splitWords } from './shell.ts';
export { io as planIo, selfCommand } from './harness/index.ts';
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
} from './harness/index.ts';
export { FSM_SCHEMA } from './harness/index.ts';
export { loadHarness, type LoadedHarness } from './harness/index.ts';
export {
  failureReport,
  hookSettings,
  plannerTools,
  planIterRegistry,
  REVIEW_TOOLS,
  type PlanContext,
} from './harness/index.ts';
export {
  acceptFindings,
  CRITERIA_SCHEMA,
  findingsSchema,
  parseCriteria,
  verdict,
  type Criterion,
  type Finding,
} from './harness/index.ts';
export { FORMAL_CRITERIA, formalCheck } from './harness/index.ts';
export {
  changedParts,
  parsePlan,
  replaceSection,
  serializeBlocks,
  setFrontmatter,
  withDependents,
  type PlanItem,
  type PlanModel,
} from './harness/index.ts';
export { renderPlanHtml } from './harness/index.ts';
export { headlessArgs, interactiveArgs, type ModelRunner } from './harness/index.ts';
export { type Prompter } from './harness/index.ts';
export { BUILTIN_HARNESSES, createSession, harnessHome, openSession } from './harness/index.ts';
export {
  checkDelta,
  DELTA_SCHEMA,
  matchesTarget,
  revisionLines,
  unfinishedItems,
  type Delta,
  type DeltaItem,
  type DeltaResult,
  type Revision,
} from './commands/delta/index.ts';
export { CONTEXT_INDEX_PATH, DELTA_DIR } from './shared/layout.ts';
export {
  compileSchema,
  schemaErrors,
  schemaSet,
  type SchemaIssue,
  type Validate,
} from './shared/schema.ts';
export type { CommandNode, Effect, ScriptDef, ScriptNode, ScriptStep } from './shared/node.ts';
export { CHECK, DOCS_VERIFY, REFRESH } from './scripts/index.ts';
