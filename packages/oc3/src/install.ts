import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
import {
  AUTONOMY_PATH,
  CONVENTIONS_DIR,
  DATA_DIR,
  DEFAULT_BUDGETS,
  GLOSSARY_DIR,
  KNOWLEDGE_DIR,
  MANUALS_DIR,
  NOTES_PATH,
  OC3_DIR,
  OC3_MANIFEST,
  PROJECT_PATH,
  SCHEMAS_DIR,
  artifactPath,
  isRecord,
  InputError,
} from '@shahimat/ai-core';
import { CONFIGS, parseJsonc } from '#operator-agent';
import {
  AGENTS_MD,
  AGENTS_PIECES,
  AI_CORE_FALLBACK_PIN,
  AUTONOMY_YML,
  DEFAULT_INDEX_SOURCE,
  GITATTR_LINES,
  GITIGNORE_LINES,
  OC3_FALLBACK_PIN,
  PROJECT_YML,
  ROLE_AGENTS,
  ROLE_NAMES,
  SKILLS_PRESET_HEADER,
  SKILLS_YML,
  CORE_MANIFEST,
  newPackageJson,
  renderSkillEntries,
  skillsForRoles,
  type EmbeddedRole,
  type SkillEntry,
} from '#templates';
export type ContractState = 'nothing' | 'v2' | 'v3-partial' | 'v3-ok';

export interface Detection {
  state: ContractState;
  details: readonly string[];
  v2Leftovers: boolean;
}

export interface PluginWiring {
  readonly wired: boolean;
  readonly wrongKey: boolean;
  readonly missing: boolean;
}

export const PLUGIN_PACKAGE = '@shahimat/oc3';

export const scanPluginWiring = async (root: string): Promise<PluginWiring> => {
  let wired = false;
  let wrongKey = false;
  let missing = false;
  const load = async (rel: string): Promise<unknown> => {
    const text = await readOrNull(path.join(root, rel));
    if (text === null) return undefined;
    const json = parseJsonc(text);
    if (json !== undefined) return json;
    try {
      return parse(text);
    } catch {
      return undefined;
    }
  };
  for (const rel of CONFIGS) {
    const data = await load(rel);
    if (!isRecord(data)) continue;
    if (Array.isArray(data['plugins'])) {
      if (data['plugins'].includes(PLUGIN_PACKAGE))
        return { wired: true, wrongKey: false, missing: false };
      missing = true;
      continue;
    }
    if ('plugin' in data) wrongKey = true;
  }
  return { wired, wrongKey, missing };
};

const DEPS = ['@shahimat/ai-core', '@shahimat/oc3'] as const;

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

async function parseProject(root: string): Promise<Record<string, unknown> | null> {
  const text = await readOrNull(path.join(root, PROJECT_PATH));
  if (text === null) return null;
  try {
    const data: unknown = parse(text);
    return isRecord(data) ? data : null;
  } catch {
    return null;
  }
}

function hasV3Contract(data: Record<string, unknown> | null): boolean {
  if (data === null || !isRecord(data['sync']) || !isRecord(data['sync']['contract'])) return false;
  const contract = data['sync']['contract'];
  return (
    contract['edition'] === 'operator-centric' &&
    typeof contract['key'] === 'string' &&
    contract['key'].includes('v3')
  );
}

