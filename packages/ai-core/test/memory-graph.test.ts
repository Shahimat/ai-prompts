import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMemory } from '#commands/memory/index';
import { buildBundles, checkBundles, writeGraph } from '#lib/memory-graph';

let root: string;
let log: string[];
let err: string[];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ai-memory-graph-'));
  log = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => {
    log.push(a.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...a) => {
    err.push(a.join(' '));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
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
        summary: { type: 'integer', minimum: 1 },
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

const CONVENTIONS_SCHEMA = JSON.stringify({
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
});

const ENTITIES_SCHEMA = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'namespace', 'summary'],
  properties: {
    id: { type: 'string' },
    namespace: { type: 'string' },
    summary: { type: 'string' },
  },
});

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
}

interface FixtureOptions {
  manifest?: Record<string, unknown>;
  goals?: string[];
  skills?: string;
}

async function fixture(options: FixtureOptions = {}): Promise<void> {
  await put(
    '.oc3/manifest.json',
    JSON.stringify(
      options.manifest ?? {
        namespace: ['code', 'docs'],
        data: ['entities'],
        budgets: { notes: 4096, start: 24576, node: 16384, optional_field: 3 },
        files: {
          'conventions/code.yml': { namespace: ['code'], weight: 1 },
          'data/entities/user.yml': { namespace: ['code'], weight: 2 },
          'manuals/how.md': { namespace: ['code', 'docs'], weight: 1 },
        },
      },
    ),
  );
  await put('.oc3/doc/data/__schemas/manifest.schema.json', MANIFEST_SCHEMA);
  await put('.oc3/doc/data/__schemas/conventions.schema.json', CONVENTIONS_SCHEMA);
  await put('.oc3/doc/data/__schemas/entities.schema.json', ENTITIES_SCHEMA);
  await put(
    '.oc3/doc/project.yml',
    'name: demo\nsummary: Демо-проект памяти\nroles:\n  models:\n    executor: zai/demo#max\nstack: [typescript, node]\n',
  );
  await put(
    '.oc3/doc/conventions/code.yml',
    '- key: no-any\n  summary: any в коде запрещён\n  rule: Данные сужаются проверками, без as T и not-null.\n',
  );
  await put(
    '.oc3/doc/data/entities/user.yml',
    'id: user\nnamespace: code\nsummary: Пользователь проекта\n',
  );
  await put(
    '.oc3/doc/manuals/how.md',
    '# Как собрать проект\n\nЗапусти npm run build в корне репозитория.\n',
  );
  if (options.goals !== undefined) {
    const [file, ...rest] = options.goals;
    if (file !== undefined) await put(file, rest.join(''));
  }
  if (options.skills !== undefined) await put('.oc3/skills.yml', options.skills);
}

const bundles = async (): Promise<string[]> =>
  (await readdir(path.join(root, '.oc3', 'bundles'))).sort();

const goalFile = `import { budget, describe } from 'vitest';
budget({ crit: 0, warn: 0 });
describe('goal: demo — демо-цель', () => {
  describe('ticket: demo-one', () => {});
  it('шаг демо', () => {});
});
`;

const skillsYml = `skills:
  - key: executor
    kind: core
    roles: [executor]
  - key: librarian
    kind: core
    roles: [librarian]
`;

