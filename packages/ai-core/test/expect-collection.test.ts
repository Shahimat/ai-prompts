import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { artifactPath } from '#lib/artifacts';
import { runExpect } from '#commands/expect/index';
import { isRecord } from '#shared/guards';

it('real multi-judged collection builds one immutable inventory generation without a producer', async () => {
  const project = path.resolve(import.meta.dirname, '..', '..', '..');
  const parent = artifactPath(project, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: 'fixtures',
  });
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'collection-cost-'));
  const metrics = artifactPath(project, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: `checks/collection-cost-b-${randomUUID()}.json`,
  });
  await mkdir(path.dirname(metrics), { recursive: true });
  const entry = 'sample.expect.ts';
  const source = `import {it,afterAll} from 'vitest';
import {judged,inventoryCacheCounts} from '@shahimat/ai-core/expect';
import {writeFile} from 'node:fs/promises';
${Array.from({ length: 30 }, (_, index) => `it('criterion ${index}',async()=>{await judged(['evidence.md']);});`).join('\n')}
afterAll(async()=>{await writeFile(${JSON.stringify(metrics)},JSON.stringify(inventoryCacheCounts()));});`;
  const attempts = path.join(root, 'agent-attempts');
  const agent = path.join(root, 'forbidden-agent.mjs');
  await writeFile(
    agent,
    `import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(attempts)},'attempt');process.exit(97);`,
  );
  vi.stubEnv('HARNESS_OPENCODE', agent);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const started = Date.now();
  try {
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await writeFile(path.join(root, entry), source);
    await writeFile(path.join(root, 'evidence.md'), 'synthetic immutable evidence');
    expect(await runExpect('report', { root, now: new Date(), params: { file: entry } })).toBe(1);
    const measured: unknown = JSON.parse(await readFile(metrics, 'utf8'));
    expect(measured).toMatchObject({ extractions: 1, invalidations: 0, hits: 29 });
    await expect(readFile(attempts)).rejects.toThrow();
    if (!isRecord(measured)) throw new Error('missing metrics');
    await writeFile(
      metrics,
      JSON.stringify(
        {
          ...measured,
          elapsedMs: Date.now() - started,
          criteria: 30,
          configuredAgentBoundaryAttempts: 0,
          expectedCommandExit: 1,
        },
        null,
        2,
      ),
    );
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