export async function detectState(root: string): Promise<Detection> {
  const details: string[] = [];
  const workflowV2 = existsSync(path.join(root, 'context', 'workflow.md'));
  const viewsV2 = existsSync(path.join(root, 'context', 'views'));
  const v2 = workflowV2 || viewsV2;
  const project = await parseProject(root);
  const projectV3 = hasV3Contract(project);
  if (project === null) details.push(`нет ${PROJECT_PATH}`);
  else if (!projectV3) details.push(`в ${PROJECT_PATH} нет sync.contract v3 (operator-centric)`);
  let agentsV3 = false;
  const agents = await readOrNull(path.join(root, 'AGENTS.md'));
  if (agents === null) details.push('нет AGENTS.md');
  else {
    agentsV3 = agents.includes('<!-- module:');
    if (!agentsV3) details.push('в AGENTS.md нет module-маркеров v3');
  }
  const wiring = await scanPluginWiring(root);
  const pluginWired = wiring.wired;
  if (!pluginWired) {
    if (wiring.wrongKey)
      details.push('плагин не загрузится — ключ plugin вместо plugins (нужен plugins)');
    else if (wiring.missing) details.push(`opencode.json(c): в plugins нет "${PLUGIN_PACKAGE}"`);
    else details.push(`opencode.json(c) не подключает плагин ${PLUGIN_PACKAGE}`);
  }
  let depsOk = false;
  const pkg = await readOrNull(path.join(root, 'package.json'));
  if (pkg === null) details.push('нет package.json с devDependencies контракта');
  else {
    try {
      const data: unknown = JSON.parse(pkg);
      const dev =
        isRecord(data) && isRecord(data['devDependencies']) ? data['devDependencies'] : {};
      depsOk = DEPS.every((name) => typeof dev[name] === 'string');
      if (!depsOk)
        details.push('в devDependencies нет точных пинов @shahimat/ai-core и @shahimat/oc3');
    } catch {
      details.push('package.json: невалидный JSON');
    }
  }
  const lock = existsSync(artifactPath(root, { kind: 'lock', key: 'install' }));
  const points = [projectV3, agentsV3, pluginWired, depsOk].filter((item) => item).length;
  let state: ContractState;
  if (v2 && !projectV3) state = 'v2';
  else if (points === 4 && !lock && !v2) state = 'v3-ok';
  else if (points === 0 && !v2) state = 'nothing';
  else state = 'v3-partial';
  if (lock && state !== 'v2') details.push('есть .oc3/locks/install — установка не завершена');
  if (v2 && state !== 'v2')
    details.push(
      'остались артефакты v2 (context/workflow.md или context/views/) — нужен отчёт миграции',
    );
  return { state, details, v2Leftovers: v2 };
}

const execVersion = (bin: string): Promise<boolean> =>
  new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 4000 }, (error) => resolve(error === null));
  });

export async function detectTools(): Promise<{ node: boolean; npm: boolean }> {
  const [node, npm] = await Promise.all([execVersion('node'), execVersion('npm')]);
  return { node, npm };
}

export function toolHints(tools: { node: boolean; npm: boolean }): string[] {
  const lines: string[] = [];
  if (!tools.node)
    lines.push('node не найден в PATH — ai CLI и harness-проверки (npm run ci) недоступны');
  if (!tools.npm)
    lines.push(
      'npm не найден — devDependencies и проверки проекта недоступны; плагин opencode установит сам, npm ему не нужен',
    );
  return lines;
}

export async function probeOnline(): Promise<boolean> {
  try {
    const response = await fetch('https://registry.npmjs.org/-/ping', {
      signal: AbortSignal.timeout(4000),
    });
    return response.status >= 200 && response.status < 600;
  } catch {
    return false;
  }
}

export function resolveRuntime(online: boolean): {
  runtime: 'full' | 'degraded';
  lines: readonly string[];
} {
  if (online)
    return {
      runtime: 'full',
      lines: [
        'runtime: full — плагин и hooks работают cold-start, node/npm для автоустановки плагина не нужны',
      ],
    };
  return {
    runtime: 'degraded',
    lines: [
      'runtime: degraded — реестр npm недоступен: автоустановка плагина при первом старте opencode не выполнится',
      'после появления сети перезапусти opencode (или поставь @shahimat/oc3 сам) и верни runtime: full в .oc3/project.yml',
    ],
  };
}

export async function pins(): Promise<{ aiCore: string; oc3: string }> {
  try {
    const require = createRequire(import.meta.url);
    const abs = require.resolve('@shahimat/oc3/package.json');
    const data: unknown = JSON.parse(await readFile(abs, 'utf8'));
    if (!isRecord(data) || typeof data['version'] !== 'string') throw new Error('нет версии');
    const deps = isRecord(data['dependencies']) ? data['dependencies'] : {};
    const aiCore = deps['@shahimat/ai-core'];
    return {
      oc3: data['version'],
      aiCore: typeof aiCore === 'string' ? aiCore : AI_CORE_FALLBACK_PIN,
    };
  } catch {
    return { aiCore: AI_CORE_FALLBACK_PIN, oc3: OC3_FALLBACK_PIN };
  }
}

const INSTALL_NOTE =
  '<!-- ядро контракта v3 дописано oc3 init; секции можно редактировать, повторный запуск не дублирует -->';

