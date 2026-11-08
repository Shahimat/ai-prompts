export { normalizeEol, parseFrontmatter, type Frontmatter } from './shared/frontmatter.ts';
export * from './lib/knowledge.ts';
export * from './lib/task-gates.ts';
export {
  digestOf,
  contentHash,
  localSnapshot,
  topologyOf,
  acquireLease,
  recoverLease,
  publishJson,
  publishProjectJson,
  readJson,
  safePath,
  runDocsReviewStage,
} from './lib/local-store.ts';
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
export { formatDiagnostic, InputError, UsageError, type Diagnostic } from './shared/diagnostics.ts';
export { WARNING_PREFIX } from './shared/report.ts';
export { runContext, collectContext } from './commands/context/index.ts';
export {
  applyActions,
  checkAdapters,
  computeSync,
  runAdapters,
  type Action,
  type SyncResult,
} from './commands/adapters/index.ts';
export {
  changelogBetween,
  compareVersions,
  runOutdated,
  type Fetcher,
} from './commands/outdated/index.ts';
export { commandTree, type Command, type CommandTree, type Match } from './lib/tree.ts';
export { runtime, setRuntime, type Runtime } from './lib/runtime.ts';
export { runModels, ROLE_MODEL_PATTERN } from './commands/models/index.ts';
export {
  loadModelManifest,
  validateModelManifest,
  resolveManifestModel,
  resolveProjectModel,
  modelRoleIds,
  MODEL_MANIFEST,
  MODEL_HELPERS,
  MODEL_ROLES,
  type ModelManifest,
  type ResolvedModel,
} from './lib/project-models.ts';
export { computeModelPlan } from './lib/model-plan.ts';
export { runGoals } from './commands/goals/index.ts';
export { runOperator } from './commands/operator/index.ts';
export { runRoles, runSkills } from './commands/roles/index.ts';
export { runMemory } from './commands/memory/index.ts';
export {
  buildTreeSchema,
  checkOc3Tree,
  mandateOf,
  runTree,
  type TreeManifest,
  type TreeReport,
} from './commands/tree/index.ts';
export {
  buildBundles,
  ensureMemory,
  bundleNodes,
  checkBundles,
  startIndexText,
  writeGraph,
  type MemoryGraph,
} from './lib/memory-graph.ts';
export { memoryInstalled } from '#lib/memory';
export { COMMAND_NODES } from './registry.ts';
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
export {
  ABOLISHED_INDEX,
  AI_CORE_PATH,
  AUTONOMY_PATH,
  BASELINE_DIR,
  BUNDLES_DIR,
  CONVENTIONS_DIR,
  DATA_DIR,
  DELTA_DIR,
  FEEDBACK_DIR,
  GLOSSARY_DIR,
  GOALS_DIR,
  JOBS_DIR,
  KNOWLEDGE_DIR,
  LOCKS_DIR,
  MANUALS_DIR,
  MODULES_DIR,
  OC3_DIR,
  OC3_MANIFEST,
  NOTES_PATH,
  OPERATOR_DIR,
  OPS_PATH,
  PROJECT_PATH,
  RESEARCH_DIR,
  REPORTS_DIR,
  SCHEMAS_DIR,
  SESSIONS_DIR,
  SKILLS_PATH,
  SUBMIT_DIR,
  VERDICTS_DIR,
  WATCHES_DIR,
} from './shared/layout.ts';
export {
  compileSchema,
  schemaErrors,
  schemaSet,
  type SchemaIssue,
  type Validate,
} from './shared/schema.ts';
export {
  checkMemory,
  DEFAULT_BUDGETS,
  type MemoryBudgets,
  type MemoryManifest,
} from './lib/memory.ts';
export type { CommandNode, Effect, ScriptDef, ScriptNode, ScriptStep } from './shared/node.ts';
export { parseAgent, type AgentDef } from './lib/agent.ts';
export {
  isProtocolMessage,
  PROTOCOL,
  PROTOCOL_MESSAGES,
  SUBMIT_TOOL,
  SUBMIT_TOOL_ID,
  INTENT_KINDS,
  INTENTS_SCHEMA,
  INTENTS_SHAPE,
  REVISE_INTENT,
  type ProtocolMessage,
} from './lib/protocol.ts';
export { parseIntents } from './lib/intents.ts';
export { advertisedSchema, serveChannel, type Channel } from './lib/mcp.ts';
export {
  cliCommand,
  askRole,
  findRole,
  ROLE_DIRS,
  roleSystemPrompt,
  roleTimeoutMs,
  runRole,
  type AskOptions,
  type RoleOutcome,
  type RoleRun,
} from './lib/role.ts';
export * from './lib/opencode.ts';
export { readIntents } from './lib/intents.ts';
export { errorCode, errorMessage, isOneOf, isRecord, isStringArray } from './shared/guards.ts';
export type { CommandArgs } from './shared/args.ts';
export {
  expectBuild,
  expectSummary,
  runExpect,
  type ExpectSummary,
} from './commands/expect/index.ts';
export * from './lib/artifacts.ts';
export * from './lib/artifact-migration.ts';
