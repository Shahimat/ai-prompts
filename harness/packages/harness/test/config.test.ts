import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHANGELOG, loadConfig, parseConfig } from '../src/config.ts';
import { UsageError } from '../src/diagnostics.ts';

describe('parseConfig', () => {
  it('пустой файл — ничего не включено', () => {
    expect(parseConfig('')).toEqual({ adapters: [], checks: {} });
  });

  it('changelog без параметров — значения по умолчанию', () => {
    expect(parseConfig('checks:\n  changelog: {}\n').checks.changelog).toEqual(DEFAULT_CHANGELOG);
    expect(parseConfig('checks:\n  changelog:\n').checks.changelog).toEqual(DEFAULT_CHANGELOG);
  });

  it('читает version, adapters и параметры changelog', () => {
    const config = parseConfig(
      'version: 0.2.0\nadapters: [claude-code, codex]\nchecks:\n  changelog:\n    max_line: 100\n    tags: [arch]\n',
    );
    expect(config).toEqual({
      version: '0.2.0',
      adapters: ['claude-code', 'codex'],
      checks: { changelog: { maxLine: 100, tags: ['arch'] } },
    });
  });

  it('включает context-index', () => {
    expect(parseConfig('checks:\n  context-index: {}\n').checks['context-index']).toEqual({});
    expect(parseConfig('checks:\n  context-index:\n').checks['context-index']).toEqual({});
    expect(() => parseConfig('checks:\n  context-index:\n    x: 1\n')).toThrow(/context-index: x/);
  });

  it('пропускает ключи из спецификации, которые ещё не реализованы', () => {
    expect(() => parseConfig('worktrees:\n  dir: x\nrules: tools/harness/rules\n')).not.toThrow();
  });

  it.each([
    ['неизвестный ключ в корне', 'chekcs: {}\n', /неизвестные ключи в корне: chekcs/],
    ['неизвестная проверка', 'checks:\n  changelg: {}\n', /неизвестные ключи в checks: changelg/],
    ['неизвестный параметр', 'checks:\n  changelog:\n    max: 1\n', /checks\.changelog: max/],
    ['max_line не число', 'checks:\n  changelog:\n    max_line: "120"\n', /max_line/],
    ['max_line ноль', 'checks:\n  changelog:\n    max_line: 0\n', /max_line/],
    ['пустые tags', 'checks:\n  changelog:\n    tags: []\n', /tags не может быть пустым/],
    ['adapters не список', 'adapters: codex\n', /adapters должно быть списком/],
    ['корень — список', '- a\n', /корень должен быть объектом/],
    ['невалидный YAML', 'a: b: c\n', /невалидный YAML/],
  ])('ошибка: %s', (_name, text, message) => {
    expect(() => parseConfig(text)).toThrow(UsageError);
    expect(() => parseConfig(text)).toThrow(message);
  });
});

describe('loadConfig', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('нет файла — null', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'harness-config-'));
    expect(await loadConfig(root)).toBeNull();
  });

  it('читает context/harness.yml', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'harness-config-'));
    await mkdir(path.join(root, 'context'));
    await writeFile(path.join(root, 'context/harness.yml'), 'checks:\n  changelog: {}\n');
    expect((await loadConfig(root))?.checks.changelog).toEqual(DEFAULT_CHANGELOG);
  });
});
