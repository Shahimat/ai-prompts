import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CommandArgs } from '#shared/args';
import type { Diagnostic } from '#shared/diagnostics';
import { UsageError } from '#shared/diagnostics';
import { errorCode, isRecord } from '#shared/guards';
import {
  AI_CORE_PATH,
  AUTONOMY_PATH,
  NOTES_PATH,
  OC3_DIR,
  OC3_MANIFEST,
  OPS_PATH,
  PROJECT_PATH,
  SKILLS_PATH,
} from '#shared/layout';
import { report, warn } from '#shared/report';
import { compileSchema, issueText } from '#shared/schema';

const ROOT_FILES: readonly string[] = [
  PROJECT_PATH,
  AUTONOMY_PATH,
  SKILLS_PATH,
  AI_CORE_PATH,
  OC3_MANIFEST,
  OPS_PATH,
  NOTES_PATH,
].map((p) => p.slice(OC3_DIR.length + 1));

const WORK_DIRS = [
  'sessions',
  'operator',
  'locks',
  'feedback',
  'reports',
  'research',
  'verdicts',
  'submit',
  'baseline',
  'watches',
  'jobs',
] as const;

const NS_DIRS = ['conventions', 'manuals', 'data', 'goals', 'bundles', 'modules'] as const;

const CORE_EXPECT: Record<string, string> = {
  'project.yml': 'файл корня .oc3/ — параметры проекта',
  'autonomy.yml': 'файл корня .oc3/ — политика действий наружу',
  'skills.yml': 'файл корня .oc3/ — каталог skills',
  'ai-core.yml': 'файл корня .oc3/ — конфиг harness',
  'manifest.json': 'файл корня .oc3/ — манифест памяти',
  'ops.yml': 'файл корня .oc3/ — конфиг ops',
  'NOTES.md': 'файл корня .oc3/ — заметки оператора',
  conventions: 'плоские правила: conventions/<key>.yml',
  manuals: 'плоские инструкции: manuals/<key>.md',
  data: 'data/<entities|behavior|__schemas|имя из манифеста>/',
  goals: 'цели и программы: файлы <goal>.expect.ts|json прямо в goals/',
  bundles: 'сгенерированная память: bundles/index.md и bundles/<sha12>/index.md',
  modules: 'манифесты модулей: modules/<key>.yml',
};

for (const dir of WORK_DIRS) CORE_EXPECT[dir] = `рабочие файлы — любое вложение внутри ${dir}/`;

const coreSchema = (): object[] => [
  { enum: [...ROOT_FILES] },
  { pattern: '^conventions/[^/]+\\.yml$' },
  { pattern: '^manuals/[^/]+\\.md$' },
  { pattern: '^data/entities/[^/]+\\.yml$' },
  { pattern: '^data/behavior/[^/]+\\.yml$' },
  { pattern: '^data/__schemas/[^/]+\\.schema\\.json$' },
  { pattern: '^goals/[^/]+$' },
  { pattern: '^bundles/(index\\.md|[0-9a-f]{12}/index\\.md)$' },
  { pattern: '^modules/[^/]+\\.yml$' },
  { pattern: `^(${WORK_DIRS.join('|')})/.+` },
  { pattern: '^\\.delta/.+' },
];

export interface TreeManifest {
  data: string[];
  files: string[];
  layout: unknown;
  ok: boolean;
}

const EMPTY_MANIFEST: TreeManifest = { data: [], files: [], layout: undefined, ok: false };

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];

const readTreeManifest = async (root: string, warnings: Diagnostic[]): Promise<TreeManifest> => {
  let text: string;
  try {
    text = await readFile(path.join(root, OC3_MANIFEST), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      warnings.push({
        file: OC3_MANIFEST,
        message: 'нет манифеста — проектные расширения (data / files / layout) не учтены',
      });
      return EMPTY_MANIFEST;
    }
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    warnings.push({ file: OC3_MANIFEST, message: 'невалидный JSON — дерево проверено по ядру' });
    return EMPTY_MANIFEST;
  }
  if (!isRecord(data)) {
    warnings.push({
      file: OC3_MANIFEST,
      message: 'корень манифеста должен быть объектом — дерево проверено по ядру',
    });
    return EMPTY_MANIFEST;
  }
  const files = isRecord(data['files']) ? Object.keys(data['files']) : [];
  return {
    data: stringList(data['data']),
    files: files.filter((f) => f !== ''),
    layout: data['layout'],
    ok: true,
  };
};

