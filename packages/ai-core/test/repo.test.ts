import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectEntries, diffIndex, INDEX_PATH, renderIndex } from '#lib/prompt-index';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: import.meta.dirname,
  encoding: 'utf8',
}).trim();
const RAW_BASE = 'https://raw.githubusercontent.com/Shahimat/ai-prompts/main';

describe('индекс репозитория ai-prompts', () => {
  it('совпадает с закоммиченным prompts/index.yml', async () => {
    const { entries } = await collectEntries(REPO_ROOT);
    const built = renderIndex(entries, { rawBase: RAW_BASE, generatedAt: new Date() });
    const committed = await readFile(path.join(REPO_ROOT, INDEX_PATH), 'utf8');
    expect(diffIndex(built, committed)).toEqual([]);
  });
});
