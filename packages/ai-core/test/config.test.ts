import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHANGELOG, loadConfig, parseConfig } from '#shared/config';
import { UsageError } from '#shared/diagnostics';

describe('parseConfig', () => {
  it('пустой файл — включена только secrets', () => {
    expect(parseConfig('')).toEqual({
      adapters: [],
      hooks: [],
      checks: { secrets: { allow: [] } },
    });
  });

  it('secrets: false выключает проверку, allow читается с причиной', () => {
    expect(parseConfig('checks:\n  secrets: false\n').checks.secrets).toBeUndefined();
    expect(parseConfig('checks:\n  secrets:\n').checks.secrets).toEqual({ allow: [] });
    expect(
      parseConfig(
        'checks:\n  secrets:\n    allow:\n      - path: a.md\n        line: 3\n        reason: пример\n      - path: b.md\n        reason: фикстура\n',
      ).checks.secrets,
    ).toEqual({
      allow: [
        { path: 'a.md', line: 3, reason: 'пример' },
        { path: 'b.md', reason: 'фикстура' },
      ],
    });
  });

  it('changelog без параметров — значения по умолчанию', () => {
    expect(parseConfig('checks:\n  changelog: {}\n').checks.changelog).toEqual(DEFAULT_CHANGELOG);
    expect(parseConfig('checks:\n  changelog:\n').checks.changelog).toEqual(DEFAULT_CHANGELOG);
  });

  it('читает adapters, hooks и параметры changelog; version — неизвестный ключ', () => {
    expect(() => parseConfig('version: 0.2.0\n')).toThrow(/неизвестные ключи в корне: version/);
    expect(() => parseConfig('hooks: [memory]\n')).toThrow(/неизвестные hooks: memory/);
    const config = parseConfig(
      'adapters: [claude-code, codex]\nhooks: [docs-guard]\nchecks:\n  changelog:\n    max_line: 100\n    tags: [arch]\n',
    );
    expect(config).toEqual({
      adapters: ['claude-code', 'codex'],
      hooks: ['docs-guard'],
      checks: { changelog: { maxLine: 100, tags: ['arch'] }, secrets: { allow: [] } },
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
    ['неизвестный adapter', 'adapters: [cursor]\n', /неизвестные adapters: cursor/],
    ['параметры у adapters', 'checks:\n  adapters:\n    x: 1\n', /checks\.adapters: x/],
    [
      'secrets: true',
      'checks:\n  secrets: true\n',
      /checks\.secrets должно быть объектом или false/,
    ],
    [
      'исключение без причины',
      'checks:\n  secrets:\n    allow:\n      - path: a.md\n',
      /checks\.secrets\.allow\[0\]\.reason обязателен/,
    ],
    [
      'неизвестный ключ исключения',
      'checks:\n  secrets:\n    allow:\n      - path: a.md\n        reason: r\n        why: x\n',
      /checks\.secrets\.allow\[0\]: why/,
    ],
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

  it('читает context/ai-core.yml', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'harness-config-'));
    await mkdir(path.join(root, 'context'));
    await writeFile(path.join(root, 'context/ai-core.yml'), 'checks:\n  changelog: {}\n');
    expect((await loadConfig(root))?.checks.changelog).toEqual(DEFAULT_CHANGELOG);
  });
});
