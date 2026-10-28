import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '@shahimat/cli';

const NOW = new Date('2026-10-14T12:00:00Z');
let root: string;

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
}

const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ai-core-refresh-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('ai refresh', () => {
  it('пересобирает context/index.yml и проверяет проект', async () => {
    await put('context/ai-core.yml', 'checks:\n  context-index: {}\n');
    await put('context/project.yml', 'name: demo\nnamespaces:\n  core: ядро\n');
    await put('context/conventions/naming.yml', 'key: naming\nsummary: kebab-case\nrule: x\n');
    git('init', '-q');
    expect(await main(['refresh', '--root', root], NOW)).toBe(0);
    expect(existsSync(path.join(root, 'context/index.yml'))).toBe(true);
  });

  it('2 — нет ai-core.yml', async () => {
    await expect(main(['refresh', '--root', root], NOW)).rejects.toThrow(/ai-core\.yml/);
  });
});
