import { UsageError } from '#shared/diagnostics';
import { report, warn } from '#shared/report';
import type { CommandArgs } from '#shared/args';
import { buildBundles, checkBundles, writeGraph } from '#lib/memory-graph';

const MEMORY_BUILD = 'memory build';

export async function runMemory(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command === 'check') {
    const bundles = await checkBundles(args.root);
    warn(bundles.warnings);
    return report('memory check', bundles.diagnostics);
  }
  if (command !== 'build')
    throw new UsageError(`неизвестная команда: memory ${command ?? ''}`.trimEnd());
  const build = await buildBundles(args.root);
  const diagnostics = build.diagnostics;
  if (build.graph === null || diagnostics.length > 0) return report(MEMORY_BUILD, diagnostics);
  const removed = await writeGraph(args.root, build.graph);
  console.error(
    `wrote ${build.graph.files.size} файлов памяти${removed > 0 ? `, стухших удалено ${removed}` : ''}`,
  );
  return report(MEMORY_BUILD, []);
}

export { checkMemory } from '#lib/memory';
export { checkBundles, buildBundles };
export { runInbox } from './inbox.ts';
