import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { artifactPath } from '#lib/artifacts';
import { extractionPrinter } from '#lib/expect/syntax-printer';

const counts = vi.hoisted(() => ({ printers: 0, emissions: 0 }));
vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof ts }>();
  return {
    ...actual,
    default: {
      ...actual.default,
      createPrinter: (...args: Parameters<typeof ts.createPrinter>) => {
        counts.printers++;
        const printer = actual.default.createPrinter(...args);
        const emit = printer.printNode.bind(printer);
        printer.printNode = (...args) => {
          counts.emissions++;
          return emit(...args);
        };
        return printer;
      },
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('#lib/expect/syntax-printer');
  vi.resetModules();
  counts.printers = 0;
  counts.emissions = 0;
});

it('one extraction printer avoids repeated original-node emission without retaining state across extractions or generated nodes', () => {
  const source = ts.createSourceFile('sample.ts', 'const value = 1;', ts.ScriptTarget.ESNext, true);
  const statement = source.statements[0];
  if (statement === undefined) throw new Error('fixture');
  counts.printers = 0;
  counts.emissions = 0;
  const print = extractionPrinter();
  expect(print(statement)).toBe('const value = 1;');
  expect(print(statement)).toBe('const value = 1;');
  expect(counts.printers).toBe(1);
  expect(counts.emissions).toBe(1);
  const generated = ts.factory.createIdentifier('generated');
  expect(print(generated, source)).toBe('generated');
  expect(print(generated, source)).toBe('generated');
  expect(counts.emissions).toBe(3);
  const nested = extractionPrinter();
  expect(nested(statement)).toBe(print(statement));
  expect(counts.printers).toBe(2);
  expect(counts.emissions).toBe(4);
});

it('full inventory equals fresh-printer reference with actual repeated-node work and fresh root isolation', async () => {
  const parent = artifactPath(path.resolve(import.meta.dirname, '..', '..', '..'), {
    kind: 'run',
    key: 'incremental-verification-final',
    name: 'printer-fixtures-v5',
  });
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'inventory-'));
  try {
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await writeFile(
      path.join(root, 'helper.ts'),
      'export class Helper { static value(){ return 1; } static other(){ return 2; } }',
    );
    await writeFile(
      path.join(root, 'sample.expect.ts'),
      "import {it,expect,describe} from 'vitest';import {Helper} from './helper.js';describe('group',()=>{it('one',()=>expect(Helper.value()).toBe(1));it('two',()=>expect(Helper.other()).toBe(2));});",
    );
    const nodes = new Map<ts.Node, number>();
    let referencePrinters = 0;
    vi.doMock('#lib/expect/syntax-printer', () => ({
      extractionPrinter:
        () =>
        (node: ts.Node, source = node.getSourceFile()) => {
          nodes.set(node, (nodes.get(node) ?? 0) + 1);
          referencePrinters++;
          return ts
            .createPrinter({ removeComments: true })
            .printNode(ts.EmitHint.Unspecified, node, source);
        },
    }));
    vi.resetModules();
    const reference = await import('#lib/expect/inventory');
    const expected = reference.criterionInventory(root, 'sample.expect.ts');
    expect([...nodes.values()].some((count) => count > 1)).toBe(true);
    vi.doUnmock('#lib/expect/syntax-printer');
    vi.resetModules();
    counts.printers = 0;
    counts.emissions = 0;
    const changed = await import('#lib/expect/inventory');
    const actual = changed.criterionInventory(root, 'sample.expect.ts');
    expect(actual).toEqual(expected);
    expect(counts.printers).toBe(1);
    expect(counts.emissions).toBeLessThan(referencePrinters);
    const changedEmissions = counts.emissions;
    await writeFile(
      path.join(parent, `work-${randomUUID()}.json`),
      JSON.stringify({
        referencePrinters,
        changedPrinters: counts.printers,
        changedEmissions,
        repeatedNodes: [...nodes.values()].filter((count) => count > 1).length,
        fullInventoryEquivalent: true,
      }),
    );
    actual.criteria.length = 0;
    expect(changed.criterionInventory(root, 'sample.expect.ts')).toEqual(expected);
    await writeFile(
      path.join(root, 'helper.ts'),
      'export class Helper { static value(){return 8;} }',
    );
    expect(changed.criterionInventory(root, 'sample.expect.ts')).not.toEqual(expected);
    expect(counts.printers).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
