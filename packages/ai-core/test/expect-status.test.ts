import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { artifactPath, expectStateFile } from '#lib/artifacts';
import { runGoals } from '#commands/goals/index';

it('goal status never promotes a stale passing sidecar before or after new-generation source changes', async () => {
  const project = path.resolve(import.meta.dirname, '..', '..', '..');
  const parent = artifactPath(project, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: 'fixtures',
  });
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'status-'));
  const entry = 'sample.expect.ts';
  const source =
    "describe('ticket: sample',()=>{crit('meaningful original assertion',()=>expect(1).toBe(1));});";
  const state = JSON.stringify({ results: [{ run: 99, items: [{ status: 'pass' }] }] });
  const out: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    out.push(parts.join(' '));
  });
  try {
    await writeFile(path.join(root, entry), source);
    const file = path.join(root, expectStateFile(entry));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, state);
    for (const text of [source, source.replace('toBe(1)', 'toBe(2)')]) {
      await writeFile(path.join(root, entry), text);
      expect(await runGoals('status', { root, now: new Date(), params: { file: entry } })).toBe(0);
      expect(out.join('\n')).not.toContain('достигнута');
      expect(out.join('\n')).toContain('needs-review');
      expect(await readFile(file, 'utf8')).toBe(state);
    }
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});
