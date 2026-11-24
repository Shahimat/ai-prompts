import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { runData } from '#commands/data/index';
import { checkData, DATA_PATH, validateData, type DataStructure } from '#lib/data-check';
import { COMMAND_NODES } from '#registry';

const schema = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: { id: { type: 'string' }, title: { type: 'string' } },
});

const index = (
  records: unknown = [{ id: 'first', file: 'first.yml', summary: 'Первая' }],
): string => stringify({ key: 'items', title: 'Записи', summary: 'Пример', records });

const structure = (
  files: Record<string, string> = {},
  directories: string[] = [],
): DataStructure => ({
  key: 'items',
  directories,
  files: {
    'schema.json': schema,
    'index.yaml': index(),
    'first.yml': 'id: first\ntitle: Первая\n',
    ...files,
  },
});

let root: string;

const put = async (file: string, text: string): Promise<void> => {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
};

const putStructure = async (entry: DataStructure): Promise<void> => {
  for (const [name, text] of Object.entries(entry.files))
    await put(`${DATA_PATH}/${entry.key}/${name}`, text);
  for (const directory of entry.directories)
    await mkdir(path.join(root, DATA_PATH, entry.key, directory), { recursive: true });
};

const snapshot = async (): Promise<Record<string, string>> => {
  const files: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(root, file)] = await readFile(file, 'utf8');
  }
  return files;
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ai-data-check-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('data check', () => {
  it('проверяет две структуры, соседний $ref и data в индексе без записи', async () => {
    await putStructure(
      structure({
        'schema.json': JSON.stringify({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          required: ['title'],
          properties: { title: { $ref: 'title.schema.json' } },
        }),
        'title.schema.json': '{"type":"string","minLength":1}',
      }),
    );
    await putStructure({
      key: 'other',
      directories: [],
      files: {
        'schema.json': schema,
        'index.yaml': stringify({
          key: 'other',
          title: 'Другие',
          summary: 'Другие записи',
          namespace: 'contract',
          skill: null,
          records: [{ id: 'second', file: 'second.yml', summary: 'Вторая' }],
        }),
        'second.yml': 'title: Вторая\n',
      },
    });
    await put(
      '.oc/index.yml',
      stringify({
        data: [
          { key: 'items', path: '.oc/data/items/index.yaml', summary: 'Записи' },
          { key: 'other', path: '.oc/data/other/index.yaml' },
        ],
      }),
    );
    const before = await snapshot();
    expect(await checkData(root)).toEqual({ structures: 2, records: 2, errors: [] });
    expect(await snapshot()).toEqual(before);
  });

  it('успешен без .oc/data и без конфигурации', async () => {
    expect(await checkData(root)).toEqual({ structures: 0, records: 0, errors: [] });
  });

  it('успешен с пустым каталогом данных', async () => {
    await mkdir(path.join(root, DATA_PATH), { recursive: true });
    expect(await checkData(root)).toEqual({ structures: 0, records: 0, errors: [] });
  });

  it('успешен с пустой структурой без записей', async () => {
    await putStructure({
      key: 'items',
      directories: [],
      files: { 'schema.json': schema, 'index.yaml': index([]) },
    });
    expect(await checkData(root)).toEqual({ structures: 1, records: 0, errors: [] });
  });

  it('отвергает файлы прямо в .oc/data', async () => {
    await put('.oc/data/loose.yml', 'title: Запись\n');
    expect((await checkData(root)).errors).toEqual([
      { file: '.oc/data/loose.yml', message: 'ожидается каталог структуры' },
    ]);
  });

  it('требует оба обязательных файла', () => {
    expect(validateData([{ key: 'items', files: {}, directories: [] }]).errors).toEqual([
      { file: '.oc/data/items/schema.json', message: 'обязательный файл отсутствует' },
      { file: '.oc/data/items/index.yaml', message: 'обязательный файл отсутствует' },
    ]);
  });

  it('отвергает вложенные каталоги', async () => {
    await putStructure(structure({}, ['nested']));
    expect((await checkData(root)).errors).toEqual([
      { file: '.oc/data/items/nested', message: 'вложенные каталоги запрещены' },
    ]);
  });

  it.each([
    ['невалидный JSON', 'schema.json', '{', /невалидный JSON/],
    ['схема не объект', 'schema.json', '[]', /корень должен быть объектом/],
    ['схема не компилируется', 'schema.json', '{"type":"wrong"}', /невалидная схема/],
    ['неразрешимый ref', 'schema.json', '{"$ref":"missing.schema.json"}', /невалидная схема/],
    ['соседняя схема не объект', 'bad.schema.json', 'null', /корень должен быть объектом/],
    ['невалидный YAML индекса', 'index.yaml', 'key: [', /невалидный YAML/],
    ['индекс не объект', 'index.yaml', '[]', /корень должен быть объектом/],
    ['нет обязательных полей', 'index.yaml', 'key: items\n', /required property 'title'/],
    [
      'неизвестное поле индекса',
      'index.yaml',
      `${index()}extra: true\n`,
      /additional properties: extra/,
    ],
    [
      'пустой title',
      'index.yaml',
      stringify({ key: 'items', title: ' ', summary: 'Пример', records: [] }),
      /\/title must match pattern/,
    ],
    [
      'пустой summary',
      'index.yaml',
      stringify({ key: 'items', title: 'Пример', summary: '', records: [] }),
      /\/summary must match pattern/,
    ],
    ['несовпадающий key', 'index.yaml', index().replace('key: items', 'key: wrong'), /key должен/],
    [
      'не kebab-case id',
      'index.yaml',
      index([{ id: 'Bad', file: 'first.yml', summary: 's' }]),
      /\/records\/0\/id must match pattern/,
    ],
    [
      'пустой summary записи',
      'index.yaml',
      index([{ id: 'first', file: 'first.yml', summary: '' }]),
      /\/records\/0\/summary must match pattern/,
    ],
    [
      'неизвестное поле записи',
      'index.yaml',
      index([{ id: 'first', file: 'first.yml', summary: 's', extra: true }]),
      /additional properties: extra/,
    ],
    [
      'путь записи вне структуры',
      'index.yaml',
      index([{ id: 'first', file: '../first.yml', summary: 's' }]),
      /\/records\/0\/file must match pattern/,
    ],
    ['невалидный YAML записи', 'first.yml', 'title: [', /невалидный YAML/],
    ['запись не объект', 'first.yml', '- value\n', /корень должен быть объектом/],
    ['запись не по схеме', 'first.yml', 'title: 7\n', /\/title must be string/],
    ['id записи не совпадает', 'first.yml', 'id: wrong\ntitle: Первая\n', /id должен совпадать/],
    [
      'нет файла records',
      'index.yaml',
      index([{ id: 'lost', file: 'lost.yml', summary: 's' }]),
      /нет файла записи «lost.yml»/,
    ],
    [
      'id records не совпадает',
      'index.yaml',
      index([{ id: 'wrong', file: 'first.yml', summary: 's' }]),
      /id «wrong» не совпадает/,
    ],
    ['запись не перечислена', 'index.yaml', index([]), /не перечислена в records/],
    [
      'повтор id',
      'index.yaml',
      index([
        { id: 'first', file: 'first.yml', summary: 's' },
        { id: 'first', file: 'other.yml', summary: 's' },
      ]),
      /повтор id/,
    ],
    [
      'повтор file',
      'index.yaml',
      index([
        { id: 'first', file: 'first.yml', summary: 's' },
        { id: 'other', file: 'first.yml', summary: 's' },
      ]),
      /повтор file/,
    ],
  ])('%s', (_name, file, text, expected) => {
    const report = validateData([structure({ [file]: text })]);
    expect(
      report.errors.some(
        (error) => error.file === `.oc/data/items/${file}` && expected.test(error.message),
      ),
    ).toBe(true);
  });

  it('сохраняет все ошибки Ajv с путями в данных', () => {
    const report = validateData([structure({ 'first.yml': 'title: 7\nextra: true\n' })]);
    expect(report.errors).toEqual([
      {
        file: '.oc/data/items/first.yml',
        message: '(корень) must NOT have additional properties: extra',
      },
      { file: '.oc/data/items/first.yml', message: '/title must be string' },
    ]);
  });

  it.each([
    ['data отсутствует', 'project: {}\n'],
    ['data отсутствует при других секциях', 'entities: []\n'],
  ])('пропускает сверку проекта: %s', (_name, text) => {
    expect(validateData([structure()], text).errors).toEqual([]);
  });

  it.each([
    ['data не список', 'data: {}\n', /data должен быть списком/],
    ['элемент не отображение', 'data: [text]\n', /data должен быть списком/],
    ['нет key', 'data: [{path: .oc/data/items/index.yaml}]\n', /data должен быть списком/],
    ['нет path', 'data: [{key: items}]\n', /data должен быть списком/],
    ['path не строка', 'data: [{key: items, path: 1}]\n', /data должен быть списком/],
    [
      'summary не строка',
      'data: [{key: items, path: .oc/data/items/index.yaml, summary: 1}]\n',
      /data должен быть списком/,
    ],
    ['структура не перечислена', 'data: []\n', /не перечислена в data/],
    [
      'структуры нет',
      'data: [{key: lost, path: .oc/data/lost/index.yaml}]\n',
      /существующий index.yaml/,
    ],
    ['путь вне data', 'data: [{key: items, path: context/index.yaml}]\n', /внутри .oc\/data/],
    [
      'неверное имя файла',
      'data: [{key: items, path: .oc/data/items/first.yml}]\n',
      /существующий index.yaml/,
    ],
    [
      'несовпадающий key',
      'data: [{key: wrong, path: .oc/data/items/index.yaml}]\n',
      /data.key должен совпадать/,
    ],
    ['невалидный YAML проекта', 'data: [', /невалидный YAML/],
  ])('индекс проекта: %s', (_name, text, expected) => {
    expect(
      validateData([structure()], text).errors.some(
        (error) => error.file === '.oc/index.yml' && expected.test(error.message),
      ),
    ).toBe(true);
  });

  it('индекс проекта требует существующий index.yaml даже у обнаруженной структуры', () => {
    const entry: DataStructure = {
      key: 'items',
      files: { 'schema.json': schema },
      directories: [],
    };
    const report = validateData([entry], 'data: [{key: items, path: .oc/data/items/index.yaml}]\n');
    expect(report.errors.some((error) => error.message.includes('существующий index.yaml'))).toBe(
      true,
    );
  });

  it('проверяет data проекта даже при отсутствии каталога данных', async () => {
    await put('.oc/index.yml', 'data: [{key: lost, path: .oc/data/lost/index.yaml}]\n');
    expect((await checkData(root)).errors).toHaveLength(1);
  });
});

