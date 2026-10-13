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

/** Тело SKILL.md без frontmatter и вводного заголовка (до первого `## `). */
function skillBody(text: string): string {
  return text.slice(text.indexOf('\n## ') + 1);
}

const readRepo = (rel: string): Promise<string> => readFile(path.join(REPO_ROOT, rel), 'utf8');

describe('skills — копии источников совпадают', () => {
  it('skill goals = inline-блок паттерна goals', async () => {
    const pattern = await readRepo('patterns/goals.md');
    const block = pattern.slice(pattern.indexOf('## Inline-блок для целевого промпта'));
    const inline = block.split('\n---\n')[1] ?? '';
    // Заголовки в skill на два уровня выше: ### → #, #### → ##.
    const expected = inline
      .trim()
      .split('\n')
      .map((l) => (l.startsWith('#### ') ? `## ${l.slice(5)}` : l.startsWith('### ') ? `# ${l.slice(4)}` : l))
      .join('\n');
    const skill = await readRepo('skills/goals/SKILL.md');
    expect(skill).toContain(`${expected}\n`);
  });

  it('skill knowledge-external-gui = разделы модуля', async () => {
    const module = await readRepo('prompts/modules/knowledge-external-gui.md');
    const at = (heading: string): number => module.indexOf(`\n${heading}\n`) + 1;
    const expected =
      module.slice(at('## Назначение и границы'), module.indexOf('\n## Что модуль привносит в проект') + 1) +
      module.slice(at('## Обфусцированный пример'));
    expect(skillBody(await readRepo('skills/knowledge-external-gui/SKILL.md'))).toBe(`${expected.trimEnd()}\n`);
  });
});
