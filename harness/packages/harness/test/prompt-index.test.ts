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

describe('collectEntries: skills и agents', () => {
  it('skill — каталог с файлами, SHA меняется при правке любого файла', async () => {
    await put('skills/keeper/SKILL.md', '---\nname: keeper\ndescription: ведёт доку\n---\nтело\n');
    await put('skills/keeper/ref/a.md', 'a\n');
    const first = (await collectEntries(root)).entries;
    expect(first).toEqual([
      {
        kind: 'skill',
        key: 'keeper',
        path: 'skills/keeper',
        sha256: sha256(`${sha256('---\nname: keeper\ndescription: ведёт доку\n---\nтело\n')}  SKILL.md\n${sha256('a\n')}  ref/a.md\n`),
        applicableTo: [],
        patterns: [],
        title: 'ведёт доку',
        files: [
          { path: 'skills/keeper/SKILL.md', sha256: sha256('---\nname: keeper\ndescription: ведёт доку\n---\nтело\n') },
          { path: 'skills/keeper/ref/a.md', sha256: sha256('a\n') },
        ],
      },
    ]);
    await put('skills/keeper/ref/a.md', 'b\n');
    expect((await collectEntries(root)).entries[0]?.sha256).not.toBe(first[0]?.sha256);
  });

  it('agent — файл agents/<name>.md', async () => {
    const content = '---\nname: keeper\ndescription: субагент\nskills: [keeper]\n---\nинструкция\n';
    await put('agents/keeper.md', content);
    await put('agents/notes.txt', 'не агент');
    expect((await collectEntries(root)).entries).toEqual([
      { kind: 'agent', key: 'keeper', path: 'agents/keeper.md', sha256: sha256(content), applicableTo: [], patterns: [], title: 'субагент' },
    ]);
  });

  it.each([
    ['нет SKILL.md', 'skills/x/README.md', 'x\n', /skills\/x: нет SKILL\.md/],
    ['name skill не совпадает', 'skills/x/SKILL.md', '---\nname: y\ndescription: d\n---\n', /name должно совпадать с именем «x»/],
    ['нет description', 'skills/x/SKILL.md', '---\nname: x\n---\n', /нет description/],
    ['name агента не совпадает', 'agents/x.md', '---\nname: y\ndescription: d\n---\n', /agents\/x\.md: name/],
  ])('ошибка: %s', async (_name, file, content, message) => {
    await put(file, content);
    await expect(collectEntries(root)).rejects.toThrow(message);
  });
});

describe('deprecated', () => {
  it('попадает в индекс строкой после sha256', async () => {
    await put('prompts/old.md', '---\nkey: old\nkind: contract\ndeprecated: presets/personal.yml\n---\n');
    const { entries } = await collectEntries(root);
    expect(entries[0]?.deprecated).toBe('presets/personal.yml');
    const out = renderIndex(entries, { rawBase: RAW, generatedAt: AT });
    expect(out).toMatch(/    sha256: [0-9a-f]{64}\n    deprecated: presets\/personal\.yml\n/);
  });

  it('многострочный deprecated — ошибка', async () => {
    await put('prompts/old.md', '---\nkey: old\nkind: contract\ndeprecated: |\n  a\n  b\n---\n');
    await expect(collectEntries(root)).rejects.toThrow(/deprecated должно быть непустой строкой/);
  });
});

describe('collectEntries: presets', () => {
  async function base(): Promise<void> {
    await put('prompts/c.md', '---\nkey: core\nkind: contract\n---\n');
    await put('prompts/modules/m.md', '---\nkey: m\nkind: module\napplicable_to: [core]\n---\n');
    await put('prompts/modules/old.md', '---\nkey: old\nkind: module\napplicable_to: [other]\n---\n');
  }
  const preset = (body: string): string => `key: p\ntitle: Пресет\ncontract: core\n${body}`;

  it('пресет — запись с контрактом в applicable_to', async () => {
    await base();
    const content = preset('modules:\n  - key: m\n    answers: {x: 1}\n');
    await put('presets/p.yml', content);
    const entry = (await collectEntries(root)).entries.find((e) => e.kind === 'preset');
    expect(entry).toEqual({
      kind: 'preset',
      key: 'p',
      path: 'presets/p.yml',
      sha256: sha256(content),
      applicableTo: ['core'],
      patterns: [],
      title: 'Пресет',
    });
  });

  it.each([
    ['key не по имени файла', 'key: q\ntitle: t\ncontract: core\nmodules: [{key: m}]\n', /key должно совпадать/],
    ['нет title', 'key: p\ncontract: core\nmodules: [{key: m}]\n', /нет title/],
    ['нет контракта', 'key: p\ntitle: t\ncontract: nope\nmodules: [{key: m}]\n', /контракта «nope» нет/],
    ['пустые modules', 'key: p\ntitle: t\ncontract: core\nmodules: []\n', /непустой список/],
    ['нет модуля', 'key: p\ntitle: t\ncontract: core\nmodules: [{key: x}]\n', /модуля «x» нет/],
    ['неприменимый модуль', 'key: p\ntitle: t\ncontract: core\nmodules: [{key: old}]\n', /не применим к «core»/],
  ])('ошибка: %s', async (_name, content, message) => {
    await base();
    await put('presets/p.yml', content);
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
        'skills: []',
        '',
        'agents: []',
        '',
        'presets: []',
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

  it('у skill нет raw, у каждого файла — свой raw и sha256', () => {
    const out = renderIndex(
      [entry({ kind: 'skill', key: 's', path: 'skills/s', title: 't', files: [{ path: 'skills/s/SKILL.md', sha256: 'f1' }] })],
      { rawBase: RAW, generatedAt: AT },
    );
    expect(out).toContain(
      [
        'skills:',
        '  - key: s',
        '    title: t',
        '    path: skills/s',
        '    sha256: abc',
        '    files:',
        '      - path: skills/s/SKILL.md',
        `        raw: ${RAW}/skills/s/SKILL.md`,
        '        sha256: f1',
      ].join('\n'),
    );
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