export async function ensureAgentsMd(root: string): Promise<string[]> {
  const abs = path.join(root, 'AGENTS.md');
  const lines: string[] = [];
  const current = await readOrNull(abs);
  if (current === null) {
    await writeFile(abs, AGENTS_MD, 'utf8');
    return ['AGENTS.md: записан по шаблону контракта v3'];
  }
  const missing = AGENTS_PIECES.filter((piece) => !current.includes(piece.marker));
  if (missing.length === 0) {
    lines.push('AGENTS.md: секции ядра v3 на месте — без изменений');
    if (current.includes('agent-operational-contract-v2'))
      lines.push('AGENTS.md: упоминается контракт v2 — проверь шапку вручную');
    return lines;
  }
  const addition = ['\n' + INSTALL_NOTE, ...missing.map((piece) => piece.body)].join('\n');
  await writeFile(abs, current.replace(/\n*$/, '\n') + addition, 'utf8');
  lines.push(
    `AGENTS.md: дописаны секции ядра v3 (${missing.length}); пользовательские секции и module-блоки сохранены`,
  );
  if (current.includes('agent-operational-contract-v2'))
    lines.push('AGENTS.md: упоминается контракт v2 — проверь шапку вручную');
  return lines;
}

const lineIndexOf = (text: string, re: RegExp): number => {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i] ?? '')) return i;
  return -1;
};

export function upsertRuntimeYaml(text: string, runtime: string): string {
  const index = lineIndexOf(text, /^runtime:/);
  if (index >= 0) {
    const lines = text.split('\n');
    lines[index] = `runtime: ${runtime}`;
    return lines.join('\n');
  }
  return `${text.replace(/\n*$/, '\n')}runtime: ${runtime}\n`;
}

