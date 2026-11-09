import { devNull } from 'node:os';
import path from 'node:path';

export function fixtureEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...input };
  const controls = [
    'OC3_PROOF_TRANSPORT',
    'HARNESS_OPENCODE',
    'HARNESS_ROLE_TIMEOUT_MIN',
    'HARNESS_EXPECT_ROOT',
    'HARNESS_EXPECT_ENTRY',
    'HARNESS_EXPECT_COLLECT',
    'HARNESS_EXPECT_SEEN',
    'SLOW_MS',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_TEMPLATE_DIR',
    'GIT_CONFIG',
    'GIT_CEILING_DIRECTORIES',
    'GIT_AUTHOR_DATE',
    'GIT_COMMITTER_DATE',
  ];
  for (const key of Object.keys(env))
    if (
      controls.includes(key) ||
      key.startsWith('FAKE_') ||
      key.startsWith('GIT_CONFIG_') ||
      key.startsWith('GIT_TRACE')
    )
      delete env[key];
  env['GIT_CONFIG_NOSYSTEM'] = '1';
  env['GIT_CONFIG_GLOBAL'] = devNull;
  env['GIT_CONFIG_COUNT'] = '3';
  for (const [index, [key, value]] of [
    ['core.hooksPath', devNull],
    ['commit.gpgSign', 'false'],
    ['tag.gpgSign', 'false'],
  ].entries()) {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  }
  for (const key of ['AUTHOR', 'COMMITTER']) {
    env[`GIT_${key}_NAME`] = 'Synthetic Test';
    env[`GIT_${key}_EMAIL`] = 'synthetic@example.invalid';
  }
  const nodeDir = path.dirname(process.execPath);
  env['PATH'] = [
    nodeDir,
    ...(input['PATH'] ?? '').split(path.delimiter).filter((p) => p !== nodeDir),
  ].join(path.delimiter);
  return env;
}
