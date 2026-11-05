import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as ts from 'typescript';
import { parse } from 'yaml';
import type { Diagnostic } from '#shared/diagnostics';
import { errorCode, isRecord } from '#shared/guards';
import {
  BUNDLES_DIR,
  CONTEXT_INDEX_PATH,
  DATA_DIR,
  DOC_DIR,
  GOALS_DIR,
  SCHEMAS_DIR,
  SKILLS_PATH,
} from '#shared/layout';
import { loadManifest, type MemoryManifest } from './memory.ts';

export const START_INDEX = 'index.md';
const GENERAL_NS = 'common';
const DATA_BASE = DATA_DIR.slice(DOC_DIR.length + 1);

interface FactSchema {
  properties: string[];
}

export interface FactFile {
  rel: string;
  namespace: string[];
  weight: number;
  text: string;
  summary: string;
}

export interface GraphNode {
  key: string;
  namespace: string;
  weight: number;
  files: string[];
  sha: string;
  dir: string;
  text: string;
}

export interface MemoryGraph {
  start: string;
  nodes: GraphNode[];
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const shaOf = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const walkDoc = async (root: string): Promise<string[]> => {
  const base = path.join(root, DOC_DIR);
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    for (const e of entries) {
      const parent = dir === base ? '' : dir.slice(base.length + 1);
      const rel = path.posix.join(...parent.split(path.sep), e.name);
      if (e.isDirectory()) {
        if (e.name === '__schemas') continue;
        await walk(path.join(dir, e.name));
        continue;
      }
      if (rel === CONTEXT_INDEX_PATH.slice(DOC_DIR.length + 1)) continue;
      if (e.name.endsWith('.yml') || e.name.endsWith('.md')) out.push(rel);
    }
  };
  await walk(base);
  return out.sort();
};

const LEAD_KEYS = ['key', 'term', 'id'] as const;
const LABELS: Record<string, string> = {
  summary: '',
  definition: '',
  title: '',
  rule: 'Правило: ',
  reason: 'Причина: ',
  namespace: 'домен ',
  steps: 'Шаги: ',
  manuals: 'Manuals: ',
};

const renderValue = (value: unknown, label: string): string => {
  if (typeof value === 'string') return `${label}${collapse(value)}`;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    const items = value.map((v) => collapse(v));
    return label === 'Шаги: '
      ? `${label}${items.map((v, i) => `${i + 1}) ${v}`).join(' ')}`
      : `${label}${items.join(', ')}`;
  }
  return '';
};

const itemLine = (properties: string[], item: Record<string, unknown>): string => {
  const leadKey = properties.find((k) => (LEAD_KEYS as readonly string[]).includes(k));
  const leadRaw = leadKey === undefined ? undefined : item[leadKey];
  const lead = typeof leadRaw === 'string' ? collapse(leadRaw) : '';
  const parts: string[] = [];
  for (const key of properties) {
    if (key === leadKey || !(key in item)) continue;
    const rendered = renderValue(item[key], LABELS[key] ?? `${key}: `);
    if (rendered !== '') parts.push(rendered);
  }
  const body = parts.length === 0 ? '' : ` — ${parts.map((p) => p.replace(/\.$/, '')).join('. ')}`;
  return `- ${lead}${body}`.trimEnd();
};

const flattenRecord = (data: Record<string, unknown>, prefix: string): string[] => {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const where = prefix === '' ? key : `${prefix}.${key}`;
    if (isRecord(value)) {
      lines.push(...flattenRecord(value, where));
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${where} — ${value.map((v) => collapse(String(v))).join(', ')}`);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${where} — ${String(value)}`);
      continue;
    }
    if (typeof value === 'string' && collapse(value) !== '')
      lines.push(`${where} — ${collapse(value)}`);
  }
  return lines;
};

const schemaNameOf = (rel: string): string => {
  const parts = rel.split('/');
  if (parts.length < 2) return '';
  return parts[0] === DATA_BASE ? (parts[1] ?? '') : (parts[0] ?? '');
};

const loadSchemaOf = async (
  root: string,
  rel: string,
  diagnostics: Diagnostic[],
): Promise<FactSchema> => {
  const name = schemaNameOf(rel);
  if (name === '') return { properties: [] };
  const file = path.join(root, SCHEMAS_DIR, `${name}.schema.json`);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { properties: [] };
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    diagnostics.push({ file: `${SCHEMAS_DIR}/${name}.schema.json`, message: 'невалидный JSON' });
    return { properties: [] };
  }
  if (!isRecord(data)) return { properties: [] };
  const shape = isRecord(data['items']) ? data['items'] : data;
  const properties =
    isRecord(shape) && isRecord(shape['properties']) ? Object.keys(shape['properties']) : [];
  return { properties };
};

