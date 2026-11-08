import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTreeSchema, checkOc3Tree, mandateOf, type TreeManifest } from '#commands/tree/index';
import { isRecord } from '#shared/guards';

let root: string;

const put = async (rel: string, content: string): Promise<void> => {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
};

const files = async (): Promise<string[]> =>
  (await checkOc3Tree(root)).diagnostics.map((d) => `${d.file}: ${d.message}`);

const EMPTY: TreeManifest = { data: [], files: [], layout: undefined, ok: true };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ai-tree-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('buildTreeSchema', () => {
  const record = (value: unknown): Record<string, unknown> => {
    if (!isRecord(value)) throw new Error('схема не объект');
    return value;
  };

  it('стандартный документ draft 2020-12', () => {
    const schema = record(buildTreeSchema(EMPTY));
    expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema['type']).toBe('array');
  });

  it('data из манифеста расширяет схему, files и layout — тоже', () => {
    const schema = record(
      buildTreeSchema({
        data: ['entities', 'glossary-facts'],
        files: ['knowledge/tooling.md'],
        layout: { pattern: '^glossary/[^/]+\\.yml$' },
        ok: true,
      }),
    );
    const defs = record(schema['$defs']);
    const entry = record(defs['entry']);
    const oneOf = Array.isArray(entry['anyOf']) ? entry['anyOf'] : [];
    const text = JSON.stringify(oneOf);
    expect(text).toContain('glossary-facts');
    expect(text).toContain('knowledge/tooling.md');
    expect(text).toContain('^glossary/');
  });
});

describe('checkOc3Tree', () => {
  it('ядро валидно: константные имена корня и namespace без диагностик', async () => {
    await put('.oc3/project.yml', 'name: demo\n');
    await put('.oc3/autonomy.yml', 'levels: {}\n');
    await put('.oc3/conventions/naming.yml', 'key: naming\n');
    await put('.oc3/data/entities/srv.yml', 'id: srv\n');
    await put('.oc3/data/behavior/flow.yml', 'id: flow\n');
    await put('.oc3/data/__schemas/entities.schema.json', '{"type":"object"}');
    await put('.oc3/manuals/first-run.md', '# Первый запуск\n');
    await put('.oc3/goals/demo.expect.ts', "describe('goal', () => {});\n");
    await put('.oc3/bundles/index.md', '# Память\n');
    await put('.oc3/bundles/deadbeefdead/index.md', '# Узел\n');
    await put('.oc3/modules/ops.yml', 'provides: {}\n');
    await put('.oc3/research/t/find.md', 'находка\n');
    await put('.oc3/verdicts/t/1.yml', 'run: 1\n');
    await put('.oc3/.delta/naming.yml', 'summary: s\n');
    await put('.oc3/skills.yml', 'skills: []\n');
    await put('.oc3/ai-core.yml', 'checks: {}\n');
    expect(await files()).toEqual([]);
  });

  it('новая data-структура в манифесте валидна без правки кода', async () => {
    await put(
      '.oc3/manifest.json',
      JSON.stringify({ namespace: ['docs'], data: ['entities', 'life'] }),
    );
    await put('.oc3/data/entities/srv.yml', 'id: srv\n');
    await put('.oc3/data/life/sleep.yml', 'id: sleep\n');
    expect(await files()).toEqual([]);
  });

  it('data-структура вне манифеста — diagnostic с поручением librarian', async () => {
    await put('.oc3/manifest.json', JSON.stringify({ namespace: ['docs'], data: ['entities'] }));
    await put('.oc3/data/entities/srv.yml', 'id: srv\n');
    await put('.oc3/data/life/sleep.yml', 'id: sleep\n');
    const out = await files();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(
      /^\.oc3\/data\/life\/sleep\.yml: приведи \.oc3\/data\/life\/sleep\.yml к схеме: data\/ — .+; нарушение: /,
    );
  });

  it('неизвестный каталог вне схемы — diagnostic', async () => {
    await put('.oc3/project.yml', 'name: demo\n');
    await put('.oc3/notes/scratch.md', 'заметка\n');
    const out = await files();
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('имя «notes» вне схемы .oc3/');
    expect(out[0]).toContain('объяви в manifest.json (data / files / layout)');
  });

  it('имя из ядра не на своём уровне — diagnostic', async () => {
    await put('.oc3/project.yml', 'name: demo\n');
    await put('.oc3/data/conventions/naming.yml', 'key: naming\n');
    const out = await files();
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('data/ — data/<entities|behavior|__schemas|имя из манифеста>/');
    expect(out[0]).toContain('«conventions» на этом уровне не входит в схему');
  });

  it('файл вне namespace манифеста — diagnostic с указанием на files', async () => {
    await put(
      '.oc3/manifest.json',
      JSON.stringify({ namespace: ['docs'], data: [], files: { 'knowledge/tooling.md': {} } }),
    );
    await put('.oc3/knowledge/tooling.md', '# Тулинг\n');
    await put('.oc3/knowledge/extra.md', '# Лишний\n');
    const out = await files();
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('файлы knowledge/ допустимы только по манифесту');
    expect(out[0]).toContain('добавь «knowledge/extra.md» в manifest.json → files');
  });

  it('layout-фрагмент манифеста расширяет схему: каталог манифеста валиден', async () => {
    await put(
      '.oc3/manifest.json',
      JSON.stringify({
        namespace: ['docs'],
        data: [],
        layout: { pattern: '^glossary/[^/]+\\.yml$' },
      }),
    );
    await put('.oc3/glossary/common.yml', '- term: api\n');
    expect(await files()).toEqual([]);
  });

  it('чужой файл в bundles — diagnostic: сгенерированная область', async () => {
    await put('.oc3/bundles/random.md', '# не узел\n');
    const out = await files();
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('bundles/ — сгенерированная память');
  });

  it('generated projection/pages have narrow paths, invalid hashes and suffixes remain rejected', async () => {
    for (const name of ['index.md', 'page-000001.md', 'part-000001.md'])
      await put(`.oc3/bundles/files/${'a'.repeat(64)}/${name}`, '# projection\n');
    await put('.oc3/bundles/abcdef012345/page-000001.md', '# page\n');
    expect(await files()).toEqual([]);
    for (const rel of [
      'files/abc/index.md',
      `files/${'a'.repeat(64)}/part-1.md`,
      'abcdef012345/part-000001.md',
      'random.md',
    ])
      await put(`.oc3/bundles/${rel}`, '# invalid\n');
    expect((await files()).length).toBe(4);
  });

  it('нет .oc3 — только предупреждение, без диагностик', async () => {
    const report = await checkOc3Tree(root);
    expect(report.diagnostics).toEqual([]);
    expect(report.warnings).toHaveLength(1);
  });
});

describe('mandateOf', () => {
  it('файл манифеста в своём каталоге — поручение добавить в files', () => {
    const m: TreeManifest = { data: [], files: ['life/facts/a.yml'], layout: undefined, ok: true };
    expect(mandateOf('life/facts/b.yml', m)).toContain('добавь «life/facts/b.yml»');
  });
});
