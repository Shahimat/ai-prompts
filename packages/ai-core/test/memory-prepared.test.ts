import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { artifactPath } from '#lib/artifacts';
import { prepareProse, preparedFiles } from '#lib/memory-prepared';
import { boundedPages, inlineProse, projectionFiles, proseUnits } from '#lib/memory-projection';
import { renderGraph, renderMemoryGraph, type FactFile } from '#lib/memory-graph';
import { checkMemory } from '#lib/memory';
import { oldBoundedPages, oldProjectionFiles, oldProseUnits } from './memory-reference.js';

vi.mock('#lib/memory', async (original) => {
  const actual = await original<typeof import('#lib/memory')>();
  return { ...actual, checkMemory: vi.fn<typeof actual.checkMemory>(actual.checkMemory) };
});

const parent = artifactPath(path.resolve(import.meta.dirname, '..', '..', '..'), {
  kind: 'run',
  key: 'incremental-verification-final',
  name: 'memory-fixtures-v8',
});
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(checkMemory).mockReset();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const outcome = <T>(run: () => T): T | { error: string } => {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { error: error.message };
  }
};
const lossless = () => ({
  z: '  Кириллица 😀 é\r\n\t<&>[]()`\\«»\u0000\ud800\udfff\n  '.repeat(300),
  '': ['', {}, [], null, false, true, 0, -0, -4.25],
  'a.b': { b: 'tail\n\n' },
  ['__proto__']: 'own key',
  '10': 'ten',
  '2': 'two',
  ['long😀<key>'.repeat(300)]: 'long key sentinel',
});

