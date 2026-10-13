import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectEntries,
  diffIndex,
  renderIndex,
  sha256,
  stripTimestamp,
  type IndexEntry,
} from '../src/prompt-index.ts';

const RAW = 'https://raw.example/repo/main';
const AT = new Date('2026-01-02T03:04:05.678Z');

let root: string;

async function put(rel: string, content: string): Promise<void> {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'harness-index-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('sha256', () => {
  it('не зависит от CRLF', () => {
    expect(sha256('a\r\nb\r\n')).toBe(sha256('a\nb\n'));
  });
});

describe('collectEntries', () => {
  it('собирает записи, сортирует по пути и пропускает файлы без key/kind', async () => {
    await put('prompts/b/z.md', '---\nkey: z\nkind: prompt\n---\n');
    await put('prompts/a/contract-v2.md', '---\nkey: c2\nkind: contract\n---\n');
    await put('prompts/a/contract.md', '---\nkey: c1\nkind: contract\n---\n');
    await put('patterns/README.md', '# Паттерны\n');
    await put('patterns/no-kind.md', '---\nkey: nk\n---\n');
    await put('prompts/notes.txt', 'не markdown');

    const { entries, skipped } = await collectEntries(root);

    expect(entries.map((e) => e.path)).toEqual([
      'prompts/a/contract-v2.md',
      'prompts/a/contract.md',
      'prompts/b/z.md',
    ]);
    expect(skipped).toEqual(['patterns/README.md', 'patterns/no-kind.md']);
  });

  it('читает списки applicable_to и patterns, хэширует содержимое', async () => {
    const content = '---\nkey: m\nkind: module\napplicable_to: [base]\npatterns: [source-sync]\n---\nbody\n';
    await put('prompts/modules/m.md', content);

    const { entries } = await collectEntries(root);

    expect(entries).toEqual([
      {
        kind: 'module',
        key: 'm',
        path: 'prompts/modules/m.md',
        sha256: sha256(content),
        applicableTo: ['base'],
        patterns: ['source-sync'],
      },
    ]);
  });

  it('работает без каталога patterns', async () => {
    await put('prompts/x.md', '---\nkey: x\nkind: prompt\n---\n');
    expect((await collectEntries(root)).entries).toHaveLength(1);
  });

  it('называет файл при невалидном frontmatter', async () => {
    await put('prompts/bad.md', '---\nkey: bad\nuse_case: a: b\n---\n');
    await expect(collectEntries(root)).rejects.toThrow(/prompts\/bad\.md/);
  });

  it('отвергает patterns, который не список строк', async () => {
    await put('prompts/bad.md', '---\nkey: bad\nkind: prompt\npatterns: source-sync\n---\n');
    await expect(collectEntries(root)).rejects.toThrow(/patterns должно быть списком строк/);
  });
});

describe('collectEntries: title и feature', () => {
  const mod = (key: string, extra: string): string =>
    `---\nkey: ${key}\nkind: module\ntitle: "Модуль: ${key}"\n${extra}---\n`;

  it('читает title и feature модуля, asks в индекс не идёт', async () => {
    await put('prompts/modules/harness.md', mod('harness', ''));
    await put(
      'prompts/modules/worktrees.md',
      mod(
        'worktrees',
        'feature:\n  summary: параллельные ветки\n  default: false\n  requires: [harness]\n  asks:\n    - key: x\n',
      ),
    );
    const { entries } = await collectEntries(root);
    expect(entries.find((e) => e.key === 'harness')).toMatchObject({ title: 'Модуль: harness' });
    expect(entries.find((e) => e.key === 'harness')?.feature).toBeUndefined();
    expect(entries.find((e) => e.key === 'worktrees')?.feature).toEqual({
      summary: 'параллельные ветки',
      default: false,
      requires: ['harness'],
      conflicts: [],
    });
  });

  it.each([
    ['многострочный title', '---\nkey: m\nkind: module\ntitle: |\n  a\n  b\n---\n', /title должно быть непустой строкой/],
    ['feature не у модуля', '---\nkey: m\nkind: contract\nfeature:\n  summary: s\n  default: true\n---\n', /только у kind: module/],
    ['feature не объект', '---\nkey: m\nkind: module\nfeature: yes\n---\n', /feature должно быть объектом/],
    ['неизвестное поле', '---\nkey: m\nkind: module\nfeature:\n  summary: s\n  default: true\n  dflt: 1\n---\n', /неизвестные поля feature: dflt/],
    ['нет summary', '---\nkey: m\nkind: module\nfeature:\n  default: true\n---\n', /нет feature\.summary/],
    ['default не boolean', '---\nkey: m\nkind: module\nfeature:\n  summary: s\n  default: "yes"\n---\n', /true или false/],
    ['requires на себя', '---\nkey: m\nkind: module\nfeature:\n  summary: s\n  default: true\n  requires: [m]\n---\n', /ссылается на сам модуль/],
    ['conflicts на чужое', '---\nkey: m\nkind: module\nfeature:\n  summary: s\n  default: true\n  conflicts: [nope]\n---\n', /модуля «nope» нет в индексе/],
  ])('ошибка: %s', async (_name, content, message) => {
    await put('prompts/modules/m.md', content);
    await expect(collectEntries(root)).rejects.toThrow(message);
  });
});

