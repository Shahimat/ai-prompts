import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { refreshPending } from '#lib/knowledge';
import path from 'node:path';
import * as ts from 'typescript';
import { parse } from 'yaml';
import type { Diagnostic } from '#shared/diagnostics';
import { errorCode, isRecord } from '#shared/guards';
import {
  AUTONOMY_PATH,
  BUNDLES_DIR,
  CONVENTIONS_DIR,
  GLOSSARY_DIR,
  GOALS_DIR,
  KNOWLEDGE_DIR,
  MANUALS_DIR,
  OC3_DIR,
  PROJECT_PATH,
  SCHEMAS_DIR,
  SKILLS_PATH,
} from '#shared/layout';
import { checkMemory, loadManifest, type MemoryManifest } from '#lib/memory';
import {
  boundedPages,
  inlineProse,
  markdownLabel,
  projectionFiles,
  proseUnits,
} from '#lib/memory-projection';
import { confinedProjectPath } from '#lib/artifacts';
import { acquireLease } from '#lib/local-store';

export const START_INDEX = 'index.md';
const GENERAL_NS = 'common';
const DATA_BASE = 'data';
const MEMORY_NS_DIRS = [CONVENTIONS_DIR, MANUALS_DIR, GLOSSARY_DIR, KNOWLEDGE_DIR].map((p) =>
  p.slice(OC3_DIR.length + 1),
);
const MEMORY_ROOT_FILES = [PROJECT_PATH, AUTONOMY_PATH].map((p) => p.slice(OC3_DIR.length + 1));

export interface FactFile {
  rel: string;
  namespace: string[];
  weight: number;
  text: string;
  summary: string;
  value: unknown;
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
  files: Map<string, string>;
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const shaOf = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const walkNamespaces = async (root: string, base: string): Promise<string[]> => {
  const out: string[] = [];
  const absBase = path.join(root, OC3_DIR, base);
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    for (const e of entries) {
      const parent = dir === absBase ? '' : dir.slice(absBase.length + 1);
      const rel = path.posix.join(base, ...parent.split(path.sep), e.name);
      if (e.isDirectory()) {
        if (e.name === '__schemas') continue;
        await walk(path.join(dir, e.name));
        continue;
      }
      if (e.name.endsWith('.yml') || e.name.endsWith('.md')) out.push(rel);
    }
  };
  await walk(absBase);
  return out;
};

