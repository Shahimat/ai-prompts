import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkMemory, compileSchema, isRecord, type Validate } from '@shahimat/ai-core';
import { ensureMemorySkeleton } from '#install';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oc3-memory-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const put = async (rel: string, text: string): Promise<void> => {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, text, 'utf8');
};

const read = async (rel: string): Promise<string> => readFile(path.join(root, rel), 'utf8');

const MANIFEST_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: '.oc3/manifest.json — реестр памяти: namespace, data-структуры, бюджеты',
  type: 'object',
  additionalProperties: false,
  required: ['namespace', 'data'],
  properties: {
    namespace: {
      type: 'array',
      items: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
    },
    data: {
      type: 'array',
      items: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
    },
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
          namespace: {
            type: 'array',
            items: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
          },
          weight: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
};

const FORM_SCHEMAS: Record<string, string> = {
  'manifest.schema.json': JSON.stringify(MANIFEST_SCHEMA),
  'entities.schema.json': JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'namespace', 'summary'],
    properties: {
      id: { type: 'string' },
      namespace: { type: 'string' },
      summary: { type: 'string' },
    },
  }),
  'behavior.schema.json': JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'namespace', 'title'],
    properties: {
      id: { type: 'string' },
      namespace: { type: 'string' },
      title: { type: 'string' },
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

const seedFactFiles = async (): Promise<void> => {
  await put('.oc3/doc/project.yml', 'name: demo\n');
  await put('.oc3/doc/autonomy.yml', 'levels:\n  never: [vcs.write]\n');
  await put(
    '.oc3/doc/glossary/common.yml',
    '- term: воркспейс\n  definition: корень репозитория\n',
  );
  await put(
    '.oc3/doc/conventions/naming.yml',
    '- key: kebab\n  summary: имена файлов\n  rule: kebab-case\n',
  );
  await put('.oc3/doc/data/entities/srv.yml', 'id: srv\nnamespace: vpn\nsummary: сервер\n');
  await put('.oc3/doc/data/behavior/flow.yml', 'id: flow\nnamespace: vpn\ntitle: рукопожатие\n');
  await put('.oc3/doc/data/__schemas/entities.schema.json', '{}');
  await put('.oc3/doc/manuals/first-run.md', '# Первый запуск\n');
  await put('.oc3/doc/knowledge/tooling.md', '# Тулинг\n');
};

const readManifest = async (): Promise<Record<string, unknown>> => {
  const data: unknown = JSON.parse(await read('.oc3/manifest.json'));
  if (!isRecord(data)) throw new Error('манифест не объект');
  return data;
};

describe('ensureMemorySkeleton', () => {
  it('greenfield: манифест перечисляет все файлы фактов с дефолтными весами и бюджетами', async () => {
    await seedFactFiles();

    const lines = await ensureMemorySkeleton(root);

    expect(lines.join('\n')).toContain('скелет');
    expect(await readManifest()).toEqual({
      namespace: [],
      data: ['behavior', 'entities'],
      budgets: { notes: 4096, start: 24576, node: 16384, optional_field: 3 },
      files: {
        'autonomy.yml': { namespace: [], weight: 0 },
        'project.yml': { namespace: [], weight: 0 },
        'conventions/naming.yml': { namespace: [], weight: 2 },
        'data/behavior/flow.yml': { namespace: [], weight: 2 },
        'data/entities/srv.yml': { namespace: [], weight: 2 },
        'glossary/common.yml': { namespace: [], weight: 0 },
        'knowledge/tooling.md': { namespace: [], weight: 2 },
        'manuals/first-run.md': { namespace: [], weight: 2 },
      },
    });
  });

  it('создаёт NOTES.md с заголовком по умолчанию', async () => {
    await seedFactFiles();

    await ensureMemorySkeleton(root);

    expect(await read('.oc3/NOTES.md')).toBe('# NOTES — неформальные факты до формализации\n');
  });

  it('скелет проходит схему манифеста и checkMemory без замечаний к манифесту', async () => {
    await seedFactFiles();
    for (const [name, schema] of Object.entries(FORM_SCHEMAS))
      await put(`.oc3/doc/data/__schemas/${name}`, schema);

    await ensureMemorySkeleton(root);

    const validate: Validate = compileSchema(MANIFEST_SCHEMA);
    expect(validate(await readManifest())).toEqual([]);
    const { diagnostics } = await checkMemory(root);
    expect(diagnostics.filter((d) => d.file === '.oc3/manifest.json')).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it('повторный прогон: пользовательские веса и namespace сохраняются, новые файлы дописываются', async () => {
    await put('.oc3/doc/project.yml', 'name: demo\n');
    await put(
      '.oc3/doc/conventions/naming.yml',
      '- key: kebab\n  summary: имена\n  rule: kebab-case\n',
    );
    await ensureMemorySkeleton(root);
    const custom = await readManifest();
    const files = isRecord(custom['files']) ? custom['files'] : {};
    files['conventions/naming.yml'] = { namespace: ['docs'], weight: 5 };
    custom['namespace'] = ['docs'];
    await put('.oc3/manifest.json', `${JSON.stringify(custom, null, 2)}\n`);
    await put(
      '.oc3/doc/conventions/format.yml',
      '- key: fmt\n  summary: формат\n  rule: prettier\n',
    );

    const lines = await ensureMemorySkeleton(root);

    expect(lines.join('\n')).toContain('merge');
    const next = await readManifest();
    expect(next['namespace']).toEqual(['docs']);
    const nextFiles = isRecord(next['files']) ? next['files'] : {};
    expect(nextFiles['conventions/naming.yml']).toEqual({ namespace: ['docs'], weight: 5 });
    expect(nextFiles['conventions/format.yml']).toEqual({ namespace: [], weight: 2 });
    expect(nextFiles['project.yml']).toEqual({ namespace: [], weight: 0 });
  });

  it('невалидный JSON манифеста — merge пропущен, файл не тронут', async () => {
    await put('.oc3/doc/project.yml', 'name: demo\n');
    await put('.oc3/manifest.json', '{ битый json');

    const lines = await ensureMemorySkeleton(root);

    expect(lines.join('\n')).toContain('невалидный JSON');
    expect(await read('.oc3/manifest.json')).toBe('{ битый json');
  });

  it('NOTES.md пользователя не перетирается', async () => {
    await put('.oc3/doc/project.yml', 'name: demo\n');
    await put('.oc3/NOTES.md', '# мои заметки\n');

    const lines = await ensureMemorySkeleton(root);

    expect(lines.join('\n')).toContain('уже есть');
    expect(await read('.oc3/NOTES.md')).toBe('# мои заметки\n');
  });
});