export function ensureSyncContractYaml(text: string): { text: string; changed: boolean } {
  const sync = lineIndexOf(text, /^sync:/);
  if (sync < 0) {
    const block = [
      'sync:',
      `  index_source: ${DEFAULT_INDEX_SOURCE}`,
      '  contract:',
      '    key: agent-operational-contract-v3',
      '    edition: operator-centric',
      '    parts: {}',
    ];
    return { text: `${text.replace(/\n*$/, '\n')}\n${block.join('\n')}\n`, changed: true };
  }
  const lines = text.split('\n');
  let end = lines.length;
  for (let i = sync + 1; i < lines.length; i++) {
    if (/^[A-Za-z][A-Za-z-]*:/.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  const region = lines.slice(sync, end).join('\n');
  if (region.includes('contract:')) return { text, changed: false };
  const sub = [
    '  contract:',
    '    key: agent-operational-contract-v3',
    '    edition: operator-centric',
    '    parts: {}',
  ];
  lines.splice(sync + 1, 0, ...sub);
  return { text: lines.join('\n'), changed: true };
}

export async function ensureProjectYml(root: string, runtime: string): Promise<string[]> {
  const abs = path.join(root, PROJECT_PATH);
  const lines: string[] = [];
  const current = await readOrNull(abs);
  if (current === null) {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, PROJECT_YML, 'utf8');
    return [`${PROJECT_PATH}: записан каркас — поля-плейсхолдеры в вопросах ниже`];
  }
  try {
    parse(current);
  } catch {
    return [`${PROJECT_PATH}: невалидный YAML — дополнять не рискую, приведи в порядок сам`];
  }
  let text = upsertRuntimeYaml(current, runtime);
  const sync = ensureSyncContractYaml(text);
  text = sync.text;
  await writeFile(abs, text, 'utf8');
  lines.push(
    `${PROJECT_PATH}: runtime: ${runtime} записан, ${sync.changed ? 'sync.contract v3 дописан' : 'sync.contract v3 на месте'}; остальное содержание сохранено`,
  );
  return lines;
}

export async function ensureContextSkeleton(root: string): Promise<string[]> {
  const lines: string[] = [];
  const files: readonly [string, string][] = [
    [AUTONOMY_PATH, AUTONOMY_YML],
    ['.oc3/skills.yml', SKILLS_YML],
  ];
  for (const [rel, content] of files) {
    const abs = path.join(root, rel);
    if (existsSync(abs)) {
      lines.push(`${rel}: уже есть — не трогаю`);
      continue;
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
    lines.push(`${rel}: записан каркас`);
  }
  return lines;
}

const MEMORY_LABEL = 'память:';
const NOTES_TITLE = '# NOTES — неформальные факты до формализации';
const SCHEMAS_DIRNAME = path.basename(SCHEMAS_DIR);

const DOC_FACT_DIRS: readonly string[] = [
  GLOSSARY_DIR,
  CONVENTIONS_DIR,
  MANUALS_DIR,
  KNOWLEDGE_DIR,
].map((p) => p.slice(OC3_DIR.length + 1));

const defaultWeight = (rel: string): number =>
  (rel.split('/').at(-1) ?? '').startsWith('common.') ? 0 : 2;

const listDocFiles = async (root: string, relDir: string): Promise<string[]> => {
  const abs = path.join(root, OC3_DIR, relDir);
  if (!existsSync(abs)) return [];
  const entries = await readdir(abs, { withFileTypes: true, recursive: true });
  return entries
    .filter((item) => item.isFile())
    .map(
      (item) =>
        `${relDir}/${path.relative(abs, path.join(item.parentPath, item.name)).split(path.sep).join('/')}`,
    )
    .sort();
};

const listDataStructures = async (root: string): Promise<string[]> => {
  const abs = path.join(root, DATA_DIR);
  if (!existsSync(abs)) return [];
  const entries = await readdir(abs, { withFileTypes: true });
  return entries
    .filter((item) => item.isDirectory() && item.name !== SCHEMAS_DIRNAME)
    .map((item) => item.name)
    .sort();
};

const collectFactFiles = async (root: string, structures: readonly string[]): Promise<string[]> => {
  const found: string[] = [];
  for (const dir of DOC_FACT_DIRS) found.push(...(await listDocFiles(root, dir)));
  for (const name of structures) found.push(...(await listDocFiles(root, `data/${name}`)));
  return [...new Set(found)].sort();
};

interface SkeletonManifest {
  namespace: string[];
  data: string[];
  budgets: { notes: number; start: number; node: number; optional_field: number };
  files: Record<string, { namespace: string[]; weight: number }>;
}

const skeletonManifest = (
  files: readonly string[],
  structures: readonly string[],
): SkeletonManifest => {
  const entries: Record<string, { namespace: string[]; weight: number }> = {};
  for (const rel of files) entries[rel] = { namespace: [], weight: defaultWeight(rel) };
  return {
    namespace: [],
    data: [...structures],
    budgets: {
      notes: DEFAULT_BUDGETS.notes,
      start: DEFAULT_BUDGETS.start,
      node: DEFAULT_BUDGETS.node,
      optional_field: DEFAULT_BUDGETS.optionalField,
    },
    files: entries,
  };
};

const mergeManifest = (
  current: Record<string, unknown>,
  files: readonly string[],
  structures: readonly string[],
): { manifest: Record<string, unknown>; addedFiles: number; addedData: number } => {
  const knownData = Array.isArray(current['data'])
    ? current['data'].filter((item): item is string => typeof item === 'string')
    : [];
  const data = [...knownData];
  let addedData = 0;
  for (const name of structures)
    if (!data.includes(name)) {
      data.push(name);
      addedData += 1;
    }
  const rawFiles = isRecord(current['files']) ? current['files'] : {};
  const mergedFiles: Record<string, unknown> = { ...rawFiles };
  let addedFiles = 0;
  for (const rel of files) {
    if (isRecord(mergedFiles[rel])) continue;
    mergedFiles[rel] = { namespace: [], weight: defaultWeight(rel) };
    addedFiles += 1;
  }
  const namespace = Array.isArray(current['namespace']) ? current['namespace'] : [];
  return { manifest: { ...current, namespace, data, files: mergedFiles }, addedFiles, addedData };
};

const ensureManifestFile = async (root: string): Promise<string[]> => {
  const abs = path.join(root, OC3_MANIFEST);
  const structures = await listDataStructures(root);
  const found = await collectFactFiles(root, structures);
  const summary = `файлов фактов: ${found.length}, структуры: ${structures.join(', ') || 'нет'}`;
  const current = await readOrNull(abs);
  if (current === null) {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(
      abs,
      `${JSON.stringify(skeletonManifest(found, structures), null, 2)}\n`,
      'utf8',
    );
    return [`${MEMORY_LABEL} ${OC3_MANIFEST}: создан скелет — ${summary}, бюджеты по умолчанию`];
  }
  let data: unknown;
  try {
    data = JSON.parse(current);
  } catch {
    return [
      `${MEMORY_LABEL} ${OC3_MANIFEST}: невалидный JSON — merge пропущен, приведи файл в порядок сам`,
    ];
  }
  if (!isRecord(data))
    return [`${MEMORY_LABEL} ${OC3_MANIFEST}: корень не объект — merge пропущен`];
  const merged = mergeManifest(data, found, structures);
  if (merged.addedFiles === 0 && merged.addedData === 0)
    return [`${MEMORY_LABEL} ${OC3_MANIFEST}: на месте, записи сохранены — ${summary}`];
  await writeFile(abs, `${JSON.stringify(merged.manifest, null, 2)}\n`, 'utf8');
  return [
    `${MEMORY_LABEL} ${OC3_MANIFEST}: merge — дописаны файлы фактов (${merged.addedFiles}), структуры (+${merged.addedData}); существующие веса и namespace сохранены`,
  ];
};

const ensureNotesFile = async (root: string): Promise<string> => {
  const abs = path.join(root, NOTES_PATH);
  if (existsSync(abs)) return `${MEMORY_LABEL} ${NOTES_PATH}: уже есть — не трогаю`;
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `${NOTES_TITLE}\n`, 'utf8');
  return `${MEMORY_LABEL} ${NOTES_PATH}: создан с заголовком по умолчанию`;
};

export async function ensureMemorySkeleton(root: string): Promise<string[]> {
  return [...(await ensureManifestFile(root)), await ensureNotesFile(root)];
}

export const WATCH_ROLES: readonly string[] = ['watch-request', 'watch-triage'];

const isEmbeddedRole = (value: string): value is EmbeddedRole =>
  ROLE_NAMES.some((role) => role === value);

export function parseRoles(input: string): readonly EmbeddedRole[] {
  const parts = input
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
  if (parts.length === 0)
    throw new InputError(
      '--roles пуст: перечисли роли через запятую из встроенного набора (researcher, executor, judge, librarian)',
    );
  const watch = parts.filter((part) => WATCH_ROLES.includes(part));
  if (watch.length > 0)
    throw new InputError(
      `${watch.join(', ')} — роли модуля watchers, их нет во встроенном наборе: подключи модуль watchers через contract-setup, тогда агенты появятся с ним`,
    );
  const unknown = parts.filter((part) => !isEmbeddedRole(part));
  if (unknown.length > 0)
    throw new InputError(
      `нет встроенной роли: ${unknown.join(', ')}; встроены — ${ROLE_NAMES.join(', ')}`,
    );
  const roles: EmbeddedRole[] = [];
  for (const part of parts) {
    if (!isEmbeddedRole(part)) continue;
    if (!roles.includes(part)) roles.push(part);
  }
  return roles;
}

export async function ensureRoleAgents(
  root: string,
  roles: readonly EmbeddedRole[],
): Promise<string[]> {
  const lines: string[] = [];
  for (const role of roles) {
    const agent = ROLE_AGENTS.find((item) => item.role === role);
    if (agent === undefined) continue;
    const abs = path.join(root, '.agents', 'agents', `${role}.md`);
    if (existsSync(abs)) {
      lines.push(`.agents/agents/${role}.md: уже есть — не перетираю`);
      continue;
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, agent.body, 'utf8');
    lines.push(`.agents/agents/${role}.md: записан снимок канона роли`);
  }
  return lines;
}

const insertSkillEntries = (text: string, entries: readonly SkillEntry[]): string => {
  const block = renderSkillEntries(entries).trimEnd().split('\n');
  const lines = text.replace(/\n*$/, '\n').split('\n');
  const skillsAt = lines.findIndex((line) => line.startsWith('skills:'));
  if (skillsAt < 0) return `${text.replace(/\n*$/, '\n')}${block.join('\n')}\n`;
  const anchor = lines[skillsAt] ?? '';
  if (/^skills:\s*\[\s*\]\s*$/.test(anchor)) {
    lines[skillsAt] = 'skills:';
    lines.splice(skillsAt + 1, 0, ...block);
    return lines.join('\n');
  }
  let end = lines.length;
  for (let i = skillsAt + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\S/.test(line)) {
      end = i;
      break;
    }
  }
  if (end === lines.length && lines.at(-1) === '') end -= 1;
  lines.splice(end, 0, ...block);
  return lines.join('\n');
};