describe('renderGraph', () => {
  it('старт: инлайн, веер, каталог skills и заголовки goals одной строкой', async () => {
    await fixture({ goals: ['.oc3/goals/demo.expect.ts', goalFile], skills: skillsYml });
    const graph = await buildBundles(root);
    expect(graph.graph).not.toBeNull();
    const graphData = graph.graph;
    if (graphData === null) return;
    await writeGraph(root, graphData);
    const start = await readFile(path.join(root, '.oc3', 'bundles', 'index.md'), 'utf8');
    expect(start).toContain('## project.yml');
    expect(start).toContain('roles.models.executor — zai/demo#max');
    expect(start).toContain('- [code:1](');
    expect(start).toMatch(/- \[code:1\]\([0-9a-f]{12}\/index\.md\) — sha [0-9a-f]{12}, файлов 2/);
    expect(start).toContain('- [code:2](');
    expect(start).toContain('- [docs:1](');
    expect(start).toContain('- executor — core, роли: executor');
    expect(start).toContain('- goal: demo — демо-цель');
    expect(start).toContain('- ticket: demo-one');
    expect(start).toContain('- шаг демо');
    expect(start).not.toContain('## conventions/code.yml');
  });

  it('файл с несколькими namespace попадает в узел каждого', async () => {
    await fixture();
    const report = await buildBundles(root);
    const graph = report.graph;
    if (graph === null) throw new Error('нет графа');
    const code1 = graph.nodes.find((n) => n.key === 'code:1');
    const docs1 = graph.nodes.find((n) => n.key === 'docs:1');
    expect(code1?.files).toContain('manuals/how.md');
    expect(code1?.files).toContain('conventions/code.yml');
    expect(docs1?.files).toEqual(['manuals/how.md']);
    expect(graph.nodes.map((n) => n.key)).toEqual(['code:1', 'docs:1', 'code:2']);
  });

  it('узел: ссылки на файлы с пояснением и ребро на кольцо N+1 своего namespace', async () => {
    await fixture();
    const report = await buildBundles(root);
    const graph = report.graph;
    if (graph === null) throw new Error('нет графа');
    await writeGraph(root, graph);
    const code1 = graph.nodes.find((n) => n.key === 'code:1');
    if (code1 === undefined) throw new Error('нет узла code:1');
    const text = await readFile(path.join(root, '.oc3', 'bundles', code1.dir, 'index.md'), 'utf8');
    expect(text).toContain(`SHA: ${code1.sha}`);
    expect(text).toContain('Кольцо: 1');
    expect(text).toContain(
      '- [conventions/code.yml](../doc/conventions/code.yml) — 1 записей, первая: no-any',
    );
    expect(text).toContain(
      '- [manuals/how.md](../doc/manuals/how.md) — инструкция: Как собрать проект',
    );
    const code2 = graph.nodes.find((n) => n.key === 'code:2');
    expect(text).toContain(`- [code:2](${code2?.dir}/index.md)`);
    expect(text).not.toContain('docs:1');
    expect(code1.dir).toHaveLength(12);
  });

  it('имя узла — sha12 рендера; смена весов меняет префикс', async () => {
    await fixture();
    const first = await buildBundles(root);
    const firstGraph = first.graph;
    if (firstGraph === null) throw new Error('нет графа');
    const firstDirs = firstGraph.nodes.map((n) => n.dir).sort();
    await put(
      '.oc3/manifest.json',
      JSON.stringify({
        namespace: ['code', 'docs'],
        data: ['entities'],
        budgets: { notes: 4096, start: 24576, node: 16384, optional_field: 3 },
        files: {
          'conventions/code.yml': { namespace: ['code'], weight: 2 },
          'data/entities/user.yml': { namespace: ['code'], weight: 2 },
          'manuals/how.md': { namespace: ['code', 'docs'], weight: 1 },
        },
      }),
    );
    const second = await buildBundles(root);
    const secondGraph = second.graph;
    if (secondGraph === null) throw new Error('нет графа');
    const secondDirs = secondGraph.nodes.map((n) => n.dir).sort();
    expect(secondDirs).not.toEqual(firstDirs);
    expect(secondGraph.nodes.find((n) => n.key === 'code:2')?.files).toEqual([
      'conventions/code.yml',
      'data/entities/user.yml',
    ]);
  });
});

describe('writeGraph', () => {
  it('повторный build идемпотентен и удаляет стухшие каталоги', async () => {
    await fixture();
    const first = await buildBundles(root);
    const graph = first.graph;
    if (graph === null) throw new Error('нет графа');
    await writeGraph(root, graph);
    const firstText = await readFile(path.join(root, '.oc3', 'bundles', 'index.md'), 'utf8');
    const dirs = await bundles();
    await mkdir(path.join(root, '.oc3', 'bundles', 'deadbeefdead'), { recursive: true });
    await writeFile(path.join(root, '.oc3', 'bundles', 'deadbeefdead', 'index.md'), 'стух', 'utf8');
    const removed = await writeGraph(root, graph);
    expect(removed).toBe(1);
    expect(await bundles()).toEqual(dirs);
    expect(await readFile(path.join(root, '.oc3', 'bundles', 'index.md'), 'utf8')).toBe(firstText);
  });
});

