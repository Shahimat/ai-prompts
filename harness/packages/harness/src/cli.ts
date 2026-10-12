#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { collectEntries, diffIndex, INDEX_PATH, renderIndex } from './prompt-index.ts';

const USAGE = `Использование:
  harness index build --raw-base <url> [--root <dir>] [--out <file>]
  harness index check --raw-base <url> [--root <dir>]`;

const MAX_DIFF_LINES = 50;

class UsageError extends Error {}

async function buildIndex(root: string, rawBase: string): Promise<string> {
  const { entries, skipped } = await collectEntries(root);
  for (const file of skipped) console.error(`SKIP (no key/kind): ${file}`);
  return renderIndex(entries, { rawBase: rawBase.replace(/\/+$/, ''), generatedAt: new Date() });
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string', default: '.' },
      out: { type: 'string' },
      'raw-base': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const [group, command] = positionals;
  if (group !== 'index' || (command !== 'build' && command !== 'check')) {
    throw new UsageError(`неизвестная команда: ${positionals.join(' ') || '<пусто>'}`);
  }
  const rawBase = values['raw-base'];
  if (rawBase === undefined) throw new UsageError('не задан --raw-base');

  const root = path.resolve(values.root);
  const indexFile = path.join(root, INDEX_PATH);
  const expected = await buildIndex(root, rawBase);

  if (command === 'build') {
    const out = values.out === undefined ? indexFile : path.resolve(values.out);
    await writeFile(out, expected, 'utf8');
    console.error(`wrote ${path.relative(process.cwd(), out) || out}`);
    return 0;
  }

  let actual: string;
  try {
    actual = await readFile(indexFile, 'utf8');
  } catch {
    console.error(`ERROR: ${INDEX_PATH} не найден. Запусти harness index build`);
    return 1;
  }
  const diffs = diffIndex(expected, actual);
  if (diffs.length === 0) {
    console.log(`${INDEX_PATH} is up to date`);
    return 0;
  }
  console.error(`ERROR: ${INDEX_PATH} устарел. Запусти harness index build и закоммить результат.`);
  for (const d of diffs.slice(0, MAX_DIFF_LINES)) {
    console.error(`  строка ${d.line}:`);
    console.error(`    - ${d.actual ?? '<нет строки>'}`);
    console.error(`    + ${d.expected ?? '<нет строки>'}`);
  }
  if (diffs.length > MAX_DIFF_LINES) console.error(`  ... и ещё ${diffs.length - MAX_DIFF_LINES}`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof UsageError) console.error(USAGE);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  },
);