const walkDoc = async (root: string, manifest: MemoryManifest): Promise<string[]> => {
  const dirs = [...MEMORY_NS_DIRS, ...manifest.data.map((n) => `${DATA_BASE}/${n}`)];
  const all = new Set<string>();
  for (const rel of MEMORY_ROOT_FILES) {
    try {
      const st = await stat(path.join(root, OC3_DIR, rel));
      if (st.isFile()) all.add(rel);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
  }
  for (const dir of dirs) for (const rel of await walkNamespaces(root, dir)) all.add(rel);
  return [...all].sort();
};

const factSummary = (value: unknown): string => {
  if (Array.isArray(value)) return `${value.length} записей, первая: ${factSummary(value[0])}`;
  if (!isRecord(value)) return typeof value === 'string' ? collapse(value) : '';
  return ['key', 'term', 'id', 'namespace', 'summary', 'title', 'definition']
    .flatMap((key) => (typeof value[key] === 'string' ? [collapse(value[key])] : []))
    .join(' — ');
};

const mdSummary = (text: string): string => {
  const heading = text.split('\n').find((l) => l.startsWith('#'));
  if (heading !== undefined) return collapse(heading.replace(/^#+\s*/, ''));
  const paragraph = text.split('\n\n').find((p) => collapse(p) !== '');
  return paragraph === undefined ? '' : collapse(paragraph).slice(0, 120);
};

const factText = (value: unknown, rel: string, weight: number, cap: number): string => {
  try {
    return weight === 0 ? inlineProse(value) : proseUnits(value, cap - 512).join('');
  } catch (error) {
    throw new Error(
      `${OC3_DIR}/${rel}: cap ${cap}: ${error instanceof Error ? error.message : 'ошибка проекции'}`,
    );
  }
};

const loadFacts = async (
  root: string,
  manifest: MemoryManifest,
  diagnostics: Diagnostic[],
): Promise<FactFile[]> => {
  const facts: FactFile[] = [];
  for (const rel of await walkDoc(root, manifest)) {
    const entry = manifest.files[rel];
    const namespace = entry?.namespace ?? [];
    const weight = entry?.weight ?? 0;
    const raw = await readFile(path.join(root, OC3_DIR, rel), 'utf8');
    if (rel.endsWith('.md')) {
      const kind = rel.split('/')[0] ?? '';
      const label = kind === 'manuals' ? 'инструкция: ' : kind === 'knowledge' ? 'карта: ' : '';
      facts.push({
        rel,
        namespace,
        weight,
        text: factText(raw, rel, weight, manifest.budgets.node),
        value: raw,
        summary: `${label}${mdSummary(raw)}`,
      });
      continue;
    }
    let data: unknown;
    try {
      data = parse(raw);
    } catch (error) {
      diagnostics.push({
        file: `${OC3_DIR}/${rel}`,
        message: `невалидный YAML: ${error instanceof Error ? error.message.split('\n')[0] : ''}`,
      });
      continue;
    }
    facts.push({
      rel,
      namespace,
      weight,
      text: factText(data, rel, weight, manifest.budgets.node),
      value: data,
      summary: factSummary(data),
    });
  }
  return facts;
};

const nodeKeyOf = (namespace: string, weight: number): string =>
  `${namespace === '' ? GENERAL_NS : namespace}:${weight}`;

const capSummary = (text: string, cap: number): string => {
  if (Buffer.byteLength(text, 'utf8') <= cap) return text;
  if (cap < 3) return '.'.repeat(cap);
  let out = '';
  for (const ch of text) {
    const next = `${out}${ch}`;
    if (Buffer.byteLength(`${next}…`, 'utf8') > cap) break;
    out = next;
  }
  return `${out}…`;
};

interface Bucket {
  namespace: string;
  weight: number;
  files: string[];
}

const nodeBody = (bucket: Bucket, facts: FactFile[], edges: GraphNode[], cap: number): string[] => {
  const byRel = new Map(facts.map((f) => [f.rel, f]));
  const lines: string[] = ['Файлы узла:\n\n'];
  for (const rel of bucket.files) {
    const summary = byRel.get(rel)?.summary ?? '';
    const note = capSummary(markdownLabel(summary === '' ? 'факты проекта' : summary), cap);
    lines.push(`- [${markdownLabel(rel)}](../files/${shaOf(rel)}/index.md) — ${note}\n`);
  }
  if (edges.length > 0) {
    lines.push(`\nГлубже (кольцо ${bucket.weight + 1}):\n\n`);
    for (const edge of edges)
      lines.push(
        `- [${markdownLabel(edge.key)}](../${edge.dir}/${START_INDEX}) — файлов ${edge.files.length}\n`,
      );
  }
  return lines;
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

export const renderGraph = async (
  root: string,
  facts: FactFile[],
  summaryCap: number,
  nodeCap = 16384,
): Promise<MemoryGraph> => {
  const files = new Map<string, string>();
  for (const fact of facts.filter((f) => f.weight > 0)) {
    try {
      for (const [name, text] of projectionFiles(fact.value, fact.rel, nodeCap))
        files.set(`files/${shaOf(fact.rel)}/${name}`, text);
    } catch (error) {
      throw new Error(
        `${OC3_DIR}/${fact.rel}: cap ${nodeCap}: ${error instanceof Error ? error.message : 'ошибка проекции'}`,
      );
    }
  }
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
    const body = nodeBody(bucket, facts, edges, summaryCap);
    const count = bucket.files.length;
    const sha = shaOf(
      JSON.stringify([
        key,
        body,
        bucket.files.map((rel) => facts.find((f) => f.rel === rel)?.text),
      ]),
    );
    const head = `# Узел ${markdownLabel(key)}`;
    const meta = `Кольцо: ${bucket.weight}\nФайлов: ${count}`;
    const pages = boundedPages(body, `${head}\n\nSHA: ${sha}\n${meta}\n\n`, nodeCap, 'page');
    const text = pages.get(START_INDEX);
    if (text === undefined) throw new Error('нет стартовой страницы узла');
    for (const [name, page] of pages) files.set(`${sha.slice(0, 12)}/${name}`, page);
    done.set(key, {
      key,
      namespace: bucket.namespace,
      weight: bucket.weight,
      files: bucket.files,
      sha,
      dir: sha.slice(0, 12),
      text,
    });
  }
  const nodes = buckets.flatMap((b) => {
    const node = done.get(nodeKeyOf(b.namespace, b.weight));
    return node === undefined ? [] : [node];
  });
  const start: string[] = [
    '# Память проекта',
    '',
    'Кольцо 0 — инлайн; глубже — по ссылкам.',
    'Pending (не канон, кольцо 1): [pending](pending/index.md).',
    '',
  ];
  const inline = facts.filter((f) => f.weight === 0).sort((a, b) => a.rel.localeCompare(b.rel));
  if (inline.length > 0) {
    const shown = inline.filter((f) => f.text.trim() !== '');
    if (shown.length > 0) {
      start.push('## Общее', '');
      for (const fact of shown) start.push(`## ${markdownLabel(fact.rel)}`, '', fact.text, '');
    }
  }
  if (nodes.length > 0) {
    start.push('## Узлы', '');
    for (const node of nodes)
      start.push(`- [${markdownLabel(node.key)}](${node.dir}/${START_INDEX})`);
    start.push('');
  }
  const skills = await skillsCatalog(root);
  if (skills.length > 0) start.push('## Skills', '', ...skills, '');
  const goals = await goalsHeaders(root);
  if (goals.length > 0) start.push('## Цели', '', ...goals, '');
  const text = `${start.join('\n').trimEnd()}\n`;
  files.set(START_INDEX, text);
  return { start: text, nodes, files };
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
      message: `стартовый index ${byteSize(graph.start)} байт > cap ${manifest.budgets.start} — проверь явный состав кольца 0 и стартовых каталогов; сборка не записана`,
    });
  for (const [name, text] of graph.files)
    if (name !== START_INDEX && byteSize(text) > manifest.budgets.node)
      diagnostics.push({
        file: `${BUNDLES_DIR}/${name}`,
        message: `страница ${byteSize(text)} байт > cap ${manifest.budgets.node}`,
      });
  return diagnostics;
};

export const renderMemoryGraph = async (
  root: string,
): Promise<{ report: GraphReport; manifest: MemoryManifest | null }> => {
  const { manifest, diagnostics } = await loadManifest(root);
  if (manifest === null)
    return { report: { diagnostics, warnings: [], graph: null }, manifest: null };
  try {
    const validation = await checkMemory(root);
    if (validation.diagnostics.length > 0)
      return { report: { ...validation, graph: null }, manifest };
    const facts = await loadFacts(root, manifest, diagnostics);
    const graph = await renderGraph(root, facts, manifest.budgets.summary, manifest.budgets.node);
    const schemas: string[] = [];
    for (const name of (await readdir(path.join(root, SCHEMAS_DIR)))
      .filter((n) => n.endsWith('.json'))
      .sort())
      schemas.push(name, await readFile(path.join(root, SCHEMAS_DIR, name), 'utf8'));
    const digest = shaOf(
      JSON.stringify(['memory-prose-v1', manifest, schemas, facts.map((f) => [f.rel, f.text])]),
    );
    graph.start += `\nВерсия источников: ${digest}.\n`;
    graph.files.set(START_INDEX, graph.start);
    return { report: { diagnostics, warnings: validation.warnings, graph }, manifest };
  } catch (error) {
    return {
      report: {
        diagnostics: [
          ...diagnostics,
          {
            file: BUNDLES_DIR,
            message: error instanceof Error ? error.message : 'ошибка построения памяти',
          },
        ],
        warnings: [],
        graph: null,
      },
      manifest,
    };
  }
};

const installedFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    const abs = confinedProjectPath(root, rel === '' ? BUNDLES_DIR : `${BUNDLES_DIR}/${rel}`);
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (rel === '' && entry.name === 'pending') continue;
      const name = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) {
        await walk(name);
        if ((await readdir(path.join(abs, entry.name))).length === 0) files.push(name);
      } else files.push(name);
    }
  };
  await walk('');
  return files.sort();
};