const presetOwnedSignatures = (): Set<string> => {
  const signatures = new Set<string>();
  for (let mask = 0; mask < 1 << ROLE_NAMES.length; mask += 1) {
    const subset = ROLE_NAMES.filter((_, index) => ((mask >> index) & 1) === 1);
    for (const entry of skillsForRoles(subset))
      signatures.add(`${entry.key}|${entry.roles.join(',')}`);
  }
  return signatures;
};

const replaceSkillEntry = (text: string, entry: SkillEntry): string => {
  const lines = text.split('\n');
  const pattern = new RegExp(`^ {2}- key: ${entry.key}$`);
  const start = lines.findIndex((line) => pattern.test(line));
  if (start < 0) return text;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^ {2}- /.test(line) || /^\S/.test(line)) {
      end = i;
      break;
    }
  }
  const block = renderSkillEntries([entry]).trimEnd().split('\n');
  lines.splice(start, end - start, ...block);
  return lines.join('\n');
};

export async function ensureSkillsPreset(
  root: string,
  roles: readonly EmbeddedRole[],
): Promise<string[]> {
  const abs = path.join(root, '.oc3', 'skills.yml');
  const wanted = skillsForRoles(roles);
  if (wanted.length === 0) return [];
  const label = `пресет operator-centric по ролям (${roles.join(', ')})`;
  const fresh = `${SKILLS_PRESET_HEADER}${renderSkillEntries(wanted)}`;
  const current = await readOrNull(abs);
  if (current === null) {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, fresh, 'utf8');
    return [`.oc3/skills.yml: записан ${label} — ${wanted.length} привязок`];
  }
  let data: unknown;
  try {
    data = parse(current);
  } catch {
    return [
      '.oc3/skills.yml: невалидный YAML — привязки пресета не дописываю, приведи файл в порядок сам',
    ];
  }
  if (!isRecord(data) || !Array.isArray(data['skills'])) {
    await writeFile(abs, fresh, 'utf8');
    return [
      `.oc3/skills.yml: старый каркас без списка skills — перезаписан ${label} (${wanted.length} привязок)`,
    ];
  }
  const existing = new Map<string, string>();
  for (const item of data['skills']) {
    if (!isRecord(item) || typeof item['key'] !== 'string') continue;
    const bound = Array.isArray(item['roles'])
      ? item['roles'].filter((role): role is string => typeof role === 'string')
      : [];
    if (!existing.has(item['key'])) existing.set(item['key'], bound.join(','));
  }
  const owned = presetOwnedSignatures();
  const missing = wanted.filter((entry) => !existing.has(entry.key));
  const stale = wanted.filter((entry) => {
    const signature = existing.get(entry.key);
    if (signature === undefined) return false;
    return signature !== entry.roles.join(',') && owned.has(`${entry.key}|${signature}`);
  });
  if (missing.length === 0 && stale.length === 0)
    return [`.oc3/skills.yml: ${label} на месте (${wanted.length} привязок) — без изменений`];
  let text = current;
  for (const entry of stale) text = replaceSkillEntry(text, entry);
  if (missing.length > 0) text = insertSkillEntries(text, missing);
  await writeFile(abs, text, 'utf8');
  const parts: string[] = [];
  if (stale.length > 0)
    parts.push(`обновлены записи пресета (${stale.map((entry) => entry.key).join(', ')})`);
  if (missing.length > 0)
    parts.push(
      `дописаны привязки (${missing.length}: ${missing.map((entry) => entry.key).join(', ')})`,
    );
  return [`.oc3/skills.yml: ${parts.join('; ')} — пользовательские записи сохранены`];
}

