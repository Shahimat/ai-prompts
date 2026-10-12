import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectEntries, diffIndex, INDEX_PATH, renderIndex } from '../src/prompt-index.ts';

// Сверка на живом репозитории ai-prompts, в котором лежит пакет.
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../..');
const RAW_BASE = 'https://raw.githubusercontent.com/Shahimat/ai-prompts/main';

async function buildFromRepo(): Promise<string> {
  const { entries } = await collectEntries(REPO_ROOT);
  return renderIndex(entries, { rawBase: RAW_BASE, generatedAt: new Date() });
}

describe('индекс репозитория ai-prompts', () => {
  it('совпадает с закоммиченным prompts/index.yml', async () => {
    const committed = await readFile(path.join(REPO_ROOT, INDEX_PATH), 'utf8');
    expect(diffIndex(await buildFromRepo(), committed)).toEqual([]);
  });

  // Пока bash-скрипт жив, проверяем, что обе реализации дают одно и то же.
  it.skipIf(process.platform === 'win32')('совпадает с выводом scripts/build-index.sh', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'harness-bash-'));
    try {
      const out = path.join(dir, 'index.yml');
      execFileSync(path.join(REPO_ROOT, 'scripts/build-index.sh'), [out], { stdio: 'ignore' });
      expect(diffIndex(await buildFromRepo(), await readFile(out, 'utf8'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
