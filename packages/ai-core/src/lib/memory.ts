import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Diagnostic } from '#shared/diagnostics';
import { errorMessage, errorCode, isRecord } from '#shared/guards';
import {
  CONVENTIONS_DIR,
  DATA_DIR,
  GLOSSARY_DIR,
  NOTES_PATH,
  OC3_DIR,
  OC3_MANIFEST,
  SCHEMAS_DIR,
  BUNDLES_DIR,
} from '#shared/layout';
import { compileSchema, issueText, type Validate } from '#shared/schema';
import { parse } from 'yaml';

export const memoryInstalled = (root: string): boolean => {
  if (
    [OC3_MANIFEST, `${SCHEMAS_DIR}/manifest.schema.json`].some((rel) =>
      existsSync(path.join(root, rel)),
    )
  )
    return true;
  try {
    return readdirSync(path.join(root, BUNDLES_DIR)).some((name) => name !== 'pending');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
};

export interface MemoryBudgets {
  notes: number;
  start: number;
  node: number;
  summary: number;
  optionalField: number;
}

export const DEFAULT_BUDGETS: MemoryBudgets = {
  notes: 4096,
  start: 24576,
  node: 16384,
  summary: 200,
  optionalField: 3,
};

export interface MemoryFileEntry {
  namespace: string[];
  weight: number;
}

export interface MemoryManifest {
  namespace: string[];
  data: string[];
  budgets: MemoryBudgets;
  files: Record<string, MemoryFileEntry>;
}

interface SchemaPair {
  name: string;
  schema: object;
  validate: Validate;
}

const CROSS_REF = /(^|\s)(см\.\s*|см\b|see\s)/i;

const listYaml = async (dir: string, ext: string): Promise<string[]> => {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  return names.filter((n) => n.endsWith(ext)).sort();
};

const readYaml = async (abs: string): Promise<{ data: unknown; error?: string }> => {
  const text = await readFile(abs, 'utf8');
  try {
    return { data: parse(text) };
  } catch (error) {
    return { data: undefined, error: errorMessage(error).split('\n')[0] ?? '' };
  }
};

const stringsOf = (value: unknown, at: string, out: Map<string, string>): void => {
  if (typeof value === 'string') {
    out.set(at, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) stringsOf(item, `${at}[${i}]`, out);
    return;
  }
  if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) stringsOf(v, at === '' ? k : `${at}.${k}`, out);
  }
};

const optionalFields = (schema: object): string[] => {
  const shape = isRecord(schema) && isRecord(schema['items']) ? schema['items'] : schema;
  if (!isRecord(shape) || !isRecord(shape['properties'])) return [];
  const required = Array.isArray(shape['required'])
    ? shape['required'].filter((r): r is string => typeof r === 'string')
    : [];
  return Object.keys(shape['properties']).filter((k) => !required.includes(k));
};

export async function loadManifest(root: string): Promise<{
  manifest: MemoryManifest | null;
  diagnostics: Diagnostic[];
}> {
  const diagnostics: Diagnostic[] = [];
  const manifest = await checkManifest(root, diagnostics);
  if (manifest === null) return { manifest: null, diagnostics };
  await checkManifestFiles(root, manifest, diagnostics);
  return { manifest, diagnostics };
}

