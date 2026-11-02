import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { docsGuard, memoryGuard, runGate } from '#guards';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oc3-guards-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('docsGuard', () => {
  it('документацию пишет только librarian', async () => {
    expect(await docsGuard('executor', ['docs/entities/a.yml'], root)).toContain('librarian');
    expect(await docsGuard('judge', ['CHANGELOG.md'], root)).toContain('librarian');
    expect(await docsGuard(undefined, ['context/skills.yml'], root)).toContain('librarian');
    expect(await docsGuard('librarian', ['docs/a.md'], root)).toBeUndefined();
    expect(await docsGuard('executor', ['src/index.ts'], root)).toBeUndefined();
    expect(await docsGuard('judge', ['goals/a.expect.ts'], root)).toBeUndefined();
    expect(await docsGuard('executor', ['docs-generator.ts'], root)).toBeUndefined();
    expect(await docsGuard('judge', ['packages/cli/CHANGELOG.md'], root)).toBeUndefined();
    expect(await docsGuard('executor', ['src/commands/docs/index.ts'], root)).toBeUndefined();
  });

  it('маркер установки снимает guard', async () => {
    await mkdir(path.join(root, '.ops/locks/install'), { recursive: true });
    expect(await docsGuard('executor', ['context/project.yml'], root)).toBeUndefined();
    expect(await docsGuard('executor', ['CHANGELOG.md'], root)).toBeUndefined();
    expect(await docsGuard('executor', ['docs/entities/a.yml'], root)).toBeUndefined();
  });
});

describe('memoryGuard', () => {
  it('запрещает память вне репозитория и не трогает файлы проекта', () => {
    const project = '/project';
    expect(memoryGuard(['/home/u/.claude/projects/x/memory/y.md'], project)).toContain(
      'memory guard',
    );
    expect(memoryGuard(['~/'.concat('.config/opencode/x/memory/y.json')], project)).toContain(
      'memory guard',
    );
    expect(memoryGuard(['/project/src/memory/buf.ts'], project)).toBeUndefined();
  });
});

describe('runGate', () => {
  it('пропускает незавершённые циклы и режет завершённые', () => {
    expect(runGate([{ file: 'goals/a.expect.json', runs: 0, retry: false }])).toBeUndefined();
    expect(runGate([{ file: 'goals/a.expect.json', runs: 1, retry: false }])).toBeUndefined();
    expect(runGate([{ file: 'goals/a.expect.json', runs: 2, retry: false }])).toContain(
      'попытка завершена',
    );
    expect(runGate([{ file: 'goals/a.expect.json', runs: 2, retry: true }])).toBeUndefined();
    expect(runGate([{ file: 'goals/a.expect.json', runs: 3, retry: true }])).toContain('исчерпаны');
  });
});
