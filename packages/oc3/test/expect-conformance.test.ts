import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { artifactPath, beginProofRun, expectCacheFile, PROOF_TRANSPORT } from '@shahimat/ai-core';
import { main } from '#cli';

let root: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

it('oc3 expect report cold/warm/force remains read-only and cannot launch a producer with inherited allowJudge', async () => {
  const project = path.resolve(import.meta.dirname, '..', '..', '..');
  const parent = artifactPath(project, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: 'fixtures',
  });
  await mkdir(parent, { recursive: true });
  root = await mkdtemp(path.join(parent, 'oc3-expect-'));
  const entry = 'sample.expect.ts';
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(
    path.join(root, entry),
    "import {it,expect} from 'vitest';it('one',()=>expect(1).toBe(1));",
  );
  const file = path.join(root, expectCacheFile(entry));
  const legacy =
    '{"verdicts":{},"lint":{"sample.expect.ts":{"titles":"legacy","contradictions":[],"unmeasurable":[],"at":"2020-01-01"}}}';
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, legacy);
  const log = path.join(root, 'agent-attempts');
  const agent = path.join(root, 'forbidden-agent.mjs');
  await writeFile(
    agent,
    `import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(log)},'attempt');process.exit(97);`,
  );
  vi.stubEnv('HARNESS_OPENCODE', agent);
  const run = await beginProofRun(root, {
    owner: 'synthetic',
    scope: ['*'],
    force: true,
    allowJudge: true,
  });
  vi.stubEnv(PROOF_TRANSPORT, JSON.stringify(run));
  const out: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    out.push(parts.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    out.push(parts.join(' '));
  });
  for (const flags of [[], [], ['--force']])
    expect(await main(['expect', 'report', entry, '--root', root, ...flags])).toBe(1);
  expect(out.join('\n')).toContain('needs-review');
  expect(out.filter((line) => line.includes('expect collection: executed pass'))).toHaveLength(1);
  expect(
    out.filter((line) => line.includes('expect collection: executed stale; executed 0')),
  ).toHaveLength(2);
  expect(await readFile(file, 'utf8')).toBe(legacy);
  await expect(readFile(log)).rejects.toThrow();
  expect(await main(['expect', 'report', entry, '--root', root, '--run'])).toBe(2);
  expect(await main(['operator', 'state', '--root', root, '--force'])).toBe(2);
}, 60000);
