import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { artifactPath, PROOF_TRANSPORT, errorCode } from '@shahimat/ai-core';
import { main } from '#cli';

const project = path.resolve(import.meta.dirname, '..', '..', '..');
const guarded = (process.env['NODE_OPTIONS'] ?? '').trim() !== '';
let root: string;
let lines: string[];
const observations: {
  name: string;
  lines: string[];
  executions: number;
  currentHits: number;
  baselineHits: number;
}[] = [];
beforeEach(async () => {
  const parent = artifactPath(project, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: 'fixtures',
  });
  await mkdir(parent, { recursive: true });
  root = await mkdtemp(path.join(parent, 'command-matrix-'));
  await mkdir(path.join(root, '.oc3'));
  await writeFile(
    path.join(root, '.oc3/ai-core.yml'),
    'checks:\n  changelog:\n    tags: [arch]\n    max_line: 200\n  secrets: false\n',
  );
  await writeFile(
    path.join(root, 'CHANGELOG.md'),
    '- 2026-01-01 · [arch] synthetic · synthetic reason\n',
  );
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  for (const name of ['ai-core', 'cli']) {
    await mkdir(path.join(root, 'packages', name), { recursive: true });
    await cp(
      path.join(project, 'packages', name, 'src'),
      path.join(root, 'packages', name, 'src'),
      { recursive: true },
    );
    await cp(
      path.join(project, 'packages', name, 'package.json'),
      path.join(root, 'packages', name, 'package.json'),
    );
  }
  await mkdir(path.join(root, 'node_modules/@shahimat'), { recursive: true });
  await symlink(
    path.join(root, 'packages/ai-core'),
    path.join(root, 'node_modules/@shahimat/ai-core'),
  );
  await cp(
    path.dirname(createRequire(import.meta.url).resolve('yaml/package.json')),
    path.join(root, 'node_modules/yaml'),
    { recursive: true },
  );
  const coreRequire = createRequire(path.join(project, 'packages/ai-core/package.json'));
  for (const name of ['typescript', 'ajv'])
    await symlink(
      path.dirname(coreRequire.resolve(`${name}/package.json`)),
      path.join(root, 'node_modules', name),
    );
  await writeFile(
    path.join(root, 'driver.mjs'),
    `import {main} from './packages/cli/src/cli.ts';
import {beginProofRun,PROOF_TRANSPORT} from './packages/ai-core/src/lib/proof/transport.ts';
const force=process.argv.includes('--force');
const run=await beginProofRun(process.cwd(),{owner:'synthetic',scope:['*'],force,allowJudge:true});
process.env[PROOF_TRANSPORT]=JSON.stringify(run);
const flags=force?['--force']:[];
for(const command of ['check','refresh']) console.log('matrix exit '+command+'='+await main([command,'--root',process.cwd(),...flags]));
console.log('allowJudge inherited='+run.allowJudge+'; no explicit producer path');`,
  );
  await writeFile(
    path.join(root, 'forbidden-agent.mjs'),
    'import {writeFileSync} from "node:fs";writeFileSync("unexpected-agent.json","launched");process.exit(97);',
  );
  vi.stubEnv('HARNESS_OPENCODE', path.join(root, 'forbidden-agent.mjs'));
  lines = [];
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    lines.push(parts.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    lines.push(parts.join(' '));
  });
});
afterEach(async () => {
  await readFile(path.join(root, 'unexpected-agent.json')).then(
    () => {
      throw new Error('unexpected configured agent launch');
    },
    (error) => {
      if (errorCode(error) !== 'ENOENT') throw error;
    },
  );
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
  const file = artifactPath(project, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: `checks/command-matrix-b-${randomUUID()}.json`,
  });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({ observations, configuredAgentBoundaryAttempts: 0 }, null, 2),
  );
  console.log(file);
});

it('check/refresh preserve config filtering, share authenticated policy and never infer agent permission from force', async () => {
  for (const [index, force] of [false, false, true].entries()) {
    const env = { ...process.env };
    delete env[PROOF_TRANSPORT];
    const child = spawnSync(
      process.execPath,
      ['--conditions=source', 'driver.mjs', ...(force ? ['--force'] : [])],
      { cwd: root, env, encoding: 'utf8', timeout: 30000 },
    );
    expect(child.status).toBe(0);
    lines = child.stdout.split('\n');
    expect(child.stdout).toContain('matrix exit check=0');
    expect(child.stdout).toContain(`matrix exit refresh=${guarded ? 1 : 0}`);
    const executions = lines.filter((line) =>
      line.includes('proof changelog lint: executed pass'),
    ).length;
    const currentHits = lines.filter((line) =>
      line.includes('proof changelog lint: current-run pass'),
    ).length;
    const baselineHits = lines.filter((line) =>
      line.includes('proof changelog lint: baseline pass'),
    ).length;
    observations.push({
      name: index === 0 ? 'cold' : index === 1 ? 'warm' : 'force',
      lines: [...lines],
      executions,
      currentHits,
      baselineHits,
    });
    const baseline = index === 1 && !guarded;
    expect(lines.filter((line) => line.includes('changelog: ok'))).toHaveLength(baseline ? 0 : 1);
    expect(executions).toBe(baseline ? 0 : 1);
    expect(baselineHits).toBe(baseline ? 1 : 0);
    expect(
      lines.filter((line) => line.includes('proof changelog lint: current-run pass')),
    ).toHaveLength(guarded ? 0 : 1);
    expect(
      lines.filter((line) => line.includes('proof changelog lint: executed stale')),
    ).toHaveLength(guarded ? 1 : 0);
    expect(child.stderr.includes('unmodelled environment: NODE_OPTIONS')).toBe(guarded);
    expect(child.stdout).toContain('allowJudge inherited=true; no explicit producer path');
    expect(lines.join('\n')).not.toContain('adapters sync');
    expect(lines.join('\n')).not.toContain('secrets scan');
  }
}, 60000);

it('check/refresh do not rerun a matching current failure and flag misuse is a usage error', async () => {
  await writeFile(path.join(root, 'CHANGELOG.md'), '- invalid\n');
  const env = { ...process.env };
  delete env[PROOF_TRANSPORT];
  const child = spawnSync(process.execPath, ['--conditions=source', 'driver.mjs', '--force'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
  expect(child.status).toBe(0);
  lines = child.stdout.split('\n');
  expect(child.stdout).toContain('matrix exit check=1');
  expect(child.stdout).toContain('matrix exit refresh=1');
  expect(lines.filter((line) => line.includes('proof changelog lint: executed fail'))).toHaveLength(
    1,
  );
  expect(
    lines.filter((line) => line.includes('proof changelog lint: current-run fail')),
  ).toHaveLength(guarded ? 0 : 1);
  expect(
    lines.filter((line) => line.includes('proof changelog lint: executed stale')),
  ).toHaveLength(guarded ? 1 : 0);
  expect(child.stderr.includes('unmodelled environment: NODE_OPTIONS')).toBe(guarded);
  observations.push({
    name: 'current-failure',
    lines: [...lines],
    executions: 1,
    currentHits: guarded ? 0 : 1,
    baselineHits: 0,
  });
  await expect(main(['check', '--root', root, '--run'])).rejects.toThrow('--run/--apply');
  await expect(main(['refresh', '--root', root, '--apply'])).rejects.toThrow('--run/--apply');
  await expect(main(['models', 'check', '--root', root, '--force'])).rejects.toThrow('--force');
}, 60000);
