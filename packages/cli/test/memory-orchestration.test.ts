import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { main } from '#cli';
import { CHECK } from '#scripts/check';
import { REFRESH } from '#scripts/refresh';
import { DOCS_VERIFY } from '#scripts/docs-verify';
import { runScript } from '#scripts/run';
import { enqueueKnowledge, pendingViewOf } from '@shahimat/ai-core';

let root: string;
const put = async (rel: string, text: string): Promise<void> => {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), text);
};
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cli-memory-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await put('.oc3/ai-core.yml', 'adapters: []\nchecks:\n  secrets: false\n');
  await put(
    '.oc3/manifest.json',
    JSON.stringify({
      namespace: ['docs'],
      data: [],
      files: { 'manuals/test.md': { namespace: ['docs'], weight: 1 } },
    }),
  );
  for (const name of ['manifest', 'conventions', 'glossary'])
    await put(
      `.oc3/data/__schemas/${name}.schema.json`,
      JSON.stringify({ type: name === 'manifest' ? 'object' : 'array' }),
    );
  await put('.oc3/manuals/test.md', '# Fixed summary\n\noriginal tail\n');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
it('cold check fails read-only; refresh builds and repairs tail-only changes without checks.memory', async () => {
  expect(await main(['check', '--root', root])).toBe(1);
  expect(existsSync(path.join(root, '.oc3/bundles'))).toBe(false);
  expect(await main(['refresh', '--root', root])).toBe(0);
  expect(await main(['check', '--root', root])).toBe(0);
  const start = await readFile(path.join(root, '.oc3/bundles/index.md'), 'utf8');
  await put('.oc3/manuals/test.md', '# Fixed summary\n\nchanged tail\n');
  expect(await main(['check', '--root', root])).toBe(1);
  expect(await readFile(path.join(root, '.oc3/bundles/index.md'), 'utf8')).toBe(start);
  expect(await main(['refresh', '--root', root])).toBe(0);
  expect(await main(['check', '--root', root])).toBe(0);
});
it('mandatory orchestration orders memory build before check for refresh and docs verify', () => {
  const commands = (steps: typeof CHECK.steps) => steps.map((s) => s.command.join(' '));
  expect(commands(CHECK.steps)).toContain('memory check');
  for (const script of [REFRESH, DOCS_VERIFY]) {
    expect(commands(script.steps).indexOf('memory build')).toBeGreaterThan(-1);
    expect(commands(script.steps).indexOf('memory build')).toBeLessThan(
      commands(script.steps).indexOf('memory check'),
    );
    expect(
      script.steps.filter((s) => s.command[0] === 'memory').every((s) => s.enabledBy === undefined),
    ).toBe(true);
  }
});

it('docs verify materializes memory; invalid schema cannot repair or replace it', async () => {
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  git(['init', '-q']);
  git(['add', '.']);
  git([
    '-c',
    'user.name=Synthetic',
    '-c',
    'user.email=synthetic@example.invalid',
    'commit',
    '-qm',
    'fixture',
  ]);
  expect(await runScript(DOCS_VERIFY, { root, now: new Date('2026-11-08T00:00:00Z') })).toBe(0);
  expect(await main(['memory', 'check', '--root', root])).toBe(0);
  const before = await readFile(path.join(root, '.oc3/bundles/index.md'), 'utf8');
  await put('.oc3/data/__schemas/conventions.schema.json', '{bad json');
  expect(await main(['refresh', '--root', root])).toBe(1);
  expect(await readFile(path.join(root, '.oc3/bundles/index.md'), 'utf8')).toBe(before);
});

it('non-memory projects and pending-only overlays are explicit skips, not a hidden checks.memory switch', async () => {
  await rm(path.join(root, '.oc3/manifest.json'));
  await rm(path.join(root, '.oc3/data'), { recursive: true });
  await put('.oc3/bundles/pending/index.md', 'pending-only runtime overlay\n');
  expect(await main(['check', '--root', root])).toBe(0);
  expect(console.log).toHaveBeenCalledWith('memory: не установлена — шаг пропущен');
  expect(await readFile(path.join(root, '.oc3/bundles/pending/index.md'), 'utf8')).toBe(
    'pending-only runtime overlay\n',
  );
  await put('.oc3/bundles/index.md', 'installed start without manifest');
  expect(await main(['check', '--root', root])).toBe(1);
});

it.each([false, true])(
  'runtime scripts execute inbox pending without canonical memory (pending-only=%s)',
  async (pendingOnly) => {
    await rm(path.join(root, '.oc3/manifest.json'));
    await rm(path.join(root, '.oc3/data'), { recursive: true });
    if (pendingOnly)
      await enqueueKnowledge(
        { root, actor: 'executor', channel: 'test', execution: 'inbox-script' },
        [
          {
            subject: 'inbox-sentinel',
            property: 'keep',
            value: false,
            kind: 'candidate',
            evidence: ['synthetic'],
          },
        ],
      );
    const pending = await pendingViewOf(root);
    vi.mocked(console.log).mockClear();
    expect(
      await runScript(
        { path: ['inbox-script'], steps: [{ command: ['memory', 'inbox', 'pending'] }] },
        { root, now: new Date('2026-11-08T00:00:00Z') },
      ),
    ).toBe(0);
    expect(console.log).toHaveBeenCalledWith(pending);
    expect(console.log).toHaveBeenCalledWith('inbox-script (memory inbox pending): ok');
    expect(console.log).not.toHaveBeenCalledWith('memory: не установлена — шаг пропущен');
    expect(existsSync(path.join(root, '.oc3/bundles/index.md'))).toBe(false);
    expect(pending.includes('inbox-sentinel')).toBe(pendingOnly);
  },
);
