export { cliMain, main, prepare, projectOf, run, runCli, selfCommand } from './cli.ts';
export { promptOf, runShell, shellStep, splitWords, type ShellStep } from './shell.ts';
export {
  BIN,
  BUILTIN,
  BUILTIN_TREE,
  loadTree,
  scriptCommand,
  SCRIPTS,
  type LoadedTree,
} from './tree.ts';
export { CHECK, DOCS_VERIFY, REFRESH, runScript } from './scripts/index.ts';
export {
  EXTENSION_DIRS,
  loadHarness,
  projectCommands,
  projectHarnesses,
  projectScripts,
  type HarnessApi,
} from './extensions.ts';