const mdSummary = (text: string): string => {
  const heading = text.split('\n').find((l) => l.startsWith('#'));
  if (heading !== undefined) return collapse(heading.replace(/^#+\s*/, ''));
  const paragraph = text.split('\n\n').find((p) => collapse(p) !== '');
  return paragraph === undefined ? '' : collapse(paragraph).slice(0, 120);
};

const loadFacts = async (
  root: string,
  manifest: MemoryManifest,
  diagnostics: Diagnostic[],
): Promise<FactFile[]> => {
  const facts: FactFile[] = [];
  for (const rel of await walkDoc(root)) {
    const entry = manifest.files[rel];
    const namespace = entry?.namespace ?? [];
    const weight = entry?.weight ?? 0;
    const raw = await readFile(path.join(root, DOC_DIR, rel), 'utf8');
    if (rel.endsWith('.md')) {
      const kind = rel.split('/')[0] ?? '';
      const label = kind === 'manuals' ? 'инструкция: ' : kind === 'knowledge' ? 'карта: ' : '';
      facts.push({
        rel,
        namespace,
        weight,
        text: `${raw.trimEnd()}\n`,
        summary: `${label}${mdSummary(raw)}`,
      });
      continue;
    }
    let data: unknown;
    try {
      data = parse(raw);
    } catch (error) {
      diagnostics.push({
        file: `${DOC_DIR}/${rel}`,
        message: `невалидный YAML: ${error instanceof Error ? error.message.split('\n')[0] : ''}`,
      });
      continue;
    }
    const schema = await loadSchemaOf(root, rel, diagnostics);
    if (Array.isArray(data)) {
      const lines = data.map((item) =>
        isRecord(item) && schema.properties.length > 0
          ? itemLine(schema.properties, item)
          : isRecord(item)
            ? flattenRecord(item, '').join('; ')
            : `- ${collapse(String(item))}`,
      );
      const first = lines.find((l) => l.trim() !== '') ?? '';
      facts.push({
        rel,
        namespace,
        weight,
        text: `${lines.join('\n')}\n`,
        summary: `${data.length} записей, первая: ${collapse(first.replace(/^- /, ''))}`,
      });
      continue;
    }
    if (isRecord(data)) {
      const lines =
        schema.properties.length > 0
          ? [itemLine(schema.properties, data)]
          : flattenRecord(data, '');
      const clean = lines.filter((l) => l.trim() !== '');
      const first = clean.find((l) => l.trim() !== '') ?? '';
      facts.push({
        rel,
        namespace,
        weight,
        text: `${clean.join('\n')}\n`,
        summary: collapse(first.replace(/^- /, '')),
      });
      continue;
    }
    diagnostics.push({
      file: `${DOC_DIR}/${rel}`,
      message: `корень должен быть объектом или списком, получено: ${typeof data}`,
    });
  }
  return facts;
};

const nodeKeyOf = (namespace: string, weight: number): string =>
  `${namespace === '' ? GENERAL_NS : namespace}:${weight}`;

const nodeFrame = (key: string, weight: number, count: number, body: string): string =>
  `# Узел ${key}\n\nКольцо: ${weight}\nФайлов: ${count}\n\n${body}`;

interface Bucket {
  namespace: string;
  weight: number;
  files: string[];
}

const nodeBody = (bucket: Bucket, facts: FactFile[], edges: GraphNode[]): string => {
  const byRel = new Map(facts.map((f) => [f.rel, f]));
  const lines: string[] = ['Файлы узла:', ''];
  for (const rel of bucket.files) {
    const summary = byRel.get(rel)?.summary ?? '';
    lines.push(`- [${rel}](../doc/${rel}) — ${summary === '' ? 'факты проекта' : summary}`);
    const text = byRel.get(rel)?.text.trimEnd() ?? '';
    if (text !== '') lines.push('', text, '');
  }
  if (edges.length > 0) {
    lines.push(`Глубже (кольцо ${bucket.weight + 1}):`, '');
    for (const edge of edges)
      lines.push(`- [${edge.key}](${edge.dir}/${START_INDEX}) — файлов ${edge.files.length}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
};

const goalsHeaders = async (root: string): Promise<string[]> => {
  let names: string[] = [];
  try {
    names = (await readdir(path.join(root, GOALS_DIR)))
      .filter((n) => n.endsWith('.expect.ts'))
      .sort();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  const lines: string[] = [];
  for (const name of names) {
    const text = await readFile(path.join(root, GOALS_DIR, name), 'utf8');
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        const callee = ts.isIdentifier(expression)
          ? expression.text
          : ts.isPropertyAccessExpression(expression)
            ? expression.name.text
            : undefined;
        const arg = node.arguments[0];
        const title =
          arg !== undefined && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))
            ? arg.text
            : undefined;
        if (title !== undefined && (callee === 'describe' || callee === 'it'))
          lines.push(`- ${title}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return lines;
};

const skillsCatalog = async (root: string): Promise<string[]> => {
  let raw: string;
  try {
    raw = await readFile(path.join(root, SKILLS_PATH), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  const data: unknown = parse(raw);
  const skills = isRecord(data) && Array.isArray(data['skills']) ? data['skills'] : [];
  const rows: { key: string; kind: string; roles: string[] }[] = [];
  for (const item of skills) {
    if (!isRecord(item)) continue;
    const key = item['key'];
    if (typeof key !== 'string') continue;
    const kind = typeof item['kind'] === 'string' ? item['kind'] : '';
    const roles = Array.isArray(item['roles'])
      ? item['roles'].filter((r): r is string => typeof r === 'string')
      : [];
    rows.push({ key, kind, roles });
  }
  return rows
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(
      (r) =>
        `- ${r.key} — ${r.kind === '' ? 'skill' : r.kind}, роли: ${r.roles.length === 0 ? '—' : r.roles.join(', ')}`,
    );
};

export const renderGraph = async (root: string, facts: FactFile[]): Promise<MemoryGraph> => {
  const grouped = new Map<string, Bucket>();
  const bucketOf = (key: string, namespace: string, weight: number): Bucket => {
    const existing = grouped.get(key);
    if (existing !== undefined) return existing;
    const fresh: Bucket = { namespace, weight, files: [] };
    grouped.set(key, fresh);
    return fresh;
  };
  for (const fact of facts) {
    if (fact.weight === 0) continue;
    if (fact.namespace.length === 0)
      bucketOf(nodeKeyOf('', fact.weight), '', fact.weight).files.push(fact.rel);
    else
      for (const ns of fact.namespace)
        bucketOf(nodeKeyOf(ns, fact.weight), ns, fact.weight).files.push(fact.rel);
  }
  for (const bucket of grouped.values()) bucket.files.sort();
  const buckets = [...grouped.values()].sort((a, b) =>
    a.weight === b.weight
      ? nodeKeyOf(a.namespace, a.weight).localeCompare(nodeKeyOf(b.namespace, b.weight))
      : a.weight - b.weight,
  );
  const done = new Map<string, GraphNode>();
  for (const bucket of [...buckets].sort((a, b) => b.weight - a.weight)) {
    const key = nodeKeyOf(bucket.namespace, bucket.weight);
    const edges = buckets
      .filter((b) => b.weight === bucket.weight + 1 && b.namespace === bucket.namespace)
      .flatMap((b) => {
        const node = done.get(nodeKeyOf(b.namespace, b.weight));
        return node === undefined ? [] : [node];
      });
    const body = nodeBody(bucket, facts, edges);
    const count = bucket.files.length;
    const frame = nodeFrame(key, bucket.weight, count, body);
    const sha = shaOf(frame);
    const head = `# Узел ${key}`;
    const meta = `Кольцо: ${bucket.weight}\nФайлов: ${count}`;
    done.set(key, {
      key,
      namespace: bucket.namespace,
      weight: bucket.weight,
      files: bucket.files,
      sha,
      dir: sha.slice(0, 12),
      text: `${head}\n\nSHA: ${sha}\n${meta}\n\n${body}`,
    });
  }
  const nodes = buckets.flatMap((b) => {
    const node = done.get(nodeKeyOf(b.namespace, b.weight));
    return node === undefined ? [] : [node];
  });
  const start: string[] = [
    '# Память проекта',
    '',
    'Стартовые факты инлайном; глубже — по вееру узлов.',
    '',
  ];
  const inline = facts.filter((f) => f.weight === 0).sort((a, b) => a.rel.localeCompare(b.rel));
  if (inline.length > 0) {
    const shown = inline.filter((f) => f.text.trim() !== '');
    if (shown.length > 0) {
      start.push('## Общее', '');
      for (const fact of shown) start.push(`## ${fact.rel}`, '', fact.text.trimEnd(), '');
    }
  }
  if (nodes.length > 0) {
    start.push('## Узлы', '');
    for (const node of nodes) start.push(`- [${node.key}](${node.dir}/${START_INDEX})`);
    start.push('');
  }
  const skills = await skillsCatalog(root);
  if (skills.length > 0) start.push('## Skills', '', ...skills, '');
  const goals = await goalsHeaders(root);
  if (goals.length > 0) start.push('## Цели', '', ...goals, '');
  return { start: `${start.join('\n').trimEnd()}\n`, nodes };
};

export interface GraphReport {
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
  graph: MemoryGraph | null;
}

const byteSize = (text: string): number => Buffer.byteLength(text, 'utf8');

export const graphDiagnostics = (graph: MemoryGraph, manifest: MemoryManifest): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  if (byteSize(graph.start) > manifest.budgets.start)
    diagnostics.push({
      file: `${BUNDLES_DIR}/${START_INDEX}`,
      message: `стартовый index ${byteSize(graph.start)} байт > cap ${manifest.budgets.start} — понизь веса в манифесте (избыток уедет в узлы) или формализуй в data-структуры`,
    });
  for (const node of graph.nodes)
    if (byteSize(node.text) > manifest.budgets.node)
      diagnostics.push({
        file: `${BUNDLES_DIR}/${node.dir}/${START_INDEX}`,
        message: `узел ${node.key} ${byteSize(node.text)} байт > cap ${manifest.budgets.node} — понизь вес или раздели namespace в манифесте`,
      });
  return diagnostics;
};

const listBundleDirs = async (root: string): Promise<string[]> => {
  let entries;
  try {
    entries = await readdir(path.join(root, BUNDLES_DIR), { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
};

export const renderMemoryGraph = async (
  root: string,
): Promise<{ report: GraphReport; manifest: MemoryManifest | null }> => {
  const { manifest, diagnostics } = await loadManifest(root);
  if (manifest === null)
    return { report: { diagnostics, warnings: [], graph: null }, manifest: null };
  const facts = await loadFacts(root, manifest, diagnostics);
  const graph = await renderGraph(root, facts);
  return {
    report: { diagnostics, warnings: [], graph },
    manifest,
  };
};

export const checkBundles = async (root: string): Promise<GraphReport> => {
  const { report, manifest } = await renderMemoryGraph(root);
  if (report.graph === null || manifest === null) return report;
  const stale: Diagnostic[] = [];
  let current: string | null = null;
  try {
    current = await readFile(path.join(root, BUNDLES_DIR, START_INDEX), 'utf8');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  if (current !== null && current !== report.graph.start)
    stale.push({
      file: `${BUNDLES_DIR}/${START_INDEX}`,
      message: 'стартовый index стух — запусти ai memory build',
    });
  const expected = new Map(report.graph.nodes.map((n) => [n.dir, n]));
  for (const dir of await listBundleDirs(root)) {
    const node = expected.get(dir);
    if (node === undefined) {
      stale.push({
        file: `${BUNDLES_DIR}/${dir}`,
        message: `стухший узел ${dir} — нет в актуальном графе, build удалит`,
      });
      continue;
    }
    let text: string | null = null;
    try {
      text = await readFile(path.join(root, BUNDLES_DIR, dir, START_INDEX), 'utf8');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
    if (text !== null && text !== node.text)
      stale.push({
        file: `${BUNDLES_DIR}/${dir}/${START_INDEX}`,
        message: `узел ${node.key} стух — запусти ai memory build`,
      });
  }
  return {
    diagnostics: [...report.diagnostics, ...stale, ...graphDiagnostics(report.graph, manifest)],
    warnings: report.warnings,
    graph: report.graph,
  };
};

export const buildBundles = async (root: string): Promise<GraphReport> => {
  const { report, manifest } = await renderMemoryGraph(root);
  if (report.graph === null || manifest === null) return report;
  return {
    ...report,
    diagnostics: [...report.diagnostics, ...graphDiagnostics(report.graph, manifest)],
  };
};

export const writeGraph = async (root: string, graph: MemoryGraph): Promise<number> => {
  const base = path.join(root, BUNDLES_DIR);
  await mkdir(base, { recursive: true });
  await writeFile(path.join(base, START_INDEX), graph.start, 'utf8');
  for (const node of graph.nodes) {
    await mkdir(path.join(base, node.dir), { recursive: true });
    await writeFile(path.join(base, node.dir, START_INDEX), node.text, 'utf8');
  }
  let removed = 0;
  const expected = new Set(graph.nodes.map((n) => n.dir));
  for (const dir of await listBundleDirs(root))
    if (!expected.has(dir)) {
      await rm(path.join(base, dir), { recursive: true, force: true });
      removed++;
    }
  return removed;
};

export const startIndexText = async (root: string): Promise<string | null> => {
  try {
    return await readFile(path.join(root, BUNDLES_DIR, START_INDEX), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
};

export const bundleNodes = async (root: string): Promise<string[]> => await listBundleDirs(root);
