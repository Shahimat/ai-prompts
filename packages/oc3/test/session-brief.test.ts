import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendBriefing, briefingLine, memoryStart, type BriefingSystem } from '#session-brief';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oc3-session-brief-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const MANIFEST_SCHEMA = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['namespace', 'data'],
  properties: {
    namespace: { type: 'array', items: { type: 'string' } },
    data: { type: 'array', items: { type: 'string' } },
    budgets: {
      type: 'object',
      additionalProperties: false,
      properties: {
        notes: { type: 'integer', minimum: 1 },
        start: { type: 'integer', minimum: 1 },
        node: { type: 'integer', minimum: 1 },
        optional_field: { type: 'integer', minimum: 1 },
      },
    },
    files: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        properties: {
          namespace: { type: 'array', items: { type: 'string' } },
          weight: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
});

const put = async (rel: string, content: string): Promise<void> => {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
};

const memoryFixture = async (manifest: Record<string, unknown>): Promise<void> => {
  await put('.oc3/doc/data/__schemas/manifest.schema.json', MANIFEST_SCHEMA);
  await put('.oc3/doc/data/__schemas/conventions.schema.json', JSON.stringify({ type: 'array' }));
  await put('.oc3/doc/data/__schemas/glossary.schema.json', JSON.stringify({ type: 'array' }));
  await put('.oc3/manifest.json', JSON.stringify(manifest));
  await put('.oc3/doc/project.yml', 'name: demo\nsummary: Демо-проект памяти\n');
};

async function putProject(text: string): Promise<void> {
  await mkdir(path.join(root, '.oc3', 'doc'), { recursive: true });
  await writeFile(path.join(root, '.oc3', 'doc', 'project.yml'), text, 'utf8');
}

describe('briefingLine', () => {
  it('режим из project.yml попадает в строку с отсылкой к skill workflow', async () => {
    await putProject('briefing:\n  mode: roles\n');
    const line = await briefingLine(root);
    expect(line.startsWith('брифинг:')).toBe(true);
    expect(line).toContain('режим roles');
    expect(line).toContain('до ролей и тикетов спроси');
    expect(line).toContain('skill workflow');
  });

  it('custom добавляет поля режима в скобках', async () => {
    await putProject('briefing:\n  mode: custom\n  routing: executor\n  judge: on\n');
    const line = await briefingLine(root);
    expect(line).toContain('режим custom');
    expect(line).toContain('routing: executor');
    expect(line).toContain('judge: on');
  });

  it('нет блока briefing — дежурная строка про дефолт cheap', async () => {
    await putProject('name: demo\nsummary: Демо\n');
    const line = await briefingLine(root);
    expect(line).toContain('режим не задан');
    expect(line).toContain('дефолт проекта — cheap');
    expect(line).toContain('до старта спроси');
    expect(line).toContain('oc3.briefing_done');
  });

  it('нет project.yml, битый yaml и не-строчный mode — дежурная строка', async () => {
    expect(await briefingLine(root)).toContain('режим не задан');
    await putProject('briefing: [unclosed');
    expect(await briefingLine(root)).toContain('режим не задан');
    await putProject('briefing:\n  mode: 5\n');
    expect(await briefingLine(root)).toContain('режим не задан');
  });

  it('строки ведут вызвать briefing_done после текстового ответа на вопрос схемы', async () => {
    await putProject('briefing:\n  mode: roles\n');
    const line = await briefingLine(root);
    expect(line).toContain(
      'работаем в дефолте проекта или собираешь кастом на сессию (роли и модели можно добавить или убрать)',
    );
    expect(line).toContain('дефолт проекта — режим roles');
    expect(line.indexOf('кастом на сессию')).toBeLessThan(line.indexOf('oc3.briefing_done'));
    expect(await briefingLine(root)).toContain('oc3.briefing_done');
    await putProject('name: demo\n');
    expect(await briefingLine(root)).toContain('достаточно текстового ответа');
  });
});

