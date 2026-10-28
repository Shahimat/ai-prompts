import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guardDecision } from '#commands/docs/index';

let root: string;

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
}

const edit = (file: string, tool = 'Edit') => ({
  tool_name: tool,
  tool_input: { file_path: file },
});

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ai-core-guard-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('ai docs guard', () => {
  it('Edit и Write в документацию и генерируемое — отказ; код и чтение — пропуск', async () => {
    for (const f of [
      'CHANGELOG.md',
      'context/project.yml',
      'context/conventions/naming.yml',
      'context/index.yml',
      'docs/entities/user.yml',
      'CLAUDE.md',
      '.claude/agents/judge.md',
    ])
      expect({ f, block: (await guardDecision(root, edit(f))).block }).toEqual({ f, block: true });
    expect((await guardDecision(root, edit('src/app.ts'))).block).toBe(false);
    expect((await guardDecision(root, edit('/elsewhere/CHANGELOG.md'))).block).toBe(false);
    expect(
      (await guardDecision(root, { tool_name: 'Read', tool_input: { file_path: 'CHANGELOG.md' } }))
        .block,
    ).toBe(false);
    expect((await guardDecision(root, edit(path.join(root, 'CHANGELOG.md'), 'Write'))).block).toBe(
      true,
    );
  });

  it('слои модулей — из provides.layers манифестов', async () => {
    await put('context/modules/goals.yml', 'provides:\n  layers: [context/views/]\n');
    expect((await guardDecision(root, edit('context/views/goals.yaml'))).block).toBe(true);
    expect((await guardDecision(root, edit('context/modules/goals.yml'))).block).toBe(false);
  });

  it('CLI: отказ — код 2 и подсказка про docs-delta в stderr, пропуск — 0', () => {
    const bin = fileURLToPath(import.meta.resolve('@shahimat/cli/package.json')).replace(
      /package\.json$/,
      'src/bin.ts',
    );
    const call = (input: object) =>
      spawnSync(process.execPath, ['--conditions=source', bin, 'docs', 'guard', '--root', root], {
        input: JSON.stringify(input),
        encoding: 'utf8',
      });
    const blocked = call(edit('CHANGELOG.md'));
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain('npx ai docs-delta start');
    expect(call(edit('src/app.ts')).status).toBe(0);
  });
});
