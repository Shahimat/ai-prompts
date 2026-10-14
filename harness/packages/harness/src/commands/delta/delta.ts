import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { UsageError, type Diagnostic } from '../../shared/diagnostics.ts';
import { errorCode, errorMessage, isOneOf, isRecord } from '../../shared/guards.ts';
import { CONTEXT_INDEX_PATH, DELTA_DIR } from '../../shared/layout.ts';
import { compileSchema } from '../../shared/schema.ts';

/** Каталог дельт: временные ожидания к документации, не часть её контекста. */

/**
 * Формат дельты. Копия `expectations/schemas/docs-delta.schema.json`
 * источника; совпадение проверяют ожидания репозитория.
 */
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
        // Ключ `then` — условие JSON Schema, а не thenable-объект.
        // oxlint-disable-next-line unicorn/no-thenable
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

/** Изменение существующего знания относительно HEAD. */
export interface Revision {
  file: string;
  deleted: boolean;
  /** Что ушло или изменилось: ключи YAML или строки текста, не больше трёх. */
  lost: string[];
}

export interface DeltaResult {
  deltas: Delta[];
  revisions: Revision[];
  /** Файлы документации, изменённые или добавленные относительно HEAD. */
  changed: Set<string>;
  diagnostics: Diagnostic[];
}

/** Не документация: генерируемое, конфиг harness, manifest модулей и сами дельты. */
const NOT_DOCS = [CONTEXT_INDEX_PATH, 'context/harness.yml', 'context/modules/', `${DELTA_DIR}/`];

function git(root: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout ?? '' };
}

/** Корни слоёв документации: ядро и `provides.layers` подключённых модулей. */
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

/** Ключи и значения YAML, которых нет в новой версии: удалённые или изменённые. */
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

/** Непустые строки старого текста, которых не хватает в новом (с учётом повторов). */
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
    } catch {
      // невалидный YAML — сравниваем как текст
    }
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

/** Сужение после проверки схемой: схема — правда о форме, guard — о типе. */
function isDeltaBody(v: unknown): v is Omit<Delta, 'file'> {
  return (
    isRecord(v) &&
    typeof v['summary'] === 'string' &&
    isText(v['source']) &&
    Array.isArray(v['items']) &&
    v['items'].every(isDeltaItem)
  );
}

async function readDeltas(root: string, diagnostics: Diagnostic[]): Promise<Delta[]> {
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
      continue;
    }
    if (!isDeltaBody(data)) throw new Error(`${file}: схема дельты пропустила неверную форму`);
    deltas.push({ file, ...data });
  }
  return deltas;
}

/** Цель пункта: путь от корня или id — имя файла без расширения. */
export const matchesTarget = (target: string, file: string): boolean =>
  target === file || path.posix.basename(file).replace(/\.[^.]+$/, '') === target;

/**
 * Сверка слоёв документации с HEAD: каждое удаление или изменение
 * существующего знания должно быть объявлено пунктом `revise` дельты.
 * Добавления не требуют пункта.
 */
export async function checkDelta(root: string): Promise<DeltaResult> {
  if (!git(root, ['rev-parse', '--verify', 'HEAD']).ok)
    throw new UsageError('delta: нужен git-репозиторий с коммитом HEAD');
  const diagnostics: Diagnostic[] = [];
  const deltas = await readDeltas(root, diagnostics);
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

  const revise = deltas.flatMap((d) => d.items.filter((i) => i.op === 'revise'));
  for (const r of revisions) {
    if (revise.some((i) => matchesTarget(i.target, r.file))) continue;
    diagnostics.push({
      file: r.file,
      message: r.deleted
        ? 'удалено существующее знание без пункта revise в дельте'
        : `изменено существующее знание без пункта revise в дельте: ${r.lost.join('; ')}`,
    });
  }
  return { deltas, revisions, changed, diagnostics };
}

/** Невыполненные пункты дельты: приёмка перед удалением. */
export function unfinishedItems(root: string, result: DeltaResult): Diagnostic[] {
  const out: Diagnostic[] = [];
  const touched = [...result.changed, ...result.revisions.map((r) => r.file)];
  for (const d of result.deltas) {
    d.items.forEach((item, i) => {
      const done =
        item.op === 'add'
          ? existsSync(path.join(root, item.target)) ||
            touched.some((f) => matchesTarget(item.target, f))
          : touched.some((f) => matchesTarget(item.target, f));
      if (!done)
        out.push({
          file: d.file,
          message: `пункт ${i + 1} (${item.op} ${item.target}) не выполнен`,
        });
    });
  }
  return out;
}

/** Строки пересмотров для отчёта и тела сообщения коммита. */
export function revisionLines(deltas: Delta[]): string[] {
  return deltas.flatMap((d) =>
    d.items
      .filter((i) => i.op === 'revise')
      .map(
        (i) => `revise ${i.target}: было «${i.was ?? ''}» → ${i.summary}; почему: ${i.why ?? ''}`,
      ),
  );
}