describe('команда data check', () => {
  it('зарегистрирована как read-only и печатает итог успеха', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const node = COMMAND_NODES.find((entry) => entry.path.join(' ') === 'data check');
    expect(node).toMatchObject({ kind: 'command', effect: 'query' });
    if (node === undefined) throw new Error('нет команды data check');
    expect(await node.run({ root, now: new Date() })).toBe(0);
    expect(log).toHaveBeenCalledExactlyOnceWith('data check: 0 structures, 0 records, 0 errors');
    expect(error).not.toHaveBeenCalled();
  });

  it('печатает каждую ошибку отдельной строкой и возвращает 1', async () => {
    await putStructure(structure({ 'first.yml': 'title: 7\nextra: true\n' }));
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((text: string) => {
      lines.push(text);
    });
    vi.spyOn(console, 'error').mockImplementation((text: string) => {
      lines.push(text);
    });
    expect(await runData('check', { root, now: new Date() })).toBe(1);
    expect(lines).toEqual([
      'ERROR: .oc/data/items/first.yml: (корень) must NOT have additional properties: extra',
      'ERROR: .oc/data/items/first.yml: /title must be string',
      'data check: 1 structures, 1 records, 2 errors',
    ]);
  });

  it('отвергает неизвестную подкоманду', async () => {
    await expect(runData('write', { root, now: new Date() })).rejects.toThrow(
      'неизвестная команда: data write',
    );
  });
});
