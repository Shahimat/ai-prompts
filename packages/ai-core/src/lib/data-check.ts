import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { DATA_INDEX_SCHEMA } from '#lib/data-index-schema';
import { errorCode, errorMessage, isRecord } from '#shared/guards';
import { compileSchema, issueText, schemaSet, type Validate } from '#shared/schema';

export const DATA_PATH = '.oc/data';
const PROJECT_INDEX = '.oc/index.yml';
const validateIndex = compileSchema(DATA_INDEX_SCHEMA);

export interface DataIssue {
  file: string;
  message: string;
}

export interface DataReport {
  structures: number;
  records: number;
  errors: DataIssue[];
}

export interface DataStructure {
  key: string;
  files: Record<string, string>;
  directories: string[];
}

const failure = (error: unknown): string => errorMessage(error).split('\n')[0] ?? '';

const schemaIssues = (file: string, validate: Validate, data: unknown): DataIssue[] =>
  validate(data).map((issue) => ({
    file,
    message: `${issue.path === '' ? '(корень)' : issue.path} ${issueText(issue)}`,
  }));

const parseObject = (
  text: string,
  file: string,
  json: boolean,
  errors: DataIssue[],
): Record<string, unknown> | undefined => {
  try {
    const data: unknown = json ? JSON.parse(text) : parse(text);
    if (isRecord(data)) return data;
    errors.push({ file, message: 'корень должен быть объектом' });
  } catch (error) {
    errors.push({ file, message: `невалидный ${json ? 'JSON' : 'YAML'}: ${failure(error)}` });
  }
  return undefined;
};

const recordValidator = (structure: DataStructure, errors: DataIssue[]): Validate | undefined => {
  const base = `${DATA_PATH}/${structure.key}`;
  const schemas: Record<string, object> = {};
  for (const name of Object.keys(structure.files).sort()) {
    if (name !== 'schema.json' && !name.endsWith('.schema.json')) continue;
    const text = structure.files[name];
    if (text === undefined) continue;
    const schema = parseObject(text, `${base}/${name}`, true, errors);
    if (schema !== undefined) schemas[name] = schema;
  }
  if (schemas['schema.json'] === undefined) return undefined;
  try {
    return schemaSet(schemas)('schema.json');
  } catch (error) {
    errors.push({ file: `${base}/schema.json`, message: `невалидная схема: ${failure(error)}` });
    return undefined;
  }
};

const checkRecordList = (
  index: Record<string, unknown>,
  structure: DataStructure,
  records: string[],
  errors: DataIssue[],
): void => {
  const file = `${DATA_PATH}/${structure.key}/index.yaml`;
  const listed = index['records'];
  if (!Array.isArray(listed)) return;
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const item of listed) {
    if (!isRecord(item)) continue;
    const id = item['id'];
    const name = item['file'];
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    if (ids.has(id)) errors.push({ file, message: `повтор id «${id}»` });
    if (files.has(name)) errors.push({ file, message: `повтор file «${name}»` });
    ids.add(id);
    files.add(name);
    if (name !== `${id}.yml`)
      errors.push({ file, message: `id «${id}» не совпадает с именем файла «${name}»` });
    if (!records.includes(name)) errors.push({ file, message: `нет файла записи «${name}»` });
  }
  for (const name of records) {
    if (!files.has(name))
      errors.push({ file, message: `запись «${name}» не перечислена в records` });
  }
};

const checkStructure = (structure: DataStructure): DataReport => {
  const errors: DataIssue[] = [];
  const base = `${DATA_PATH}/${structure.key}`;
  for (const name of ['schema.json', 'index.yaml']) {
    if (!Object.hasOwn(structure.files, name))
      errors.push({ file: `${base}/${name}`, message: 'обязательный файл отсутствует' });
  }
  for (const name of structure.directories)
    errors.push({ file: `${base}/${name}`, message: 'вложенные каталоги запрещены' });
  const validate = recordValidator(structure, errors);
  const records = Object.keys(structure.files)
    .filter((name) => name.endsWith('.yml'))
    .sort();
  const indexText = structure.files['index.yaml'];
  if (indexText !== undefined) {
    const file = `${base}/index.yaml`;
    const index = parseObject(indexText, file, false, errors);
    if (index !== undefined) {
      errors.push(...schemaIssues(file, validateIndex, index));
      if (index['key'] !== structure.key)
        errors.push({ file, message: `key должен совпадать с именем каталога «${structure.key}»` });
      checkRecordList(index, structure, records, errors);
    }
  }
  for (const name of records) {
    const text = structure.files[name];
    if (text === undefined) continue;
    const file = `${base}/${name}`;
    const data = parseObject(text, file, false, errors);
    if (data === undefined) continue;
    if (validate !== undefined) errors.push(...schemaIssues(file, validate, data));
    if (Object.hasOwn(data, 'id') && data['id'] !== name.slice(0, -4))
      errors.push({ file, message: 'id должен совпадать с именем файла без расширения' });
  }
  return { structures: 1, records: records.length, errors };
};

