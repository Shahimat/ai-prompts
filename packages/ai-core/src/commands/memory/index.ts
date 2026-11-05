import { UsageError } from '#shared/diagnostics';
import { report, warn } from '#shared/report';
import type { CommandArgs } from '#shared/args';
import { checkMemory } from '#lib/memory';
import { buildBundles, checkBundles, writeGraph } from '#lib/memory-graph';

const MEMORY_BUILD = 'memory build';

export async function runMemory(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command === 'check') {
    const memory = await checkMemory(args.root);
    const bundles = await checkBundles(args.root);
    warn([...memory.warnings, ...bundles.warnings]);
    return report('memory check', [...memory.diagnostics, ...bundles.diagnostics]);
  }
  if (command !== 'build')
    throw new UsageError(`неизвестная команда: memory ${command ?? ''}`.trimEnd());
  const memory = await checkMemory(args.root);
  const build = await buildBundles(args.root);
  const diagnostics = [...memory.diagnostics, ...build.diagnostics];
  if (build.graph === null || diagnostics.length > 0) return report(MEMORY_BUILD, diagnostics);
  const removed = await writeGraph(args.root, build.graph);
  console.error(
    `wrote ${build.graph.nodes.length + 1} бандлов${removed > 0 ? `, стухших удалено ${removed}` : ''}`,
  );
  return report(MEMORY_BUILD, []);
}

export { checkMemory, checkBundles, buildBundles };
