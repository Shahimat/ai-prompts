import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from '#shared/diagnostics';
import { collectEntries, diffIndex, INDEX_PATH, renderIndex } from '#lib/prompt-index';
import type { CommandArgs } from '#shared/args';

const MAX_DIFF_LINES = 50;

async function buildIndex(root: string, rawBase: string): Promise<string> {
  const { entries, skipped } = await collectEntries(root);
  for (const file of skipped) console.error(`SKIP (no key/kind): ${file}`);
  return renderIndex(entries, { rawBase: rawBase.replace(/\/+$/, ''), generatedAt: new Date() });
}

export async function runIndex(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command !== 'build' && command !== 'check') {
    throw new UsageError(`неизвестная команда: index ${command ?? ''}`.trimEnd());
  }
  if (args.rawBase === undefined) throw new UsageError('не задан --raw-base');
  const indexFile = path.join(args.root, INDEX_PATH);
  const expected = await buildIndex(args.root, args.rawBase);

  if (command === 'build') {
    const out = args.out === undefined ? indexFile : path.resolve(args.out);
    await writeFile(out, expected, 'utf8');
    console.error(`wrote ${path.relative(process.cwd(), out) || out}`);
    return 0;
  }

  let actual: string;
  try {
    actual = await readFile(indexFile, 'utf8');
  } catch {
    console.error(`ERROR: ${INDEX_PATH} не найден. Запусти ai-core index build`);
    return 1;
  }
  const diffs = diffIndex(expected, actual);
  if (diffs.length === 0) {
    console.log(`${INDEX_PATH} is up to date`);
    return 0;
  }
  console.error(`ERROR: ${INDEX_PATH} устарел. Запусти ai-core index build и закоммить результат.`);
  for (const d of diffs.slice(0, MAX_DIFF_LINES)) {
    console.error(`  строка ${d.line}:`);
    console.error(`    - ${d.actual ?? '<нет строки>'}`);
    console.error(`    + ${d.expected ?? '<нет строки>'}`);
  }
  if (diffs.length > MAX_DIFF_LINES) console.error(`  ... и ещё ${diffs.length - MAX_DIFF_LINES}`);
  return 1;
}
