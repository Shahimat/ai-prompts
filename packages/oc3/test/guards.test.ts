import { describe, expect, it } from 'vitest';
import { docsGuard, memoryGuard, runGate } from '#guards';

describe('docsGuard', () => {
  it('документацию пишет только librarian', () => {
    expect(docsGuard('executor', ['docs/entities/a.yml'])).toContain('librarian');
    expect(docsGuard('judge', ['CHANGELOG.md'])).toContain('librarian');
    expect(docsGuard(undefined, ['context/skills.yml'])).toContain('librarian');
    expect(docsGuard('librarian', ['docs/a.md'])).toBeUndefined();
    expect(docsGuard('executor', ['src/index.ts'])).toBeUndefined();
    expect(docsGuard('judge', ['goals/a.expect.ts'])).toBeUndefined();
    expect(docsGuard('executor', ['docs-generator.ts'])).toBeUndefined();
  });
});

describe('memoryGuard', () => {
  it('запрещает память вне репозитория и не трогает файлы проекта', () => {
    const root = '/project';
    expect(memoryGuard(['/home/u/.claude/projects/x/memory/y.md'], root)).toContain('memory guard');
    expect(memoryGuard(['~/'.concat('.config/opencode/x/memory/y.json')], root)).toContain(
      'memory guard',
    );
    expect(memoryGuard(['/project/src/memory/buf.ts'], root)).toBeUndefined();
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
