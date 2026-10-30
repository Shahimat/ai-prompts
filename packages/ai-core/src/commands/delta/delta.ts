import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { UsageError, type Diagnostic } from '#shared/diagnostics';
import { errorCode, errorMessage, isOneOf, isRecord } from '#shared/guards';
import { CONTEXT_INDEX_PATH, DELTA_DIR } from '#shared/layout';
import { compileSchema } from '#shared/schema';

export const DELTA_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'context/.delta/<имя>.yml — дельта проектной документации',
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'items'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 200 },
    source: { type: 'string', minLength: 1 },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'kind', 'target', 'summary', 'evidence'],
        properties: {
          op: { enum: ['add', 'refine', 'revise'] },
          kind: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
          target: { type: 'string', minLength: 1 },
          summary: { type: 'string', minLength: 1, maxLength: 200 },
          evidence: { type: 'string', minLength: 1 },
          was: { type: 'string', minLength: 1 },
          why: { type: 'string', minLength: 1 },
        },
        if: { properties: { op: { const: 'revise' } } },
        then: { required: ['was', 'why'] },
      },
    },
  },
} as const;

export interface DeltaItem {
  op: 'add' | 'refine' | 'revise';
  kind: string;
  target: string;
  summary: string;
  evidence: string;
  was?: string;
  why?: string;
}

export interface Delta {
  file: string;
  summary: string;
  source?: string;
  items: DeltaItem[];
}

export interface Revision {
  file: string;
  deleted: boolean;
  lost: string[];
}

export interface DeltaResult {
  deltas: Delta[];
  revisions: Revision[];
  changed: Set<string>;
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
  accepted: Accepted[];
}

interface Broken {
  file: string;
  targets: string[];
}

const NOT_DOCS = [CONTEXT_INDEX_PATH, 'context/ai-core.yml', 'context/modules/', `${DELTA_DIR}/`];

function git(root: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout ?? '' };
}

async function docRoots(root: string): Promise<string[]> {
  const roots = new Set(['context', 'docs', 'CHANGELOG.md']);
  let manifests: string[] = [];
  try {
    manifests = (await readdir(path.join(root, 'context/modules'))).filter((f) =>
      f.endsWith('.yml'),
    );
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  for (const m of manifests) {
    let data: unknown;
    try {
      data = parse(await readFile(path.join(root, 'context/modules', m), 'utf8'));
    } catch {
      continue;
    }
    const layers =
      isRecord(data) && isRecord(data['provides']) ? data['provides']['layers'] : undefined;
    if (Array.isArray(layers))
      for (const l of layers)
        if (typeof l === 'string' && l !== '') roots.add(l.replace(/\/+$/, ''));
  }
  return [...roots].sort();
}

const isDoc = (file: string): boolean =>
  !NOT_DOCS.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));

