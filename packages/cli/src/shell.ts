import { createInterface } from 'node:readline/promises';
import type { CommandTree } from '@shahimat/ai-core';

export function splitWords(line: string): string[] {
  const words: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g))
    words.push(m[1] ?? m[2] ?? m[3] ?? '');
  return words;
}

export interface ShellStep {
  cwd: string[];
  run?: string[];
  output?: string;
  exit?: boolean;
}

export function shellStep(cwd: readonly string[], line: string, tree: CommandTree): ShellStep {
  const { childrenOf, findCommand, isNamespace, renderUsage } = tree;
  const words = splitWords(line);
  const here = [...cwd];
  if (words.length === 0) return { cwd: here };
  const [first = ''] = words;
  if (words.length === 1 && (first === 'exit' || first === 'quit'))
    return { cwd: here, exit: true };
  if (words.length === 1 && first === '..') return { cwd: here.slice(0, -1) };
  if (words.length === 1 && first === 'help') return { cwd: here, output: renderUsage(here) };
  const full = [...here, ...words];
  const own = isNamespace([...here, 'list']) || findCommand([...here, 'list']) !== undefined;
  if (first === 'list' && words.length === 1 && !own) {
    return { cwd: here, output: childrenOf(here).join('\n') };
  }
  if (isNamespace(full) && words.every((w) => w !== 'list' && w !== 'help')) return { cwd: full };
  return { cwd: here, run: full };
}

export const promptOf = (cwd: readonly string[], bin = 'ai'): string =>
  `/${[bin, ...cwd].join('/')}> `;

export async function runShell(
  exec: (words: string[]) => Promise<number>,
  tree: CommandTree,
): Promise<number> {
  let cwd: string[] = [];
  for (;;) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let line: string;
    try {
      line = await rl.question(promptOf(cwd, tree.bin));
    } catch {
      return 0;
    } finally {
      rl.close();
    }
    const step = shellStep(cwd, line, tree);
    cwd = step.cwd;
    if (step.exit === true) return 0;
    if (step.output !== undefined) console.log(step.output);
    if (step.run !== undefined) {
      const code = await exec(step.run);
      if (code !== 0) console.log(`код ${code}`);
    }
  }
}