describe('checkBundles', () => {
  it('без бандлов диагностик о отсутствии нет, свежие бандлы проходят', async () => {
    await fixture();
    const before = await checkBundles(root);
    expect(before.diagnostics).toEqual([]);
    const report = await buildBundles(root);
    const graph = report.graph;
    if (graph === null) throw new Error('нет графа');
    await writeGraph(root, graph);
    const after = await checkBundles(root);
    expect(after.diagnostics).toEqual([]);
  });

  it('изменение факта и стухший каталог — громкая диагностика с указанием на build', async () => {
    await fixture();
    const report = await buildBundles(root);
    const graph = report.graph;
    if (graph === null) throw new Error('нет графа');
    await writeGraph(root, graph);
    await put(
      '.oc3/doc/conventions/code.yml',
      '- key: no-any\n  summary: any запрещён вдвойне\n  rule: Данные сужаются проверками.\n',
    );
    const stale = await checkBundles(root);
    expect(stale.diagnostics.some((d) => d.message.includes('стух'))).toBe(true);
    expect(stale.diagnostics.some((d) => d.file.endsWith('bundles/index.md'))).toBe(true);
    const rebuilt = await buildBundles(root);
    const rebuiltGraph = rebuilt.graph;
    if (rebuiltGraph === null) throw new Error('нет графа');
    await writeGraph(root, rebuiltGraph);
    const fresh = await checkBundles(root);
    expect(fresh.diagnostics).toEqual([]);
    const staleDir = graph.nodes.find((n) => n.key === 'code:1')?.dir;
    expect(staleDir).toBeDefined();
    if (staleDir === undefined) return;
    expect(await bundles()).not.toContain(staleDir);
  });

  it('превышение cap старта — отказ с перечнем действий', async () => {
    await fixture({
      manifest: {
        namespace: ['code', 'docs'],
        data: ['entities'],
        budgets: { notes: 4096, start: 100, node: 16384, optional_field: 3 },
        files: {
          'conventions/code.yml': { namespace: ['code'], weight: 1 },
          'data/entities/user.yml': { namespace: ['code'], weight: 2 },
          'manuals/how.md': { namespace: ['code', 'docs'], weight: 1 },
        },
      },
    });
    const report = await checkBundles(root);
    expect(report.diagnostics.some((d) => d.message.includes('cap 100'))).toBe(true);
    const code = await runMemory('build', { root, now: new Date() });
    expect(code).toBe(1);
    expect(err.some((l) => l.includes('cap 100'))).toBe(true);
    expect(await readdir(path.join(root, '.oc3')).catch(() => [])).not.toContain('bundles');
  });
});

describe('renderGraph renders', () => {
  it('узел — каталог: ссылка с пояснением, полный текст факта не инлайнится', async () => {
    await fixture();
    const report = await buildBundles(root);
    const graph = report.graph;
    if (graph === null) throw new Error('нет графа');
    const start = graph.start;
    expect(start).not.toMatch(/^(namespace|weight|files):/m);
    expect(start).not.toMatch(/^- key: /m);
    const code1 = graph.nodes.find((n) => n.key === 'code:1');
    expect(code1?.text).toContain(
      '- [conventions/code.yml](../doc/conventions/code.yml) — 1 записей, первая: no-any',
    );
    expect(code1?.text).toContain('- [manuals/how.md](../doc/manuals/how.md) — инструкция: ');
    expect(code1?.text).not.toContain('Запусти npm run build в корне репозитория');
    const user = graph.nodes.find((n) => n.key === 'code:2');
    expect(user?.text).toContain(
      '- [data/entities/user.yml](../doc/data/entities/user.yml) — user — домен code. Пользователь проекта',
    );
  });

  it('длинный факт — короткое пояснение по budgets.summary, без дубля текста', async () => {
    await fixture({
      manifest: {
        namespace: ['code'],
        data: ['entities'],
        budgets: { notes: 4096, start: 24576, node: 16384, optional_field: 3, summary: 80 },
        files: { 'data/entities/user.yml': { namespace: ['code'], weight: 1 } },
      },
    });
    const longSummary = 'Очень длинное пояснение проекта про пользователей и их роли. '.repeat(6);
    await put(
      '.oc3/doc/data/entities/user.yml',
      `id: user\nnamespace: code\nsummary: ${longSummary}\n`,
    );
    const report = await buildBundles(root);
    const graph = report.graph;
    if (graph === null) throw new Error('нет графа');
    const node = graph.nodes.find((n) => n.key === 'code:1');
    if (node === undefined) throw new Error('нет узла code:1');
    const line = node.text
      .split('\n')
      .find((l) => l.startsWith('- [data/entities/user.yml](../doc/data/entities/user.yml)'));
    if (line === undefined) throw new Error('нет строки каталога для факта');
    const note = line.slice('- [data/entities/user.yml](../doc/data/entities/user.yml) — '.length);
    expect(Buffer.byteLength(note, 'utf8')).toBeLessThanOrEqual(80);
    expect(note).toContain('…');
    expect(node.text).not.toContain(longSummary);
    const links = node.text.split('- [data/entities/user.yml](').length - 1;
    expect(links).toBe(1);
  });

  it('renderGraph строит веер без дубликатов узлов для общих файлов веса ≥1', async () => {
    await fixture({
      manifest: {
        namespace: ['code'],
        data: ['entities'],
        budgets: { notes: 4096, start: 24576, node: 16384, optional_field: 3 },
        files: { 'data/entities/user.yml': { namespace: [], weight: 1 } },
      },
    });
    const report = await buildBundles(root);
    const graph = report.graph;
    if (graph === null) throw new Error('нет графа');
    expect(graph.nodes.map((n) => n.key)).toEqual(['common:1']);
    expect(graph.nodes[0]?.files).toEqual(['data/entities/user.yml']);
    expect(graph.start).toContain('- [common:1](');
  });
});