export async function ensurePackageJson(root: string): Promise<string[]> {
  const abs = path.join(root, 'package.json');
  const resolved = await pins();
  const lines: string[] = [];
  const current = await readOrNull(abs);
  if (current === null) {
    const name = path.basename(root).replace(/[^A-Za-z0-9._-]/g, '-') || 'contract-project';
    await writeFile(abs, newPackageJson(name, resolved.aiCore, resolved.oc3), 'utf8');
    return [
      `package.json: создан с точными пинами @shahimat/ai-core@${resolved.aiCore} и @shahimat/oc3@${resolved.oc3}`,
    ];
  }
  let data: unknown;
  try {
    data = JSON.parse(current);
  } catch {
    return ['package.json: невалидный JSON — пины добавь вручную'];
  }
  if (!isRecord(data)) return ['package.json: не объект — пины добавь вручную'];
  const dev = isRecord(data['devDependencies']) ? data['devDependencies'] : {};
  const next = { ...dev };
  let changed = false;
  if (next['@shahimat/ai-core'] !== resolved.aiCore) {
    next['@shahimat/ai-core'] = resolved.aiCore;
    changed = true;
  }
  if (next['@shahimat/oc3'] !== resolved.oc3) {
    next['@shahimat/oc3'] = resolved.oc3;
    changed = true;
  }
  if (!changed) {
    lines.push('package.json: точные пины контракта на месте');
    return lines;
  }
  data['devDependencies'] = next;
  await writeFile(abs, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  lines.push(
    `package.json: devDependencies выставлены в точные пины @shahimat/ai-core@${resolved.aiCore}, @shahimat/oc3@${resolved.oc3}`,
  );
  return lines;
}

const ensureLineFile = async (
  abs: string,
  title: string,
  wanted: readonly string[],
): Promise<string[]> => {
  const current = await readOrNull(abs);
  if (current === null) {
    await writeFile(abs, `${wanted.join('\n')}\n`, 'utf8');
    return [`${title}: создан`];
  }
  const have = new Set(current.split('\n').map((line) => line.trim()));
  const missing = wanted.filter((line) => !have.has(line));
  if (missing.length === 0) return [`${title}: нужные строки на месте`];
  await writeFile(abs, `${current.replace(/\n*$/, '\n')}${missing.join('\n')}\n`, 'utf8');
  return [`${title}: дописаны строки (${missing.length})`];
};

export async function ensureGitFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  out.push(...(await ensureLineFile(path.join(root, '.gitignore'), '.gitignore', GITIGNORE_LINES)));
  out.push(
    ...(await ensureLineFile(path.join(root, '.gitattributes'), '.gitattributes', GITATTR_LINES)),
  );
  return out;
}