const checkProjectIndex = (text: string, structures: DataStructure[]): DataIssue[] => {
  const errors: DataIssue[] = [];
  const index = parseObject(text, PROJECT_INDEX, false, errors);
  if (index === undefined || !Object.hasOwn(index, 'data')) return errors;
  const data = index['data'];
  if (!Array.isArray(data)) {
    errors.push({
      file: PROJECT_INDEX,
      message: 'data должен быть списком отображений с key и path',
    });
    return errors;
  }
  const listed = new Set<string>();
  for (const item of data) {
    if (
      !isRecord(item) ||
      typeof item['key'] !== 'string' ||
      typeof item['path'] !== 'string' ||
      (item['summary'] !== undefined && typeof item['summary'] !== 'string')
    ) {
      errors.push({
        file: PROJECT_INDEX,
        message: 'data должен быть списком отображений с key и path',
      });
      continue;
    }
    const key = item['key'];
    const target = item['path'];
    const structure = structures.find((entry) => target === `${DATA_PATH}/${entry.key}/index.yaml`);
    if (structure === undefined || !Object.hasOwn(structure.files, 'index.yaml')) {
      errors.push({
        file: PROJECT_INDEX,
        message: `data.path «${target}» должен указывать на существующий index.yaml внутри ${DATA_PATH}`,
      });
      continue;
    }
    listed.add(structure.key);
    if (key !== structure.key)
      errors.push({
        file: PROJECT_INDEX,
        message: `data.key должен совпадать с «${structure.key}»`,
      });
  }
  for (const structure of structures) {
    if (!listed.has(structure.key))
      errors.push({
        file: PROJECT_INDEX,
        message: `структура «${structure.key}» не перечислена в data`,
      });
  }
  return errors;
};

export const validateData = (structures: DataStructure[], projectIndex?: string): DataReport => {
  const reports = structures.map(checkStructure);
  return {
    structures: structures.length,
    records: reports.reduce((sum, report) => sum + report.records, 0),
    errors: [
      ...reports.flatMap((report) => report.errors),
      ...(projectIndex === undefined ? [] : checkProjectIndex(projectIndex, structures)),
    ],
  };
};

export const checkData = async (root: string): Promise<DataReport> => {
  const errors: DataIssue[] = [];
  const structures: DataStructure[] = [];
  const read = async (file: string): Promise<string | undefined> => {
    try {
      return await readFile(path.join(root, file), 'utf8');
    } catch (error) {
      if (file !== PROJECT_INDEX || errorCode(error) !== 'ENOENT')
        errors.push({ file, message: `не удалось прочитать файл: ${failure(error)}` });
      return undefined;
    }
  };
  const list = async (dir: string) => {
    try {
      return (await readdir(path.join(root, dir), { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    } catch (error) {
      if (dir !== DATA_PATH || errorCode(error) !== 'ENOENT')
        errors.push({ file: dir, message: `не удалось прочитать каталог: ${failure(error)}` });
      return [];
    }
  };
  for (const entry of await list(DATA_PATH)) {
    const base = `${DATA_PATH}/${entry.name}`;
    if (!entry.isDirectory()) {
      errors.push({ file: base, message: 'ожидается каталог структуры' });
      continue;
    }
    const structure: DataStructure = { key: entry.name, files: {}, directories: [] };
    for (const child of await list(base)) {
      if (child.isDirectory()) structure.directories.push(child.name);
      else if (child.isFile()) {
        const text = await read(`${base}/${child.name}`);
        if (text !== undefined) structure.files[child.name] = text;
      } else errors.push({ file: `${base}/${child.name}`, message: 'ожидается обычный файл' });
    }
    structures.push(structure);
  }
  const report = validateData(structures, await read(PROJECT_INDEX));
  return { ...report, errors: [...errors, ...report.errors] };
};