export const buildTreeSchema = (manifest: TreeManifest, warnings: Diagnostic[] = []): object => {
  const oneOf: object[] = coreSchema();
  const extraData = manifest.data.filter((n) => n !== 'entities' && n !== 'behavior');
  if (extraData.length > 0) oneOf.push({ pattern: `^data/(${extraData.join('|')})/[^/]+\\.yml$` });
  if (manifest.files.length > 0) oneOf.push({ enum: manifest.files });
  mergeLayout(oneOf, manifest.layout, warnings);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: '.oc3/ — плоское дерево контракта: имена корня и namespace',
    type: 'array',
    items: { $ref: '#/$defs/entry' },
    $defs: {
      entry: {
        type: 'string',
        pattern: '^[^/]+(/[^/]+)*$',
        anyOf: oneOf,
      },
    },
  };
};

const mergeLayout = (oneOf: object[], layout: unknown, warnings: Diagnostic[]): void => {
  if (layout === undefined || layout === null) return;
  if (isRecord(layout) && Array.isArray(layout['oneOf'])) {
    for (const item of layout['oneOf'])
      if (isRecord(item)) oneOf.push(item);
      else warnings.push({ file: OC3_MANIFEST, message: 'layout.oneOf должен быть списком схем' });
    return;
  }
  if (isRecord(layout)) {
    oneOf.push(layout);
    return;
  }
  warnings.push({
    file: OC3_MANIFEST,
    message: 'layout должен быть JSON Schema фрагментом (объект) — расширь схему дерева',
  });
};
const topLevelSummary = (): string =>
  [...ROOT_FILES, ...NS_DIRS.map((d) => `${d}/`), ...WORK_DIRS.map((d) => `${d}/`), '.delta/'].join(
    ', ',
  );

export const mandateOf = (rel: string, manifest: TreeManifest): string => {
  const seg = rel.split('/')[0] ?? rel;
  if (seg === rel) return `${seg} — имя корня .oc3/ вне списка: ${topLevelSummary()}`;
  if (CORE_EXPECT[seg] !== undefined) {
    const next = rel.slice(seg.length + 1).split('/')[0] ?? '';
    return `${seg}/ — ${CORE_EXPECT[seg]}; имя «${next}» на этом уровне не входит в схему`;
  }
  if (manifest.files.some((f) => f.split('/')[0] === seg))
    return `файлы ${seg}/ допустимы только по манифесту: добавь «${rel}» в manifest.json → files или убери файл`;
  return `имя «${seg}» вне схемы .oc3/ — верхний уровень: ${topLevelSummary()}; проектное имя — объяви в manifest.json (data / files / layout)`;
};

const collectTree = async (root: string): Promise<string[]> => {
  const base = path.join(root, OC3_DIR);
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
      const rel = path.relative(base, path.join(dir, e.name)).split(path.sep).join('/');
      if (e.isDirectory()) {
        await walk(path.join(dir, e.name));
        continue;
      }
      out.push(rel);
    }
  };
  await walk(base);
  return out.sort();
};

interface Failure {
  rel: string;
  detail: string;
}

const validateTree = (paths: readonly string[], manifest: TreeManifest): Failure[] => {
  const validate = compileSchema(buildTreeSchema(manifest));
  const byIndex = new Map<number, string>();
  for (const i of validate(paths)) {
    const index = Number.parseInt(i.path.replace(/[^0-9]/g, ''), 10);
    if (!Number.isInteger(index)) continue;
    const prev = byIndex.get(index);
    byIndex.set(index, prev === undefined ? issueText(i) : `${prev}; ${issueText(i)}`);
  }
  return [...byIndex.entries()]
    .map(([index, detail]) => ({ rel: paths[index] ?? '', detail }))
    .filter((x) => x.rel !== '')
    .sort((a, b) => a.rel.localeCompare(b.rel));
};

export interface TreeReport {
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
}

export const checkOc3Tree = async (root: string): Promise<TreeReport> => {
  const diagnostics: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const paths = await collectTree(root);
  if (paths.length === 0) {
    warnings.push({
      file: OC3_DIR,
      message: 'нет .oc3/ — контракта нет, инициализируй (oc3 init)',
    });
    return { diagnostics, warnings };
  }
  const manifest = await readTreeManifest(root, warnings);
  for (const f of validateTree(paths, manifest))
    diagnostics.push({
      file: `${OC3_DIR}/${f.rel}`,
      message: `приведи ${OC3_DIR}/${f.rel} к схеме: ${mandateOf(f.rel, manifest)}; нарушение: ${f.detail}`,
    });
  return { diagnostics, warnings };
};

export async function runTree(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command !== 'check')
    throw new UsageError(`неизвестная команда: tree ${command ?? ''}`.trimEnd());
  const { diagnostics, warnings } = await checkOc3Tree(args.root);
  warn(warnings);
  return report('tree check', diagnostics);
}
