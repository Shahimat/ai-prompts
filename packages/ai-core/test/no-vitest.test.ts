import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.join(import.meta.dirname, '..', 'src');
const VITEST_MODULES = /from '#lib\/expect\/(levels|plan|judge|index)'|from 'vitest'/;

async function files(dir: string): Promise<string[]> {
  const all = await readdir(path.join(SRC, dir), { recursive: true });
  return all.filter((f) => f.endsWith('.ts')).map((f) => path.join(dir, f));
}

describe('ядро грузится без vitest', () => {
  it('команды и реестр не импортируют модули, которым нужен vitest', async () => {
    const bad: string[] = [];
    for (const f of [...(await files('commands')), 'registry.ts', 'index.ts']) {
      const text = await readFile(path.join(SRC, f), 'utf8');
      const imports = text.split('\n').filter((l) => /^(import|export) /.test(l));
      if (imports.some((l) => VITEST_MODULES.test(l))) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});
