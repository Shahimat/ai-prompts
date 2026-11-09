import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { artifactPath } from '#lib/artifacts';
import { criterionInventory, inventoryCacheCounts } from '#lib/expect/inventory';

let root: string;
const entry = 'sample.expect.ts';
beforeEach(async () => {
  const parent = artifactPath(path.resolve(import.meta.dirname, '..', '..', '..'), {
    kind: 'run',
    key: 'incremental-verification-final',
    name: 'observation-fixtures',
  });
  await mkdir(parent, { recursive: true });
  root = await mkdtemp(path.join(parent, 'inventory-'));
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(
    path.join(root, entry),
    "import {it,expect} from 'vitest';import {value} from './helper.js';it('synthetic',()=>expect(value()).toBe(1));",
  );
  await writeFile(
    path.join(root, 'helper.ts'),
    "import type {Value} from './types.js';export function value():Value{return 1;}",
  );
  await writeFile(path.join(root, 'types.d.ts'), 'export type Value = 1;');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it('a warm observation replay freshly reads each exact operation/argument query once, including declarations and missing candidates', () => {
  const originalRead = ts.sys.readFile.bind(ts.sys);
  const originalExists = ts.sys.fileExists.bind(ts.sys);
  const reads = vi.spyOn(ts.sys, 'readFile').mockImplementation(originalRead);
  const exists = vi.spyOn(ts.sys, 'fileExists').mockImplementation(originalExists);
  const initial = criterionInventory(root, entry);
  reads.mockClear();
  exists.mockClear();
  expect(criterionInventory(root, entry)).toEqual(initial);
  const queries = [
    ...reads.mock.calls.map((args) => JSON.stringify(['readFile', args])),
    ...exists.mock.calls.map((args) => JSON.stringify(['fileExists', args])),
  ];
  expect(queries.length).toBeGreaterThan(0);
  expect(new Set(queries).size).toBe(queries.length);
  expect(reads.mock.calls.some(([file]) => file === path.join(root, 'types.d.ts'))).toBe(true);
  expect(exists.mock.calls.some(([file]) => file === path.join(root, 'tsconfig.json'))).toBe(true);
});

it('unstable repeated extraction reads reject rather than caching a coincidentally matching replay', () => {
  const originalRead = ts.sys.readFile.bind(ts.sys);
  let calls = 0;
  vi.spyOn(ts.sys, 'readFile').mockImplementation((file, encoding) => {
    if (file === path.join(root, 'package.json')) {
      calls++;
      return calls % 2 === 1 ? '{"type":"module"}' : '{"type":"commonjs"}';
    }
    return originalRead(file, encoding);
  });
  const before = inventoryCacheCounts();
  expect(() => criterionInventory(root, entry)).toThrow('UNSTABLE_EXPECT_INPUT');
  expect(calls).toBeGreaterThan(1);
  vi.restoreAllMocks();
  expect(criterionInventory(root, entry).criteria).toHaveLength(1);
  expect(inventoryCacheCounts().hits).toBe(before.hits);
  expect(inventoryCacheCounts().extractions - before.extractions).toBe(2);
});

it('same-size restored-mtime declaration bytes and extended configuration still invalidate fresh replay', async () => {
  await writeFile(path.join(root, 'base.json'), '{"compilerOptions":{"strict":true}}');
  await writeFile(path.join(root, 'tsconfig.json'), '{"extends":"./base.json"}');
  criterionInventory(root, entry);
  const before = inventoryCacheCounts();
  const file = path.join(root, 'types.d.ts');
  const info = await stat(file);
  await writeFile(file, 'export type Value = 2;');
  await utimes(file, info.atime, info.mtime);
  criterionInventory(root, entry);
  expect(inventoryCacheCounts().invalidations - before.invalidations).toBe(1);
  const config = path.join(root, 'base.json');
  const configInfo = await stat(config);
  await writeFile(config, '{"compilerOptions":{"strict":null}}');
  await utimes(config, configInfo.atime, configInfo.mtime);
  criterionInventory(root, entry);
  expect(inventoryCacheCounts().invalidations - before.invalidations).toBe(2);
});

it('negative extension lookups, root metadata and symlink resolution cannot retain a cached complete registration', async () => {
  await rm(path.join(root, 'helper.ts'));
  const missing = criterionInventory(root, entry);
  const before = inventoryCacheCounts();
  await writeFile(path.join(root, 'helper.ts'), 'export function value(){return 1;}');
  const created = criterionInventory(root, entry);
  expect(created.generation).not.toBe(missing.generation);
  expect(inventoryCacheCounts().invalidations - before.invalidations).toBe(1);
  await writeFile(path.join(root, 'package.json'), '{"type":"commonjs"}');
  criterionInventory(root, entry);
  expect(inventoryCacheCounts().invalidations - before.invalidations).toBe(2);
  await mkdir(path.join(root, 'foreign'));
  const foreign = path.join(root, 'foreign/helper.ts');
  await writeFile(foreign, 'export function value(){return 2;}');
  await rm(path.join(root, 'helper.ts'));
  await symlink(foreign, path.join(root, 'helper.ts'));
  const linked = criterionInventory(root, entry);
  expect(linked.criteria.every((item) => !item.complete)).toBe(true);
  expect(inventoryCacheCounts().invalidations - before.invalidations).toBe(3);
  expect(await readFile(foreign, 'utf8')).toBe('export function value(){return 2;}');
});
