import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { docsGuard, generatedGuard, memoryGuard, memorySeal, OC3_READABLE, runGate } from '#guards';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oc3-guards-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('memorySeal', () => {
  it('librarian читает запечатанный слой, манифест и весь .oc3/', () => {
    expect(memorySeal('librarian', ['.oc3/project.yml'], root)).toBeUndefined();
    expect(memorySeal('librarian', ['.oc3/manifest.json'], root)).toBeUndefined();
    expect(memorySeal('librarian', ['.oc3/modules/ops.yml'], root)).toBeUndefined();
    expect(memorySeal('librarian', ['.oc3/NOTES.md'], root)).toBeUndefined();
    expect(memorySeal('librarian', ['.oc3/goals/a.expect.ts'], root)).toBeUndefined();
  });

  it('executor: факты и манифест — deny, белый список — allow, прочий .oc3/ — deny', () => {
    expect(memorySeal('executor', ['.oc3/project.yml'], root)).toContain('memory seal');
    expect(memorySeal('executor', ['.oc3/conventions/'], root)).toContain('только librarian');
    expect(memorySeal('executor', ['.oc3/data/entities/'], root)).toContain('только librarian');
    expect(memorySeal('executor', ['.oc3/manifest.json'], root)).toContain('только librarian');
    expect(memorySeal('executor', ['.oc3/goals/a.expect.json'], root)).toBeUndefined();
    expect(memorySeal('executor', ['.oc3/bundles/index.md'], root)).toBeUndefined();
    expect(memorySeal('executor', ['.oc3/research/t/find.md'], root)).toBeUndefined();
    expect(memorySeal('executor', ['.oc3/reports/t/1.md'], root)).toBeUndefined();
    expect(memorySeal('executor', ['.oc3/verdicts/t/1.yml'], root)).toBeUndefined();
    expect(memorySeal('executor', ['.oc3/operator/state.yml'], root)).toBeUndefined();
    expect(memorySeal('executor', ['.oc3/locks/install'], root)).toBeUndefined();
    expect(memorySeal('executor', ['.oc3/sessions/s.briefing'], root)).toBeUndefined();
    expect(memorySeal('executor', ['.oc3/submit/ses.json'], root)).toBeUndefined();
    expect(memorySeal('executor', ['.oc3/skills.yml'], root)).toBeUndefined();
    expect(memorySeal('executor', ['.oc3/ai-core.yml'], root)).toBeUndefined();
    expect(memorySeal('executor', ['.oc3/modules/ops.yml'], root)).toContain('memory seal');
    expect(memorySeal('executor', ['.oc3/feedback/t.yml'], root)).toContain('memory seal');
    expect(memorySeal('executor', ['.oc3/NOTES.md'], root)).toContain('memory seal');
  });

  it('judge, researcher и безымянный агент — под тем же seal', () => {
    for (const agent of ['judge', 'researcher', undefined]) {
      expect(memorySeal(agent, ['.oc3/glossary/common.yml'], root)).toContain('memory seal');
      expect(memorySeal(agent, ['.oc3/manifest.json'], root)).toContain('memory seal');
      expect(memorySeal(agent, ['src/index.ts'], root)).toBeUndefined();
      expect(memorySeal(agent, ['.oc3x/readme.md'], root)).toBeUndefined();
    }
  });

  it('оператор-сессия (main) тоже не читает факты напрямую', () => {
    expect(memorySeal('main', ['.oc3/project.yml'], root)).toContain('memory seal');
    expect(memorySeal('main', ['.oc3/bundles/index.md'], root)).toBeUndefined();
  });

  it('абсолютный и относительный путь нормализуются', () => {
    expect(memorySeal('executor', [path.join(root, '.oc3/project.yml')], root)).toContain(
      'memory seal',
    );
    expect(memorySeal('executor', ['./.oc3/manifest.json'], root)).toContain('memory seal');
  });

  it('белый список не расширяется молча: состав зафиксирован', () => {
    expect([...OC3_READABLE]).toEqual([
      '.oc3/bundles/',
      '.oc3/goals/',
      '.oc3/research/',
      '.oc3/reports/',
      '.oc3/verdicts/',
      '.oc3/operator/',
      '.oc3/locks/',
      '.oc3/sessions/',
      '.oc3/submit/',
      '.oc3/skills.yml',
      '.oc3/ai-core.yml',
    ]);
  });

  it('seal применяется к действию чтения: grep и glob по запечатанному слою deny', () => {
    const actions = ['read', 'grep', 'glob'] as const;
    for (const action of actions) {
      expect(memorySeal('executor', [`.oc3/${action}.yml`], root)).toContain('memory seal');
    }
  });
});

