// Оболочка: те же команды, что одной строкой из шелла, но с переходом
// по уровням дерева. Слово-пространство имён — вход в него, `..` —
// уровень выше, `list` и `help` — о текущем уровне.

import { createInterface } from 'node:readline/promises';
import { childrenOf, findCommand, isNamespace, renderUsage } from './tree.ts';

/** Разбор строки на слова: кавычки группируют. */
export function splitWords(line: string): string[] {
  const words: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g))
    words.push(m[1] ?? m[2] ?? m[3] ?? '');
  return words;
}

export interface ShellStep {
  /** Текущий уровень после строки. */
  cwd: string[];
  /** Слова команды для запуска; нет — строка обработана оболочкой. */
  run?: string[];
  output?: string;
  exit?: boolean;
}

/** Одна строка оболочки; чистая функция — её покрывают тесты. */
export function shellStep(cwd: readonly string[], line: string): ShellStep {
  const words = splitWords(line);
  const here = [...cwd];
  if (words.length === 0) return { cwd: here };
  const [first = ''] = words;
  if (words.length === 1 && (first === 'exit' || first === 'quit'))
    return { cwd: here, exit: true };
  if (words.length === 1 && first === '..') return { cwd: here.slice(0, -1) };
  if (words.length === 1 && first === 'help') return { cwd: here, output: renderUsage(here) };
  const full = [...here, ...words];
  // Своя команда list уровня (harness <имя> list) важнее встроенного списка.
  const own = isNamespace([...here, 'list']) || findCommand([...here, 'list']) !== undefined;
  if (first === 'list' && words.length === 1 && !own) {
    return { cwd: here, output: childrenOf(here).join('\n') };
  }
  if (isNamespace(full) && words.every((w) => w !== 'list' && w !== 'help')) return { cwd: full };
  return { cwd: here, run: full };
}

export const promptOf = (cwd: readonly string[]): string => `/${['harness', ...cwd].join('/')}> `;

export async function runShell(exec: (words: string[]) => Promise<number>): Promise<number> {
  let cwd: string[] = [];
  for (;;) {
    // Новый readline на каждую строку: команда (например, интерактивный
    // claude) получает терминал целиком.
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let line: string;
    try {
      line = await rl.question(promptOf(cwd));
    } catch {
      return 0;
    } finally {
      rl.close();
    }
    const step = shellStep(cwd, line);
    cwd = step.cwd;
    if (step.exit === true) return 0;
    if (step.output !== undefined) console.log(step.output);
    if (step.run !== undefined) {
      const code = await exec(step.run);
      if (code !== 0) console.log(`код ${code}`);
    }
  }
}