describe('renderIndex', () => {
  const entry = (over: Partial<IndexEntry>): IndexEntry => ({
    kind: 'prompt',
    key: 'k',
    path: 'prompts/k.md',
    sha256: 'abc',
    applicableTo: [],
    patterns: [],
    ...over,
  });

  it('пишет группы в фиксированном порядке, пустые — как []', () => {
    const out = renderIndex([entry({ kind: 'contract', key: 'c', patterns: ['a', 'b'] })], {
      rawBase: RAW,
      generatedAt: AT,
    });
    expect(out).toBe(
      [
        '# generated by harness index build — do not edit manually',
        'generated_at: 2026-01-02T03:04:05Z',
        '',
        'contracts:',
        '  - key: c',
        '    path: prompts/k.md',
        `    raw: ${RAW}/prompts/k.md`,
        '    sha256: abc',
        '    patterns: [a, b]',
        '',
        'patterns: []',
        '',
        'modules: []',
        '',
        'prompts: []',
        '',
      ].join('\n'),
    );
  });

  it('applicable_to выводится только у модулей', () => {
    const out = renderIndex(
      [
        entry({ kind: 'contract', key: 'c', applicableTo: ['x'] }),
        entry({ kind: 'module', key: 'm', applicableTo: ['c'] }),
      ],
      { rawBase: RAW, generatedAt: AT },
    );
    expect(out.match(/applicable_to/g)).toHaveLength(1);
    expect(out).toContain('  - key: m\n    path: prompts/k.md\n');
    expect(out).toContain('    applicable_to: [c]\n');
  });

  it('выводит title и feature, кавычит только при необходимости', () => {
    const out = renderIndex(
      [
        entry({
          kind: 'module',
          key: 'm',
          title: 'Модуль: m',
          feature: { summary: 'кратко', default: true, requires: ['h'], conflicts: [] },
        }),
        entry({ kind: 'prompt', key: 'p', title: 'Обычный заголовок — без кавычек' }),
      ],
      { rawBase: RAW, generatedAt: AT },
    );
    expect(out).toContain(
      [
        '  - key: m',
        '    title: "Модуль: m"',
        '    path: prompts/k.md',
        `    raw: ${RAW}/prompts/k.md`,
        '    sha256: abc',
        '    feature:',
        '      summary: кратко',
        '      default: true',
        '      requires: [h]',
        '      conflicts: []',
      ].join('\n'),
    );
    expect(out).toContain('  - key: p\n    title: Обычный заголовок — без кавычек\n');
  });

  it('пропускает записи неизвестного kind', () => {
    const out = renderIndex([entry({ kind: 'draft' })], { rawBase: RAW, generatedAt: AT });
    expect(out).not.toContain('key: k');
  });
});

describe('diffIndex', () => {
  it('игнорирует generated_at и CRLF', () => {
    const a = 'h\ngenerated_at: 1\nx: 1\n';
    const b = 'h\r\ngenerated_at: 2\r\nx: 1\r\n';
    expect(diffIndex(a, b)).toEqual([]);
    expect(stripTimestamp(a)).toBe('h\nx: 1\n');
  });

  it('возвращает отличающиеся строки с номерами', () => {
    expect(diffIndex('a\nb\n', 'a\nc\nd\n')).toEqual([
      { line: 2, expected: 'b', actual: 'c' },
      { line: 3, expected: '', actual: 'd' },
      { line: 4, expected: undefined, actual: '' },
    ]);
  });
});
