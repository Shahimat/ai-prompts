import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

const entry = process.env['HARNESS_EXPECT_ENTRY'];
if (entry === undefined || entry === '') throw new Error('HARNESS_EXPECT_ENTRY не задан');

const headSource = process.env['HARNESS_EXPECT_HEAD_SOURCE'];

function headVersion(target: string, source: string): Plugin {
  return {
    name: 'harness-expect-head',
    enforce: 'pre',
    load: (id) =>
      path.resolve(id.split('?')[0] ?? id) === target ? readFileSync(source, 'utf8') : null,
  };
}

const root = process.env['HARNESS_EXPECT_ROOT'] ?? process.cwd();

export default defineConfig({
  plugins:
    headSource === undefined || headSource === ''
      ? []
      : [headVersion(path.resolve(root, entry), headSource)],
  test: {
    include: [entry],
    testTimeout: 30_000,
  },
});