export async function checkMemory(root: string): Promise<{
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
}> {
  const warnings: Diagnostic[] = [];
  const loaded = await loadManifest(root);
  const diagnostics = [...loaded.diagnostics];
  const manifest = loaded.manifest;
  if (manifest === null) return { diagnostics, warnings };

  const entries = Object.entries(manifest.files);
  for (const [file, entry] of entries)
    if (entry.weight < 0 || entry.weight > 9)
      diagnostics.push({
        file: OC3_MANIFEST,
        message: `${file}: вес ${entry.weight} вне 0..9 — вес — кольцо графа, не важность; назначь 0 общим фактам (инлайн в старт), 1 — старт-файлам веера, 2..9 — кольца`,
      });
  if (entries.length > 0 && entries.every(([, entry]) => entry.weight > 1))
    diagnostics.push({
      file: OC3_MANIFEST,
      message: 'оперативная память пуста: назначь вес 0 общим фактам, 1 — старт-файлам',
    });

  const schemas = new Map<string, SchemaPair>();
  for (const name of [...manifest.data, 'conventions', 'glossary']) {
    const schema = await loadSchema(root, `${name}.schema.json`, diagnostics);
    if (schema === null) continue;
    schemas.set(name, { name, schema, validate: compileSchema(schema) });
  }

  for (const name of manifest.data) {
    const pair = schemas.get(name);
    if (pair === undefined) continue;
    const dir = path.join(root, DATA_DIR, name);
    const names = await listYaml(dir, '.yml');
    for (const file of names) {
      const rel = `${DATA_DIR}/${name}/${file}`;
      await checkFactFile(root, rel, pair, diagnostics);
    }
    if (names.length === 0) continue;
    await checkOptionalField(dir, names, `${DATA_DIR}/${name}`, pair.schema, manifest, warnings);
  }

  const conventions = path.join(root, CONVENTIONS_DIR);
  const convPair = schemas.get('conventions');
  for (const file of await listYaml(conventions, '.yml')) {
    if (convPair === undefined) continue;
    await checkFactFile(root, `${CONVENTIONS_DIR}/${file}`, convPair, diagnostics);
  }
  const convFiles = await listYaml(conventions, '.yml');
  if (convPair !== undefined && convFiles.length > 0)
    await checkOptionalField(
      conventions,
      convFiles,
      CONVENTIONS_DIR,
      convPair.schema,
      manifest,
      warnings,
    );

  const glossary = path.join(root, GLOSSARY_DIR);
  const glPair = schemas.get('glossary');
  for (const file of await listYaml(glossary, '.yml')) {
    if (glPair === undefined) continue;
    await checkFactFile(root, `${GLOSSARY_DIR}/${file}`, glPair, diagnostics);
  }

  const orphan: string[] = [];
  try {
    const entries = await readdir(path.join(root, DATA_DIR), { withFileTypes: true });
    for (const e of entries)
      if (
        e.isDirectory() &&
        e.name !== '__schemas' &&
        !manifest.data.includes(e.name) &&
        (await listYaml(path.join(root, DATA_DIR, e.name), '.yml')).length > 0
      )
        orphan.push(e.name);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  for (const name of orphan)
    diagnostics.push({
      file: OC3_MANIFEST,
      message: `структура ${name} не заявлена в манифесте (data)`,
    });

  const notes = path.join(root, NOTES_PATH);
  try {
    const size = (await stat(notes)).size;
    if (size > manifest.budgets.notes)
      diagnostics.push({
        file: NOTES_PATH,
        message: `размер NOTES ${size} байт > бюджета ${manifest.budgets.notes} — формализуй в data-структуры`,
      });
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }

  return { diagnostics, warnings };
}

async function loadSchema(
  root: string,
  name: string,
  diagnostics: Diagnostic[],
): Promise<object | null> {
  let text: string;
  try {
    text = await readFile(path.join(root, SCHEMAS_DIR, name), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      diagnostics.push({
        file: `${SCHEMAS_DIR}/${name}`,
        message: 'нет схемы формы — добавь jsonschema структуры',
      });
      return null;
    }
    throw error;
  }
  try {
    const data: unknown = JSON.parse(text);
    return isRecord(data) ? data : null;
  } catch (error) {
    diagnostics.push({
      file: `${SCHEMAS_DIR}/${name}`,
      message: `невалидный JSON: ${errorMessage(error).split('\n')[0]}`,
    });
    return null;
  }
}

async function checkManifest(
  root: string,
  diagnostics: Diagnostic[],
): Promise<MemoryManifest | null> {
  let text: string;
  try {
    text = await readFile(path.join(root, OC3_MANIFEST), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT')
      diagnostics.push({
        file: OC3_MANIFEST,
        message: 'нет манифеста памяти — создай .oc3/manifest.json',
      });
    else
      diagnostics.push({
        file: OC3_MANIFEST,
        message: `невалидный JSON: ${errorMessage(error).split('\n')[0]}`,
      });
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    diagnostics.push({
      file: OC3_MANIFEST,
      message: `невалидный JSON: ${errorMessage(error).split('\n')[0]}`,
    });
    return null;
  }
  const schema = await loadSchema(root, 'manifest.schema.json', diagnostics);
  if (schema === null) return null;
  const issues = compileSchema(schema)(data);
  if (issues.length > 0) {
    for (const i of issues)
      diagnostics.push({
        file: OC3_MANIFEST,
        message: `${i.path || '/'} ${issueText(i)}`.trim(),
      });
    return null;
  }
  if (!isRecord(data)) return null;
  const stringList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const budgets = isRecord(data['budgets']) ? data['budgets'] : {};
  const int = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;
  const files: Record<string, MemoryFileEntry> = {};
  const rawFiles = data['files'];
  if (isRecord(rawFiles))
    for (const [file, raw] of Object.entries(rawFiles)) {
      if (!isRecord(raw)) continue;
      const ns = stringList(raw['namespace']);
      const weight =
        typeof raw['weight'] === 'number' && Number.isInteger(raw['weight']) && raw['weight'] >= 0
          ? raw['weight']
          : 0;
      files[file] = { namespace: ns, weight };
    }
  return {
    namespace: stringList(data['namespace']),
    data: stringList(data['data']),
    budgets: {
      notes: int(budgets['notes'], DEFAULT_BUDGETS.notes),
      start: int(budgets['start'], DEFAULT_BUDGETS.start),
      node: int(budgets['node'], DEFAULT_BUDGETS.node),
      summary: int(budgets['summary'], DEFAULT_BUDGETS.summary),
      optionalField: int(budgets['optional_field'], DEFAULT_BUDGETS.optionalField),
    },
    files,
  };
}

const checkManifestFiles = async (
  root: string,
  manifest: MemoryManifest,
  diagnostics: Diagnostic[],
): Promise<void> => {
  for (const [file, entry] of Object.entries(manifest.files)) {
    try {
      await stat(path.join(root, OC3_DIR, file));
    } catch (error) {
      if (errorCode(error) === 'ENOENT')
        diagnostics.push({
          file: OC3_MANIFEST,
          message: `файл ${file} из манифеста не существует в ${OC3_DIR}/`,
        });
      else throw error;
    }
    for (const ns of entry.namespace)
      if (!manifest.namespace.includes(ns))
        diagnostics.push({
          file: OC3_MANIFEST,
          message: `${file}: namespace ${ns} не заявлен в списке namespace манифеста`,
        });
  }
};

async function checkFactFile(
  root: string,
  rel: string,
  pair: SchemaPair,
  diagnostics: Diagnostic[],
): Promise<void> {
  const { data, error } = await readYaml(path.join(root, rel));
  if (error !== undefined) {
    diagnostics.push({ file: rel, message: `невалидный YAML: ${error}` });
    return;
  }
  const issues = pair.validate(data);
  if (issues.length > 0) {
    for (const i of issues)
      diagnostics.push({ file: rel, message: `${i.path || '/'} ${issueText(i)}`.trim() });
    return;
  }
  const strings = new Map<string, string>();
  stringsOf(data, '', strings);
  for (const [at, text] of strings) {
    const m = CROSS_REF.exec(text);
    if (m !== null)
      diagnostics.push({
        file: rel,
        message: `${at}: перекрёстное упоминание «${text.slice(m.index, m.index + 24).trim()}…» — факт рендерится ровно один раз, ссылки даёт бандл`,
      });
  }
}

async function checkOptionalField(
  dir: string,
  files: readonly string[],
  relBase: string,
  schema: object,
  manifest: MemoryManifest,
  warnings: Diagnostic[],
): Promise<void> {
  for (const field of optionalFields(schema)) {
    let count = 0;
    for (const file of files) {
      const { data } = await readYaml(path.join(dir, file));
      if (usesField(data, field)) count += 1;
    }
    if (count > manifest.budgets.optionalField)
      warnings.push({
        file: relBase,
        message: `опциональное поле ${field} используется в ${count} файлах > порога ${manifest.budgets.optionalField} — формализуй поле в схеме или факты`,
      });
  }
}

const usesField = (data: unknown, field: string): boolean => {
  if (Array.isArray(data)) return data.some((item) => usesField(item, field));
  if (isRecord(data)) {
    if (data[field] !== undefined) return true;
    return Object.values(data).some((v) => usesField(v, field));
  }
  return false;
};
