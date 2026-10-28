import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, promptOf, run, shellStep, splitWords } from '@shahimat/cli';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HARNESS } from '#cli';

const NOW = new Date('2026-10-13T12:00:00Z');
const { childrenOf, findCommand } = HARNESS;

let root: string;

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'harness-cli-'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('справка harness', () => {
  it('только автоматы: строка на каждую команду, команд ai-core нет', () => {
    const usage = HARNESS.renderUsage();
    for (const c of HARNESS.commands) expect(usage).toContain(`ai ${c.path.join(' ')}`);
    expect(HARNESS.commands.every((c) => c.kind === 'harness')).toBe(true);
  });
});

describe('дерево команд: уровни, list, help, оболочка', () => {
  let out: string[];
  beforeEach(() => {
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.join(' '));
    });
  });

  it('параметры пути и приоритет литералов', () => {
    expect(findCommand(['plan-review', 'list'])?.params).toEqual({});
    expect(findCommand(['plan-review', 'status', '0d57'])?.params).toEqual({ id: '0d57' });
    expect(findCommand(['plan-review', 'hook', '0d57', 'stop'])?.params).toEqual({
      id: '0d57',
      hook: 'stop',
    });
    expect(findCommand(['check'])).toBeUndefined();
  });

  it('list и help на каждом уровне', async () => {
    expect(await main(['list'], NOW)).toBe(0);
    expect(out.at(-1)).toContain('plan-review');
    expect(await main(['docs-delta', 'list'], NOW)).toBe(0);
    expect(await main(['docs-delta', 'help'], NOW)).toBe(0);
    expect(out.at(-1)).toContain('ai docs-delta open <id>');
    expect(out.at(-1)).not.toContain('ai check');
    expect(childrenOf(['plan-review', 'hook', 'x'])).toEqual(['<hook>']);
    expect(await run(['plan-review'])).toBe(2);
  });

  it('оболочка: вход в уровень, .., list, help, запуск команды относительно уровня', () => {
    expect(splitWords(`start --name "два слова" '*'`)).toEqual([
      'start',
      '--name',
      'два слова',
      '*',
    ]);
    expect(shellStep([], 'plan-review', HARNESS)).toEqual({ cwd: ['plan-review'] });
    expect(shellStep(['plan-review'], '..', HARNESS)).toEqual({ cwd: [] });
    expect(shellStep(['plan-review'], 'help', HARNESS).output).toContain('ai plan-review start');
    expect(shellStep(['plan-review'], 'start --name x', HARNESS)).toEqual({
      cwd: ['plan-review'],
      run: ['plan-review', 'start', '--name', 'x'],
    });
    expect(shellStep(['plan-review'], 'list', HARNESS)).toEqual({
      cwd: ['plan-review'],
      run: ['plan-review', 'list'],
    });
    expect(shellStep(['plan-review', 'hook'], '0d57', HARNESS)).toEqual({
      cwd: ['plan-review', 'hook', '0d57'],
    });
    expect(shellStep([], 'exit', HARNESS).exit).toBe(true);
    expect(promptOf(['plan-review'])).toBe('/ai/plan-review> ');
  });

  it('любая команда — одной строкой из шелла; .ts-плагин грузится голым Node без сборки', async () => {
    const home = path.join(root, 'home');
    await put(
      'home/harnesses/plan-review/handlers/extra.ts',
      'const yes = (_c: unknown): boolean => true;\nexport default { guards: { yes } };\n',
    );
    const bin = fileURLToPath(import.meta.resolve('@shahimat/cli/package.json')).replace(
      /package\.json$/,
      'dist/bin.js',
    );
    const r = spawnSync(process.execPath, [bin, 'plan-review', 'validate', '--home', home], {
      encoding: 'utf8',
    });
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('plan-review: ok (плагины: extra.ts)');
    expect(r.status).toBe(0);
  });
});