export const checkBundles = async (root: string): Promise<GraphReport> => {
  const { report, manifest } = await renderMemoryGraph(root);
  if (report.graph === null || manifest === null) return report;
  const stale: Diagnostic[] = [];
  for (const [name, expected] of report.graph.files) {
    const abs = confinedProjectPath(root, `${BUNDLES_DIR}/${name}`);
    let current: string | null = null;
    try {
      if ((await lstat(abs)).isFile()) current = await readFile(abs, 'utf8');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
    if (current !== expected)
      stale.push({
        file: `${BUNDLES_DIR}/${name}`,
        message: 'файл памяти отсутствует или стух — запусти ai memory build',
      });
  }
  for (const name of await installedFiles(root))
    if (!report.graph.files.has(name))
      stale.push({ file: `${BUNDLES_DIR}/${name}`, message: 'стухший файл памяти — build удалит' });
  try {
    const pending = confinedProjectPath(root, `${BUNDLES_DIR}/pending/index.md`);
    if (!(await lstat(pending)).isFile())
      stale.push({
        file: `${BUNDLES_DIR}/pending/index.md`,
        message: 'нет pending-проекции — запусти ai memory build',
      });
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    stale.push({
      file: `${BUNDLES_DIR}/pending/index.md`,
      message: 'нет pending-проекции — запусти ai memory build',
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

const publishGraph = async (root: string, graph: MemoryGraph): Promise<number> => {
  const base = confinedProjectPath(root, BUNDLES_DIR);
  await mkdir(base, { recursive: true });
  for (const [name, text] of graph.files) {
    if (name === START_INDEX) continue;
    const file = confinedProjectPath(root, `${BUNDLES_DIR}/${name}`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text, 'utf8');
  }
  await refreshPending(root);
  await writeFile(confinedProjectPath(root, `${BUNDLES_DIR}/${START_INDEX}`), graph.start, 'utf8');
  let removed = 0;
  for (const name of await installedFiles(root))
    if (!graph.files.has(name)) {
      await rm(path.join(base, name), { recursive: true, force: true });
      removed++;
    }
  const prune = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true }))
      if (entry.isDirectory() && entry.name !== 'pending') {
        const child = path.join(dir, entry.name);
        await prune(child);
        if ((await readdir(child)).length === 0) await rm(child, { recursive: true });
      }
  };
  await prune(base);
  return removed;
};

export const writeGraph = async (root: string, graph: MemoryGraph): Promise<number> => {
  const lease = await acquireLease(root, 'memory-build', 'memory');
  try {
    return await publishGraph(root, graph);
  } finally {
    await lease.release();
  }
};

const ensuring = new Map<string, Promise<GraphReport>>();

export const ensureMemory = async (root: string): Promise<GraphReport> => {
  const key = path.resolve(root);
  const existing = ensuring.get(key);
  if (existing !== undefined) return existing;
  const run = async (): Promise<GraphReport> => {
    const build = await buildBundles(root);
    if (build.graph === null || build.diagnostics.length > 0) return build;
    const check = await checkBundles(root);
    if (check.diagnostics.length > 0) await writeGraph(root, build.graph);
    return checkBundles(root);
  };
  const pending = run();
  ensuring.set(key, pending);
  try {
    return await pending;
  } finally {
    ensuring.delete(key);
  }
};

export const startIndexText = async (root: string): Promise<string | null> => {
  try {
    return await readFile(path.join(root, BUNDLES_DIR, START_INDEX), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
};

export const bundleNodes = async (root: string): Promise<string[]> => {
  const report = await ensureMemory(root);
  if (report.diagnostics.length > 0 || report.graph === null)
    throw new Error(report.diagnostics.map((d) => `${d.file}: ${d.message}`).join('; '));
  return report.graph.nodes.map((n) => n.dir);
};