function lostYaml(before: unknown, after: unknown, at: string, out: string[]): void {
  if (isRecord(before) && isRecord(after)) {
    for (const [k, v] of Object.entries(before)) {
      const key = at === '' ? k : `${at}.${k}`;
      if (!(k in after)) out.push(key);
      else lostYaml(v, after[k], key, out);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const rest = after.map((v) => JSON.stringify(v));
    for (const v of before)
      if (!rest.includes(JSON.stringify(v))) out.push(`${at}[] ${JSON.stringify(v)}`);
    return;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) out.push(at === '' ? '<корень>' : at);
}

function lostLines(before: string, after: string): string[] {
  const rest = new Map<string, number>();
  for (const line of after.split('\n')) rest.set(line.trim(), (rest.get(line.trim()) ?? 0) + 1);
  const out: string[] = [];
  for (const line of before.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    const n = rest.get(t) ?? 0;
    if (n > 0) rest.set(t, n - 1);
    else out.push(t);
  }
  return out;
}

function lostIn(file: string, before: string, after: string): string[] {
  if (/\.ya?ml$/.test(file)) {
    try {
      const out: string[] = [];
      lostYaml(parse(before), parse(after), '', out);
      return out;
    } catch {}
  }
  return lostLines(before, after);
}

const isText = (v: unknown): boolean => v === undefined || typeof v === 'string';

function isDeltaItem(v: unknown): v is DeltaItem {
  return (
    isRecord(v) &&
    isOneOf(['add', 'refine', 'revise'], v['op']) &&
    typeof v['kind'] === 'string' &&
    typeof v['target'] === 'string' &&
    typeof v['summary'] === 'string' &&
    typeof v['evidence'] === 'string' &&
    isText(v['was']) &&
    isText(v['why'])
  );
}

function isDeltaBody(v: unknown): v is Omit<Delta, 'file'> {
  return (
    isRecord(v) &&
    typeof v['summary'] === 'string' &&
    isText(v['source']) &&
    Array.isArray(v['items']) &&
    v['items'].every(isDeltaItem)
  );
}

function targetsOf(data: unknown): string[] {
  const items = isRecord(data) ? data['items'] : undefined;
  if (!Array.isArray(items)) return [];
  return items.flatMap((i: unknown) =>
    isRecord(i) && typeof i['target'] === 'string' ? [i['target']] : [],
  );
}

async function readDeltas(
  root: string,
  diagnostics: Diagnostic[],
  broken: Broken[],
): Promise<Delta[]> {
  let names: string[] = [];
  try {
    names = (await readdir(path.join(root, DELTA_DIR))).filter((f) => /\.ya?ml$/.test(f)).sort();
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  const validate = compileSchema(DELTA_SCHEMA);
  const deltas: Delta[] = [];
  for (const name of names) {
    const file = `${DELTA_DIR}/${name}`;
    let data: unknown;
    try {
      data = parse(await readFile(path.join(root, file), 'utf8'));
    } catch (error) {
      diagnostics.push({
        file,
        message: `невалидный YAML: ${errorMessage(error).split('\n')[0]}`,
      });
      continue;
    }
    const issues = validate(data);
    if (issues.length > 0) {
      for (const i of issues)
        diagnostics.push({ file, message: `${i.path || '/'} ${i.message}`.trim() });
      broken.push({ file, targets: targetsOf(data) });
      continue;
    }
    if (!isDeltaBody(data)) throw new Error(`${file}: схема дельты пропустила неверную форму`);
    deltas.push({ file, ...data });
  }
  return deltas;
}

export const ACCEPTED_FILE = `${DELTA_DIR}/.accepted.json`;

export function matchesTarget(target: string, file: string): boolean {
  const base = target.split('#')[0] ?? target;
  return base === file || path.posix.basename(file).replace(/\.[^.]+$/, '') === base;
}

const isDeltaTarget = (target: string): boolean =>
  (target.split('#')[0] ?? target).startsWith(`${DELTA_DIR}/`);

export interface Accepted {
  delta: string;
  target: string;
  summary: string;
  was: string;
  why: string;
}

const isAccepted = (v: unknown): v is Accepted =>
  isRecord(v) &&
  ['delta', 'target', 'summary', 'was', 'why'].every((k) => typeof v[k] === 'string');

export async function readAccepted(root: string): Promise<Accepted[]> {
  let text: string;
  try {
    text = await readFile(path.join(root, ACCEPTED_FILE), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const items = isRecord(data) ? data['items'] : undefined;
  return Array.isArray(items) ? items.filter(isAccepted) : [];
}

export const acceptedOf = (deltas: readonly Delta[]): Accepted[] =>
  deltas.flatMap((d) =>
    d.items
      .filter((i) => i.op === 'revise')
      .map((i) => ({
        delta: d.file,
        target: i.target,
        summary: i.summary,
        was: i.was ?? '',
        why: i.why ?? '',
      })),
  );

export async function checkDelta(root: string): Promise<DeltaResult> {
  if (!git(root, ['rev-parse', '--verify', 'HEAD']).ok)
    throw new UsageError('delta: нужен git-репозиторий с коммитом HEAD');
  const diagnostics: Diagnostic[] = [];
  const broken: Broken[] = [];
  const deltas = await readDeltas(root, diagnostics, broken);
  const roots = await docRoots(root);
  const status = git(root, ['diff', '--name-status', '--no-renames', 'HEAD', '--', ...roots]).out;
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '--', ...roots]).out;

  const revisions: Revision[] = [];
  const changed = new Set<string>(untracked.split('\n').filter((f) => f !== '' && isDoc(f)));
  for (const line of status.split('\n')) {
    const [code, file] = line.split('\t');
    if (code === undefined || file === undefined || !isDoc(file)) continue;
    changed.add(file);
    const before = git(root, ['show', `HEAD:${file}`]).out;
    if (code === 'D') {
      revisions.push({ file, deleted: true, lost: [] });
      continue;
    }
    if (code !== 'M') continue;
    const lost = lostIn(file, before, await readFile(path.join(root, file), 'utf8'));
    if (lost.length > 0) revisions.push({ file, deleted: false, lost: lost.slice(0, 3) });
  }

  const accepted = await readAccepted(root);
  const revise = [
    ...deltas.flatMap((d) => d.items.filter((i) => i.op === 'revise')).map((i) => i.target),
    ...accepted.map((a) => a.target),
  ];
  const hidden = new Map<string, number>();
  for (const r of revisions) {
    if (revise.some((t) => matchesTarget(t, r.file))) continue;
    const cause = broken.find((b) => b.targets.some((t) => matchesTarget(t, r.file)));
    if (cause !== undefined) {
      hidden.set(cause.file, (hidden.get(cause.file) ?? 0) + 1);
      continue;
    }
    diagnostics.push({
      file: r.file,
      message: r.deleted
        ? 'удалено существующее знание без пункта revise в дельте'
        : `изменено существующее знание без пункта revise в дельте: ${r.lost.join('; ')}`,
    });
  }
  for (const [file, n] of hidden)
    diagnostics.push({
      file,
      message: `дельта не прошла схему — нарушения «без revise» по её целям (${n}) скрыты как следствие; исправь схему`,
    });
  const warnings = committedDeltas(root).map((file) => ({
    file,
    message: `дельта попала в коммит — закрой её: ai delta close --name ${deltaName(file)}; пункты, выполненные в коммитах после её появления, засчитываются`,
  }));
  return { deltas, revisions, changed, diagnostics, warnings, accepted };
}

const deltaName = (file: string): string => path.posix.basename(file).replace(/\.ya?ml$/, '');

function committedDeltas(root: string): string[] {
  return git(root, ['ls-files', '--', DELTA_DIR])
    .out.split('\n')
    .filter((f) => /\.ya?ml$/.test(f));
}

function committedSince(root: string, file: string): string[] {
  const added = git(root, ['log', '--diff-filter=A', '--format=%H', '-1', '--', file]).out.trim();
  if (added === '') return [];
  const range = git(root, ['rev-parse', '--verify', '-q', `${added}^`]).ok
    ? `${added}^..HEAD`
    : 'HEAD';
  return git(root, ['log', '--format=', '--name-only', '--no-renames', range])
    .out.split('\n')
    .filter((f) => f !== '' && isDoc(f));
}

export function unfinishedItems(
  root: string,
  result: DeltaResult,
  deltas: readonly Delta[] = result.deltas,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const d of deltas) {
    const committed = committedSince(root, d.file);
    const touched = [...result.changed, ...result.revisions.map((r) => r.file), ...committed];
    d.items.forEach((item, i) => {
      const done =
        isDeltaTarget(item.target) ||
        (item.op === 'add'
          ? existsSync(path.join(root, item.target.split('#')[0] ?? item.target)) ||
            touched.some((f) => matchesTarget(item.target, f))
          : touched.some((f) => matchesTarget(item.target, f)));
      if (!done)
        out.push({
          file: d.file,
          message: `пункт ${i + 1} (${item.op} ${item.target}) не выполнен`,
        });
    });
  }
  return out;
}

export function revisionLines(deltas: Delta[]): string[] {
  return deltas.flatMap((d) =>
    d.items
      .filter((i) => i.op === 'revise')
      .map(
        (i) => `revise ${i.target}: было «${i.was ?? ''}» → ${i.summary}; почему: ${i.why ?? ''}`,
      ),
  );
}
