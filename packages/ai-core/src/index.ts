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
  KNOWN_HOOKS,
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
export { commandTree, type Command, type CommandTree, type Match } from './lib/tree.ts';
export { runtime, setRuntime, type Runtime } from './lib/runtime.ts';
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
export { CONTEXT_INDEX_PATH, DELTA_DIR } from './shared/layout.ts';
export {
  compileSchema,
  schemaErrors,
  schemaSet,
  type SchemaIssue,
  type Validate,
} from './shared/schema.ts';
export type { CommandNode, Effect, ScriptDef, ScriptNode, ScriptStep } from './shared/node.ts';
export { parseAgent, ROLE_MODELS, type AgentDef, type RoleModel } from './lib/agent.ts';
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
  finalLine,
  findRole,
  READ_ONLY_TOOLS,
  ROLE_DIRS,
  roleArgs,
  roleSystemPrompt,
  roleTimeoutMs,
  stepOf,
  runRole,
  type AskOptions,
  type RoleOutcome,
  type RoleRun,
} from './lib/role.ts';
export * from './lib/claude.ts';
export { readIntents } from './lib/intents.ts';
export { errorCode, errorMessage, isOneOf, isRecord, isStringArray } from './shared/guards.ts';
export type { CommandArgs } from './shared/args.ts';
export {
  expectBuild,
  expectSummary,
  runExpect,
  type ExpectSummary,
} from './commands/expect/index.ts';
export {
  DOCS_DIRS,
  DOCS_FILES,
  guardDecision,
  guardedReason,
  GUARDED_TOOLS,
  moduleLayers,
  type GuardDecision,
} from './commands/docs/index.ts';