it.each([767, 768, 769, 1024, 16384, 24576])(
  'both independent views preserve pre-v8 units and ordered projection at cap %i',
  (cap) => {
    for (const source of ['a', 'data/entities/[😀](x)\n\\*.yml', 'x'.repeat(500)]) {
      const value = lossless();
      const actual = outcome(() => prepareProse(value, source, cap));
      const seal = outcome(() => oldProseUnits(value, cap - 512).join(''));
      expect('error' in actual ? actual : actual.text).toEqual(seal);
      if ('error' in actual) continue;
      expect(outcome(() => [...preparedFiles(actual.projection, cap)])).toEqual(
        outcome(() => [...oldProjectionFiles(value, source, cap)]),
      );
      const header = `# Полная проекция\n\nИсточник: ${source.replace(/[\\[\]()*_`<>\r\n]/g, (ch) => `&#${ch.codePointAt(0)};`)}\n\n`;
      expect(
        'error' in actual.projection
          ? { error: actual.projection.error.message }
          : actual.projection.units,
      ).toEqual(outcome(() => oldProseUnits(value, cap - Buffer.byteLength(header) - 256)));
    }
  },
);

it.each([255, 256, 257])('projection effective cap %i is independent of seal cap', (effective) => {
  const cap = 1024;
  const base = Buffer.byteLength('# Полная проекция\n\nИсточник: \n\n');
  const source = 'x'.repeat(cap - 256 - effective - base);
  const prepared = prepareProse('a'.repeat(128) + '😀<&>'.repeat(100), source, cap);
  expect(prepared.text).toBe(
    oldProseUnits('a'.repeat(128) + '😀<&>'.repeat(100), cap - 512).join(''),
  );
  expect(outcome(() => [...preparedFiles(prepared.projection, cap)])).toEqual(
    outcome(() => [...oldProjectionFiles('a'.repeat(128) + '😀<&>'.repeat(100), source, cap)]),
  );
});

it('page reserves, mandatory frames and exact-fit/one-code-point-over chunks preserve errors', () => {
  for (const header of ['', 'Юникод\n', 'x'.repeat(500)]) {
    const reserve = Buffer.byteLength(header + '\nПродолжение: [далее](part-999999.md).\n');
    for (const cap of [reserve - 1, reserve, reserve + 1, reserve + 4, 1024]) {
      for (const units of [[], [''], ['😀'], ['😀x'], ['x'.repeat(1000)]])
        expect(outcome(() => [...boundedPages(units, header, cap, 'part')])).toEqual(
          outcome(() => [...oldBoundedPages(units, header, cap, 'part')]),
        );
    }
  }
  for (const count of [127, 128, 129, 255, 256, 257]) {
    for (const ch of ['x', '😀', '<', '\ud800'])
      expect(proseUnits(ch.repeat(count), 256)).toEqual(oldProseUnits(ch.repeat(count), 256));
  }
  const prepared = prepareProse('x'.repeat(30000), 'short', 1024);
  expect(outcome(() => [...preparedFiles(prepared.projection, 1024)])).toEqual(
    outcome(() => [...oldProjectionFiles('x'.repeat(30000), 'short', 1024)]),
  );
});

it('unsupported values preserve the first seal-pass error instead of deferred projection errors', () => {
  for (const value of [
    undefined,
    NaN,
    Infinity,
    1n,
    Symbol('unsupported'),
    () => 0,
    [false, undefined],
  ])
    expect(outcome(() => prepareProse(value, 'x'.repeat(900), 1024))).toEqual(
      outcome(() => oldProseUnits(value, 512).join('')),
    );
});

it('one actual traversal and escaping stream replaces two without sharing chunk boundaries', () => {
  const value = { nested: ['😀<&>\ud800'.repeat(100), ''], key: false };
  const keys = vi.spyOn(Object, 'keys');
  const bytes = vi.spyOn(Buffer, 'byteLength');
  oldProseUnits(value, 16384 - 512);
  oldProjectionFiles(value, 'data/entities/a.yml', 16384);
  const originalKeys = keys.mock.calls.length;
  const originalEscapes = bytes.mock.calls.filter(
    ([text]) =>
      typeof text === 'string' && (Array.from(text).length === 1 || /^&#\d+;$/.test(text)),
  ).length;
  keys.mockClear();
  bytes.mockClear();
  const prepared = prepareProse(value, 'data/entities/a.yml', 16384);
  const actualKeys = keys.mock.calls.length;
  const actualEscapes = bytes.mock.calls.filter(
    ([text]) =>
      typeof text === 'string' && (Array.from(text).length === 1 || /^&#\d+;$/.test(text)),
  ).length;
  keys.mockRestore();
  bytes.mockRestore();
  expect(originalKeys).toBe(2);
  expect(actualKeys).toBe(1);
  expect(originalEscapes).toBe(1018);
  expect(actualEscapes).toBe(509);
  expect(prepared.text).toBe(oldProseUnits(value, 16384 - 512).join(''));
});

const makeRoot = async (): Promise<string> => {
  const root = path.join(parent, randomUUID());
  roots.push(root);
  await mkdir(path.join(root, '.oc3/data/entities'), { recursive: true });
  await mkdir(path.join(root, '.oc3/data/__schemas'), { recursive: true });
  for (const name of ['manifest', 'conventions', 'glossary'])
    await writeFile(path.join(root, `.oc3/data/__schemas/${name}.schema.json`), '{}');
  await writeFile(path.join(root, '.oc3/data/__schemas/entities.schema.json'), '{"type":"object"}');
  await writeFile(
    path.join(root, '.oc3/data/entities/a.yml'),
    'id: first\nsummary: stable\ntext: "😀<&>"\n',
  );
  await writeFile(
    path.join(root, '.oc3/manifest.json'),
    JSON.stringify({
      namespace: ['code'],
      data: ['entities'],
      budgets: { node: 16384, start: 24576 },
      files: { 'data/entities/a.yml': { namespace: ['code'], weight: 1 } },
    }),
  );
  return root;
};

it('public mutable, frozen, getter, proxy and custom calls retain reference reads and ownership', async () => {
  const root = await makeRoot();
  const value = { nested: { text: 'first' } };
  const fact: FactFile = {
    rel: 'a.yml',
    namespace: ['code'],
    weight: 1,
    text: 'seal',
    summary: 's',
    value,
  };
  const first = await renderGraph(root, [fact], 256);
  const saved = [...first.files];
  value.nested.text = 'second';
  fact.rel = 'b.yml';
  fact.namespace = ['other'];
  fact.text = 'changed seal';
  fact.summary = 'changed summary';
  const second = await renderGraph(root, [fact], 128, 24576);
  expect([...first.files]).toEqual(saved);
  expect(second.nodes[0]?.key).toBe('other:1');
  expect([...second.files.values()].join('')).toContain('second');
  expect(Object.keys(fact)).toEqual(['rel', 'namespace', 'weight', 'text', 'summary', 'value']);
  expect(Object.getOwnPropertySymbols(fact)).toEqual([]);
  const frozen = Object.freeze({
    ...fact,
    namespace: Object.freeze(['other']),
    value: Object.freeze({ x: 'frozen' }),
  });
  const frozenFact: FactFile = { ...frozen, namespace: [...frozen.namespace] };
  Object.freeze(frozenFact.namespace);
  Object.freeze(frozenFact);
  const concurrent = await Promise.all([
    renderGraph(root, [frozenFact, frozenFact], 256),
    renderGraph(await makeRoot(), [frozenFact], 128),
  ]);
  expect(concurrent.every((graph) => graph.nodes.length === 1)).toBe(true);
  fact.weight = 0;
  expect((await renderGraph(root, [fact], 256)).start).toContain('changed seal');
  for (const kind of ['getter', 'proxy', 'custom']) {
    const reads: string[] = [];
    class Custom {
      text = 'custom';
    }
    const custom = new Custom();
    const data: unknown =
      kind === 'getter'
        ? {
            get text() {
              reads.push('get');
              return 'current';
            },
          }
        : kind === 'proxy'
          ? new Proxy(
              { text: 'current' },
              {
                get(target, key, receiver): unknown {
                  reads.push(String(key));
                  const value: unknown = Reflect.get(target, key, receiver);
                  return value;
                },
              },
            )
          : custom;
    const expected = outcome(() => [...oldProjectionFiles(data, 'a', 16384)]);
    const expectedReads = reads.splice(0);
    expect(outcome(() => [...projectionFiles(data, 'a', 16384)])).toEqual(expected);
    expect(reads).toEqual(expectedReads);
    reads.splice(0);
    await renderGraph(root, [{ ...fact, weight: 1, rel: 'a', value: data }], 256);
    expect(reads).toEqual(expectedReads);
  }
});

it('private high-level operations remain fresh across roots, changes, errors and inline weight zero', async () => {
  vi.mocked(checkMemory).mockResolvedValue({ diagnostics: [], warnings: [] });
  const root = await makeRoot();
  const other = await makeRoot();
  const [first, parallel] = await Promise.all([renderMemoryGraph(root), renderMemoryGraph(other)]);
  expect(first.report.graph).not.toBeNull();
  expect(first.report).toEqual(parallel.report);
  const before = [...(first.report.graph?.files ?? [])];
  await writeFile(path.join(root, '.oc3/data/entities/a.yml'), 'id: changed\ntext: second\n');
  const changed = await renderMemoryGraph(root);
  expect(changed.report.graph?.start).not.toBe(first.report.graph?.start);
  expect([...(first.report.graph?.files ?? [])]).toEqual(before);
  expect((await renderMemoryGraph(other)).report).toEqual(parallel.report);
  await writeFile(path.join(root, '.oc3/data/entities/a.yml'), 'bad: .inf\n');
  expect((await renderMemoryGraph(root)).report.graph).toBeNull();
  await writeFile(path.join(root, '.oc3/data/entities/a.yml'), 'id: restored\n');
  expect((await renderMemoryGraph(root)).report.graph).not.toBeNull();
  await writeFile(path.join(root, '.oc3/project.yml'), 'title: inline\n');
  expect((await renderMemoryGraph(root)).report.graph?.start).toContain(
    inlineProse({ title: 'inline' }),
  );
});

it('projection failures wait for later seal, read and parse outcomes at the original render loop', async () => {
  vi.mocked(checkMemory).mockResolvedValue({
    diagnostics: [],
    warnings: [{ file: 'warning', message: 'validation' }],
  });
  const root = await makeRoot();
  const long = `data/entities/${'x'.repeat(240)}.yml`;
  await writeFile(path.join(root, '.oc3', long), 'id: early\n');
  await rm(path.join(root, '.oc3/data/entities/a.yml'));
  await writeFile(
    path.join(root, '.oc3/manifest.json'),
    JSON.stringify({
      namespace: ['code'],
      data: ['entities'],
      budgets: { node: 768, start: 24576 },
      files: { [long]: { namespace: ['code'], weight: 1 } },
    }),
  );
  const projection = await renderMemoryGraph(root);
  expect(projection.report.graph).toBeNull();
  expect(projection.report.diagnostics.at(-1)?.message).toContain('минимальный frame проекции');
  expect(projection.report.warnings).toEqual([]);
  await writeFile(path.join(root, '.oc3/data/entities/z.yml'), 'bad: .inf\n');
  const seal = await renderMemoryGraph(root);
  expect(seal.report.diagnostics.at(-1)?.message).toContain('data/entities/z.yml: cap 768');
  expect(seal.report.diagnostics.at(-1)?.message).toContain(
    'неподдерживаемый тип стартового факта',
  );
  await writeFile(path.join(root, '.oc3/data/entities/z.yml'), 'bad: [\n');
  const parse = await renderMemoryGraph(root);
  expect(parse.report.diagnostics.map((item) => item.file)).toEqual([
    '.oc3/data/entities/z.yml',
    '.oc3/bundles',
  ]);
  expect(parse.report.diagnostics[0]?.message).toContain('невалидный YAML');
  expect(parse.report.diagnostics[1]?.message).toBe(projection.report.diagnostics[0]?.message);
  await rm(path.join(root, '.oc3/data/entities/z.yml'));
  await symlink(path.join(root, 'missing.yml'), path.join(root, '.oc3/data/entities/z.yml'));
  const read = await renderMemoryGraph(root);
  expect(read.report.diagnostics.at(-1)?.message).not.toContain('минимальный frame проекции');
  expect(await readFile(path.join(root, '.oc3', long), 'utf8')).toBe('id: early\n');
});