describe('appendBriefing', () => {
  it('строка попадает в системный промпт сессии один раз', async () => {
    await putProject('briefing:\n  mode: roles\n');
    const seen = new Set<string>();
    const first: BriefingSystem = {
      system: [{ type: 'text', text: 'базовый системный промпт' }],
    };
    await appendBriefing(first, root, seen, 's1');
    expect(first.system.length).toBe(2);
    expect(first.system.at(1)?.text).toContain('режим roles');
    const second: BriefingSystem = { system: [{ type: 'text', text: 'второй запрос' }] };
    await appendBriefing(second, root, seen, 's1');
    expect(second.system.length).toBe(1);
    const next: BriefingSystem = { system: [] };
    await appendBriefing(next, root, seen, 's2');
    expect(next.system.length).toBe(1);
    expect(next.system.at(0)?.text).toContain('режим roles');
  });

  it('без project.yml строка всё равно добавляется и сессия помечается', async () => {
    const seen = new Set<string>();
    const input: BriefingSystem = { system: [] };
    await appendBriefing(input, root, seen, 's1');
    expect(input.system.length).toBe(1);
    expect(input.system.at(0)?.text).toContain('дефолт проекта — cheap');
    expect(seen.has('s1')).toBe(true);
  });
});

describe('memoryStart — вшивание стартового графа', () => {
  it('свежие бандлы: стартовый index попадает в системный промпт один раз на сессию', async () => {
    await memoryFixture({ namespace: [], data: [] });
    const first = await memoryStart(root);
    expect(first.diagnostics).toEqual([]);
    expect(first.text).toContain('# Память проекта');
    expect(first.text).toContain('Демо-проект памяти');
    const seen = new Set<string>();
    const input: BriefingSystem = { system: [] };
    await appendBriefing(input, root, seen, 's1');
    expect(input.system.some((p) => p.text.includes('# Память проекта'))).toBe(true);
    const second: BriefingSystem = { system: [] };
    await appendBriefing(second, root, seen, 's1');
    expect(second.system.some((p) => p.text.includes('# Память проекта'))).toBe(false);
  });

  it('холодный старт и стухшие бандлы: build выполняется на месте, стухий каталог удаляется', async () => {
    await memoryFixture({
      namespace: ['docs'],
      data: [],
      files: { 'manuals/how.md': { namespace: ['docs'], weight: 1 } },
    });
    await put('.oc3/doc/manuals/how.md', '# Как собрать\n\nnpm run build.\n');
    await put('.oc3/doc/data/__schemas/glossary.schema.json', JSON.stringify({ type: 'array' }));
    const cold = await memoryStart(root);
    expect(cold.diagnostics).toEqual([]);
    expect(cold.text).toContain('# Память проекта');
    const dirs = await readdir(path.join(root, '.oc3', 'bundles'));
    expect(dirs).toHaveLength(2);
    const dirsNoIndex = dirs.filter((d) => d !== 'index.md');
    expect(dirsNoIndex).toHaveLength(1);
    const nodeDir = path.join(root, '.oc3', 'bundles', dirsNoIndex[0] ?? '');
    expect(await readFile(path.join(nodeDir, 'index.md'), 'utf8')).toContain('manuals/how.md');
    await mkdir(path.join(root, '.oc3', 'bundles', 'deadbeefdead'), { recursive: true });
    const stale = await memoryStart(root);
    expect(stale.diagnostics).toEqual([]);
    expect(stale.text).toContain('# Память проекта');
    expect(await readdir(path.join(root, '.oc3', 'bundles'))).toEqual(dirs);
  });

  it('крит после сборки (переполнение старта) — без вшивания, с диагностиками', async () => {
    await memoryFixture({ namespace: [], data: [], budgets: { start: 5 } });
    const report = await memoryStart(root);
    expect(report.text).toBe('');
    expect(report.diagnostics.length).toBeGreaterThan(0);
    expect(report.diagnostics.some((d) => d.message.includes('cap 5'))).toBe(true);
  });

  it('нет манифеста — без памяти и без аварий', async () => {
    const report = await memoryStart(root);
    expect(report.text).toBe('');
    expect(report.diagnostics.some((d) => d.message.includes('нет манифеста'))).toBe(true);
  });
});
