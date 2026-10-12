import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectEntries, diffIndex, INDEX_PATH, renderIndex } from '../src/prompt-index.ts';

// Сверка на живом репозитории ai-prompts, в котором лежит пакет.
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../..');
const RAW_BASE = 'https://raw.githubusercontent.com/Shahimat/ai-prompts/main';

describe('индекс репозитория ai-prompts', () => {
  it('совпадает с закоммиченным prompts/index.yml', async () => {
    const { entries } = await collectEntries(REPO_ROOT);
    const built = renderIndex(entries, { rawBase: RAW_BASE, generatedAt: new Date() });
    const committed = await readFile(path.join(REPO_ROOT, INDEX_PATH), 'utf8');
    expect(diffIndex(built, committed)).toEqual([]);
  });
});
