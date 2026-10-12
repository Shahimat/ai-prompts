export { normalizeEol, parseFrontmatter, type Frontmatter } from './frontmatter.ts';
export {
  collectEntries,
  diffIndex,
  INDEX_PATH,
  renderIndex,
  sha256,
  stripTimestamp,
  type CollectResult,
  type IndexDiff,
  type IndexEntry,
  type RenderOptions,
} from './prompt-index.ts';
export { checkChangelog, lintChangelog, CHANGELOG_PATH } from './checks/changelog.ts';
export {
  CONFIG_PATH,
  DEFAULT_CHANGELOG,
  loadConfig,
  parseConfig,
  type ChangelogOptions,
  type HarnessConfig,
} from './config.ts';
export { formatDiagnostic, UsageError, type Diagnostic } from './diagnostics.ts';