export async function ensureLock(root: string): Promise<string> {
  const abs = artifactPath(root, { kind: 'lock', key: 'install' });
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `oc3 init ${new Date().toISOString()}\n`, 'utf8');
  return 'маркер установки .oc3/locks/install создан — сними его (rm .oc3/locks/install) после ответов на вопросы';
}

export async function migrationReport(root: string): Promise<string[]> {
  const lines: string[] = [];
  const views = path.join(root, 'context', 'views');
  if (existsSync(views)) {
    let names: string[] = [];
    try {
      names = (await readdir(views)).filter((name) => /\.(ya?ml|json)$/.test(name)).sort();
    } catch {
      names = [];
    }
    lines.push(
      'отчёт миграции v2: содержимое context/views НЕ конвертируется молча — переноси вручную:',
    );
    if (names.length === 0) lines.push('  context/views пуст — переносить нечего');
    for (const name of names) {
      const base = name.replace(/\.(ya?ml|json)$/, '');
      lines.push(
        `  context/views/${name} → .oc3/goals/${base}.expect.ts — переложи записи в describe/crit (skill goals)`,
      );
    }
  }
  if (existsSync(path.join(root, 'context', 'workflow.md')))
    lines.push(
      '  context/workflow.md → протоколы встроены в skill workflow источника; файл можно архивировать',
    );
  return lines;
}

export async function humanQuestions(created: boolean, rolesSelected = false): Promise<string[]> {
  const lines = ['вопросы человеку (без ответов установку не завершай):'];
  if (created) lines.push(`  1. заполни name и summary в ${PROJECT_PATH}`);
  else lines.push(`  1. проверь name и summary в ${PROJECT_PATH}`);
  lines.push(`  2. впиши reality — код-базу проекта (репозиторий, стек) в ${PROJECT_PATH}`);
  lines.push(
    `  3. подтверди реквизиты источника контракта (sync.index_source, по умолчанию ${DEFAULT_INDEX_SOURCE})`,
  );
  lines.push('  4. назначь модели ролей: oc3 models set <role> <model>');
  if (!rolesSelected)
    lines.push(
      '  5. выбери роли сейчас — подключение ролей часть установки, «потом» не бывает; дефолт researcher, executor, judge, librarian, повторный прогон: oc3 init --roles researcher,executor,judge,librarian',
    );
  lines.push(
    `канонический состав ядра operator-centric: skills — ${CORE_MANIFEST.skills.join(', ')}; агенты — ${CORE_MANIFEST.agents.join(', ')}`,
  );
  lines.push(
    'SHA заполнят первые source-sync update; до них части считаются не скачанными (sync.contract.parts: {})',
  );
  return lines;
}