describe('docsGuard', () => {
  it('документацию пишет только librarian', async () => {
    expect(await docsGuard('executor', ['.oc3/data/entities/a.yml'], root)).toContain('librarian');
    expect(await docsGuard('judge', ['CHANGELOG.md'], root)).toContain('librarian');
    expect(await docsGuard(undefined, ['.oc3/skills.yml'], root)).toContain('librarian');
    expect(await docsGuard('executor', ['.oc3/modules/watchers.yml'], root)).toContain('librarian');
    expect(await docsGuard('librarian', ['.oc3/a.md'], root)).toBeUndefined();
    expect(await docsGuard('executor', ['src/index.ts'], root)).toBeUndefined();
    expect(await docsGuard('judge', ['.oc3/goals/a.expect.ts'], root)).toBeUndefined();
    expect(await docsGuard('executor', ['docs-generator.ts'], root)).toBeUndefined();
    expect(await docsGuard('judge', ['packages/cli/CHANGELOG.md'], root)).toBeUndefined();
    expect(await docsGuard('executor', ['src/commands/docs/index.ts'], root)).toBeUndefined();
  });

  it('маркер установки снимает guard', async () => {
    await mkdir(path.join(root, '.oc3/locks/install'), { recursive: true });
    expect(await docsGuard('executor', ['.oc3/project.yml'], root)).toBeUndefined();
    expect(await docsGuard('executor', ['CHANGELOG.md'], root)).toBeUndefined();
    expect(await docsGuard('executor', ['.oc3/data/entities/a.yml'], root)).toBeUndefined();
  });
});

describe('generatedGuard', () => {
  it('маркированные генерируемые файлы deny, немаркированные allow', async () => {
    await mkdir(path.join(root, '.opencode/agents'), { recursive: true });
    const agent = path.join(root, '.opencode/agents/judge.md');
    await writeFile(
      agent,
      '# generated by ai adapters sync from agents/judge.md — do not edit\nmode: subagent\n',
    );
    const manual = path.join(root, '.opencode/agents/manual.md');
    await writeFile(manual, '---\ndescription: ручной файл без метки генерации\n');
    expect(await generatedGuard('executor', [agent], root)).toContain('generated guard');
    expect(await generatedGuard(undefined, [agent], root)).toContain('generated guard');
    expect(await generatedGuard('executor', ['.opencode/agents/judge.md'], root)).toContain(
      'generated guard',
    );
    expect(await generatedGuard('executor', ['./.opencode/agents/judge.md'], root)).toContain(
      'generated guard',
    );
    expect(await generatedGuard('librarian', [agent], root)).toBeUndefined();
    expect(await generatedGuard('executor', [manual], root)).toBeUndefined();
    expect(await generatedGuard('executor', ['.opencode/opencode.jsonc'], root)).toBeUndefined();
    expect(await generatedGuard('executor', ['.opencode/agents/absent.md'], root)).toBeUndefined();
    expect(await generatedGuard('executor', ['src/index.ts'], root)).toBeUndefined();
  });
});

describe('memoryGuard', () => {
  it('запрещает память вне репозитория и не трогает файлы проекта', () => {
    const project = '/project';
    expect(
      memoryGuard(['/home/u/.local/share/opencode/projects/x/memory/y.md'], project),
    ).toContain('memory guard');
    expect(memoryGuard(['~/'.concat('.config/opencode/x/memory/y.json')], project)).toContain(
      'memory guard',
    );
    expect(memoryGuard(['/project/src/memory/buf.ts'], project)).toBeUndefined();
  });
});

describe('runGate', () => {
  it('пропускает незавершённые циклы и режет завершённые', () => {
    expect(runGate([{ file: '.oc3/goals/a.expect.json', runs: 0, retry: false }])).toBeUndefined();
    expect(runGate([{ file: '.oc3/goals/a.expect.json', runs: 1, retry: false }])).toBeUndefined();
    expect(runGate([{ file: '.oc3/goals/a.expect.json', runs: 2, retry: false }])).toContain(
      'попытка завершена',
    );
    expect(runGate([{ file: '.oc3/goals/a.expect.json', runs: 2, retry: true }])).toBeUndefined();
    expect(runGate([{ file: '.oc3/goals/a.expect.json', runs: 3, retry: true }])).toContain(
      'исчерпаны',
    );
  });
});
