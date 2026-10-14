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
export {
  CONFIG_PATH,
  DEFAULT_CHANGELOG,
  KNOWN_CHECKS,
  loadConfig,
  parseConfig,
  type ChangelogOptions,
  type HarnessConfig,
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
export { COMMANDS, findCommand, renderUsage, type Command } from './commands/tree.ts';
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
