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
export { io as planIo, selfCommand } from './harnesses/index.ts';
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
} from './harnesses/index.ts';
export { FSM_SCHEMA } from './harnesses/index.ts';
export { loadHarness, type LoadedHarness } from './harnesses/index.ts';
export {
  bashDecision,
  hookEvent,
  hookSettings,
  openerFor,
  servePage,
  JUDGE_TOOLS,
  plannerTools,
  planReviewRegistry,
  reviewText,
  type HookName,
  type PlanContext,
} from './harnesses/index.ts';
export { headlessArgs, interactiveArgs, type ModelRunner } from './harnesses/index.ts';
export { BUILTIN_HARNESSES, createSession, harnessHome, openSession } from './harnesses/index.ts';
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
export { parseAgent, ROLE_MODELS, type AgentDef, type RoleModel } from './lib/agent.ts';
export {
  isProtocolMessage,
  PROTOCOL,
  PROTOCOL_MESSAGES,
  SUBMIT_TOOL,
  SUBMIT_TOOL_ID,
  INTENT_KINDS,
  INTENTS_SCHEMA,
  type ProtocolMessage,
} from './lib/protocol.ts';
export { parseIntents } from './lib/intents.ts';
export { advertisedSchema, serveChannel, type Channel } from './lib/mcp.ts';
export {
  askRole,
  findRole,
  READ_ONLY_TOOLS,
  ROLE_DIRS,
  roleArgs,
  roleSystemPrompt,
  runRole,
  type RoleOutcome,
  type RoleRun,
} from './lib/role.ts';
