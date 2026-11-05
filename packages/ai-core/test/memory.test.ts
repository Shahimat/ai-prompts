import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkMemory, DEFAULT_BUDGETS } from '#lib/memory';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ai-memory-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const SCHEMAS: Record<string, string> = {
  'manifest.schema.json': JSON.stringify({
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
    },
  }),
  'entities.schema.json': JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'namespace', 'summary'],
    properties: {
      id: { type: 'string' },
      namespace: { type: 'string' },
      summary: { type: 'string' },
      manuals: { type: 'array', items: { type: 'string' } },
    },
  }),
  'conventions.schema.json': JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'summary', 'rule'],
      properties: {
        key: { type: 'string' },
        summary: { type: 'string' },
        rule: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  }),
  'glossary.schema.json': JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['term', 'definition'],
      properties: { term: { type: 'string' }, definition: { type: 'string' } },
    },
  }),
};

const MANIFEST = JSON.stringify({
  namespace: [],
  data: ['entities'],
  budgets: { notes: 4096, start: 10240, node: 16384, optional_field: 3 },
});

const put = async (rel: string, text: string): Promise<void> => {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, text, 'utf8');
};

async function scaffold(): Promise<void> {
  for (const [name, text] of Object.entries(SCHEMAS))
    await put(`.oc3/doc/data/__schemas/${name}`, `${text}\n`);
  await put('.oc3/manifest.json', MANIFEST);
}

describe('checkMemory', () => {
  it('валидный набор — ноль нарушений и предупреждений', async () => {
    await scaffold();
    await put(
      '.oc3/doc/data/entities/srv.yml',
      'id: srv\nnamespace: vpn\nsummary: сервер\nmanuals: [first-run]\n',
    );
    await put(
      '.oc3/doc/conventions/common.yml',
      '- key: naming\n  summary: kebab-case\n  rule: имена в kebab-case\n',
    );
    await put(
      '.oc3/doc/glossary/common.yml',
      '- term: веер\n  definition: ссылки стартового index\n',
    );
    await put('.oc3/NOTES.md', '# NOTES\n');
    const { diagnostics, warnings } = await checkMemory(root);
    expect(diagnostics).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('нет манифеста или схем — crit с именем файла', async () => {
    const { diagnostics } = await checkMemory(root);
    expect(diagnostics.map((d) => d.file)).toContain('.oc3/manifest.json');
    await scaffold();
    await rm(path.join(root, '.oc3/doc/data/__schemas/manifest.schema.json'));
    const next = await checkMemory(root);
    expect(next.diagnostics.map((d) => d.file)).toContain(
      '.oc3/doc/data/__schemas/manifest.schema.json',
    );
  });

  it('файл структуры не по схеме — crit с путём и нарушением', async () => {
    await scaffold();
    await put('.oc3/doc/data/entities/bad.yml', 'id: bad\nsummary: нет namespace\n');
    const { diagnostics } = await checkMemory(root);
    const hit = diagnostics.filter((d) => d.file === '.oc3/doc/data/entities/bad.yml');
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.map((d) => d.message).join(' ')).toMatch(/must have required property/);
  });

  it('вложенный объект в значении и перекрёстное упоминание — crit', async () => {
    await scaffold();
    await put(
      '.oc3/doc/data/entities/note.yml',
      'id: note\nnamespace: vpn\nsummary: с примечанием\nnote:\n  text: вложено\n',
    );
    await put(
      '.oc3/doc/conventions/common.yml',
      '- key: refs\n  summary: см. convention naming\n  rule: правило без ссылок\n',
    );
    const { diagnostics } = await checkMemory(root);
    expect(
      diagnostics.filter((d) => d.file === '.oc3/doc/data/entities/note.yml').length,
    ).toBeGreaterThan(0);
    const cross = diagnostics.filter((d) => d.file === '.oc3/doc/conventions/common.yml');
    expect(cross.some((d) => d.message.includes('перекрёстное упоминание'))).toBe(true);
  });

  it('орфанная структура и неизвестное имя в data — crit по манифесту', async () => {
    await scaffold();
    await put('.oc3/doc/data/entities/ok.yml', 'id: ok\nnamespace: vpn\nsummary: s\n');
    await put('.oc3/doc/data/knowledge/k.yml', 'id: k\nnamespace: vpn\nsummary: s\n');
    const entities = SCHEMAS['entities.schema.json'];
    if (entities === undefined) throw new Error('нет схемы entities в наборе теста');
    await put('.oc3/doc/data/__schemas/knowledge.schema.json', entities);
    const { diagnostics } = await checkMemory(root);
    expect(
      diagnostics.some((d) => d.file === '.oc3/manifest.json' && d.message.includes('knowledge')),
    ).toBe(true);
  });

  it('бюджеты: дефолты применяются, NOTES сверх бюджета — crit', async () => {
    await scaffold();
    await put('.oc3/NOTES.md', `# NOTES\n\n${'слово '.repeat(1000)}\n`);
    const { diagnostics } = await checkMemory(root);
    const notes = diagnostics.filter((d) => d.file === '.oc3/NOTES.md');
    expect(notes.length).toBe(1);
    expect(notes[0]?.message).toMatch(/4096/);
    expect(DEFAULT_BUDGETS).toEqual({
      notes: 4096,
      start: 10240,
      node: 16384,
      optionalField: 3,
    });
  });

  it('опциональное поле сверх порога — WARN, не crit', async () => {
    await scaffold();
    for (const area of ['common', 'code', 'checking', 'docs'])
      await put(
        `.oc3/doc/conventions/${area}.yml`,
        `- key: ${area}-rule\n  summary: s\n  rule: r\n  reason: потому\n`,
      );
    const { diagnostics, warnings } = await checkMemory(root);
    expect(diagnostics).toEqual([]);
    expect(warnings.some((w) => w.message.includes('reason'))).toBe(true);
  });

  it('бюджет optional_field из манифеста меняет порог', async () => {
    await scaffold();
    await put(
      '.oc3/manifest.json',
      JSON.stringify({
        namespace: [],
        data: ['entities'],
        budgets: { notes: 4096, start: 10240, node: 16384, optional_field: 4 },
      }),
    );
    let body = '';
    for (const key of ['a', 'b', 'c', 'd'])
      body += `- key: ${key}\n  summary: s\n  rule: r\n  reason: потому\n`;
    await put('.oc3/doc/conventions/common.yml', body);
    const { warnings } = await checkMemory(root);
    expect(warnings).toEqual([]);
  });

  it('невалидный YAML факта — crit, валидатор не падает', async () => {
    await scaffold();
    await put('.oc3/doc/data/entities/broken.yml', 'id: [\n');
    const { diagnostics } = await checkMemory(root);
    expect(diagnostics.some((d) => d.message.includes('невалидный YAML'))).toBe(true);
  });
});
