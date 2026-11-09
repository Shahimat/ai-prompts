import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  beginProofRun,
  joinProofRun,
  PROOF_TRANSPORT,
  proofRunEnvironment,
  runRegisteredCommand,
  COMMAND_NODES,
} from '@shahimat/ai-core';

const root = path.dirname(import.meta.dirname);
const [mode, ...provided] = process.argv.slice(2);
const force = provided.includes('--force');
const args = provided.filter((arg) => arg !== '--force');
if (
  args.some((arg) => ['--run', '--apply'].includes(arg) || arg.startsWith('--force=')) ||
  (mode !== 'test' && args.length !== 0) ||
  !['test', 'ci', 'changelog'].includes(mode ?? '')
) {
  console.error('verification: unsupported mode/options; --force never authorizes a producer');
  process.exit(2);
}
const inherited = process.env[PROOF_TRANSPORT];
const run =
  inherited === undefined
    ? await beginProofRun(root, { owner: 'native', scope: ['*'], force, allowJudge: false })
    : await joinProofRun(root, inherited);
if (force && !run.force) throw new Error('PROOF_POLICY_MISMATCH');

async function raw(argv: string[], cwd = root): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined) throw new Error('INVALID_VERIFICATION_COMMAND');
  console.log(`proof ${argv.join(' ')}: run-only (unmodelled subprocess dependencies/environment)`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, rest, { cwd, stdio: 'inherit', env: proofRunEnvironment(run) });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function workspaceTests(names: string[]): Promise<number> {
  for (const name of names) {
    const code = await raw(['npm', 'test', '-w', `@shahimat/${name}`, '--', ...args]);
    if (code !== 0) return code;
  }
  return 0;
}

async function main(): Promise<number> {
  if (mode === 'changelog') {
    if (args.length !== 0) throw new Error('changelog: unknown arguments');
    const now = new Date();
    return runRegisteredCommand(['changelog', 'lint'], { root, now, proofRun: run }, async () => {
      const checker = COMMAND_NODES.find((command) => command.path.join(' ') === 'changelog lint');
      if (checker === undefined) throw new Error('registered adapter required');
      return checker.run({ root, now, proofRun: run });
    });
  }
  if (mode === 'test') return workspaceTests(['ai-core', 'harness', 'cli', 'oc3']);
  if (mode !== 'ci' || args.length !== 0)
    throw new Error('verification: expected test/ci/changelog and supported flags');
  const stages = [
    ['npm', 'run', 'format:check'],
    ...['ai-core', 'harness', 'cli', 'oc3'].map((name) => [
      'npm',
      'run',
      'build',
      '-w',
      `@shahimat/${name}`,
    ]),
    ...[
      'models:check',
      'typecheck:ai-core',
      'typecheck:harness',
      'typecheck:cli',
      'typecheck:oc3',
      'tsc:expectations',
      'tsc:packages',
      'tsc:scripts',
      'lint',
    ].map((name) => ['npm', 'run', name]),
  ];
  for (const stage of stages) {
    const code = await raw(stage);
    if (code !== 0) return code;
  }
  const tests = await workspaceTests(['ai-core', 'harness', 'cli', 'oc3']);
  if (tests !== 0) return tests;
  for (const stage of [
    [process.execPath, 'scripts/packages-check.ts'],
    ...['index:check', 'memory:check', 'expect'].map((name) => ['npm', 'run', name]),
  ]) {
    const code = await raw(stage);
    if (code !== 0) return code;
  }
  return 0;
}

process.exitCode = await main();
