import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { artifactPath } from '#lib/artifacts';
import { criterionInventory, inventoryCacheCounts } from '#lib/expect/inventory';

it('inventory memo revalidates observed inputs, negative resolutions and roots rather than retaining an eternal Program', async () => {
  const project = path.resolve(import.meta.dirname, '..', '..', '..');
  const parent = artifactPath(project, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: 'fixtures',
  });
  await mkdir(parent, { recursive: true });
  const roots = await Promise.all(
    ['one-', 'two-'].map((prefix) => mkdtemp(path.join(parent, prefix))),
  );
  const [first, second] = roots;
  if (first === undefined || second === undefined) throw new Error('missing roots');
  const entry = 'sample.expect.ts';
  const source =
    "import {it,expect} from 'vitest';import {value} from './helper.js';it('first',()=>expect(value()).toBe(1));";
  try {
    for (const root of roots) {
      await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
      await writeFile(path.join(root, entry), source);
      await writeFile(path.join(root, 'helper.ts'), 'export function value(){return 1;}');
    }
    const before = inventoryCacheCounts();
    const inventory = criterionInventory(first, entry);
    const stable = structuredClone(inventory);
    inventory.criteria.splice(0);
    expect(criterionInventory(first, entry)).toEqual(stable);
    expect(inventoryCacheCounts().extractions - before.extractions).toBe(1);
    expect(inventoryCacheCounts().hits - before.hits).toBe(1);
    expect(criterionInventory(second, entry)).toEqual(stable);
    expect(inventoryCacheCounts().extractions - before.extractions).toBe(2);
    await writeFile(path.join(first, 'helper.ts'), 'export function value(){return 2;}');
    expect(criterionInventory(first, entry).generation).not.toBe(stable.generation);
    expect(inventoryCacheCounts().invalidations - before.invalidations).toBe(1);
    await writeFile(path.join(first, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
    const config = criterionInventory(first, entry);
    expect(config.generation).not.toBe(stable.generation);
    expect(inventoryCacheCounts().invalidations - before.invalidations).toBe(2);
    await rm(path.join(first, 'helper.ts'));
    const missing = criterionInventory(first, entry);
    expect(missing.criteria.every((criterion) => !criterion.complete)).toBe(true);
    await writeFile(path.join(first, 'helper.ts'), 'export function value(){return 1;}');
    expect(criterionInventory(first, entry).generation).not.toBe(missing.generation);
    expect(inventoryCacheCounts().invalidations - before.invalidations).toBe(4);
  } finally {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  }
}, 60000);
