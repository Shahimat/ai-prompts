import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '#cli';
import { loadTree } from '#tree';

const NOW = new Date('2026-10-28T12:00:00Z');
let root: string;
let out: string[];

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ai-ext-'));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const COMMAND = `export default {
  path: ['hello', '<who>'],
  effect: 'query',
  run: async (args) => { console.log('привет, ' + args.params.who); return 0; },
};
`;

describe('ai: расширения проекта из .agents/', () => {
  it('своя команда из .agents/commands — в справке и запускается', async () => {
    await put('.agents/commands/hello.mjs', COMMAND);
    expect(await main(['hello', 'мир', '--root', root], NOW)).toBe(0);
    expect(out).toContain('привет, мир');
    expect((await loadTree(root)).tree.renderUsage()).toContain('ai hello <who>');
  });

  it('свой скрипт из .agents/scripts — последовательность команд, доступна runtime', async () => {
    await put('.agents/commands/hello.mjs', COMMAND);
    await put(
      '.agents/scripts/greet.yml',
      'path: [greet]\nsteps:\n  - command: [hello, раз]\n  - command: [hello, два]\n',
    );
    await put('context/ai-core.yml', 'checks:\n  secrets: false\n');
    const { tree, scripts } = await loadTree(root);
    expect(tree.findCommand(['greet'])?.command.kind).toBe('script');
    expect(scripts.map((s) => s.path.join(' '))).toContain('greet');
  });

  it('свой автомат из .agents/harnesses — команды автомата под его именем', async () => {
    await put(
      '.agents/harnesses/review-flow/harness.yaml',
      'harness: review-flow\ndescription: Свой автомат проекта\ninitial: a\nstates:\n  a:\n    actor: script\n    action: go\n    on:\n      ok: done\n  done:\n    final: true\n',
    );
    await put(
      '.agents/harnesses/review-flow/handlers/go.ts',
      "export default { actions: { go: { events: ['ok'], run: async () => ({ event: 'ok' }) } } };\n",
    );
    const { tree } = await loadTree(root);
    expect(tree.findCommand(['review-flow', 'validate'])?.command.kind).toBe('harness');
    expect(await main(['review-flow', 'validate', '--root', root], NOW)).toBe(0);
  });

  it('имя, занятое встроенной командой, — ошибка, а не подмена', async () => {
    await put(
      '.agents/commands/check.mjs',
      "export default { path: ['check'], effect: 'query', run: async () => 0 };\n",
    );
    await expect(loadTree(root)).rejects.toThrow('имя занято встроенной командой');
  });

  it('неверная форма расширения — ошибка с путём к файлу', async () => {
    await put('.agents/scripts/bad.yml', 'steps: []\n');
    await expect(loadTree(root)).rejects.toThrow('.agents/scripts/bad.yml');
  });
});
