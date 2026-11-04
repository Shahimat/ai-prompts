import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
import { isRecord } from '@shahimat/ai-core';
import { CONFIGS } from '#operator-agent';
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
  SKILLS_YML,
  newPackageJson,
} from '#templates';

export type ContractState = 'nothing' | 'v2' | 'v3-partial' | 'v3-ok';

export interface Detection {
  state: ContractState;
  details: readonly string[];
  v2Leftovers: boolean;
}

const DEPS = ['@shahimat/ai-core', '@shahimat/oc3'] as const;

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

async function parseProject(root: string): Promise<Record<string, unknown> | null> {
  const text = await readOrNull(path.join(root, 'context', 'project.yml'));
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
  if (project === null) details.push('нет context/project.yml');
  else if (!projectV3)
    details.push('в context/project.yml нет sync.contract v3 (operator-centric)');
  let agentsV3 = false;
  const agents = await readOrNull(path.join(root, 'AGENTS.md'));
  if (agents === null) details.push('нет AGENTS.md');
  else {
    agentsV3 = agents.includes('<!-- module:');
    if (!agentsV3) details.push('в AGENTS.md нет module-маркеров v3');
  }
  let pluginWired = false;
  for (const rel of CONFIGS) {
    const text = await readOrNull(path.join(root, rel));
    if (text !== null && text.includes('@shahimat/oc3')) pluginWired = true;
  }
  if (!pluginWired) details.push('opencode.json(c) не подключает плагин @shahimat/oc3');
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
  const lock = existsSync(path.join(root, '.ops', 'locks', 'install'));
  const points = [projectV3, agentsV3, pluginWired, depsOk].filter((item) => item).length;
  let state: ContractState;
  if (v2 && !projectV3) state = 'v2';
  else if (points === 4 && !lock && !v2) state = 'v3-ok';
  else if (points === 0 && !v2) state = 'nothing';
  else state = 'v3-partial';
  if (lock && state !== 'v2') details.push('есть .ops/locks/install — установка не завершена');
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
      'после появления сети перезапусти opencode (или поставь @shahimat/oc3 сам) и верни runtime: full в context/project.yml',
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
  const abs = path.join(root, 'context', 'project.yml');
  const lines: string[] = [];
  const current = await readOrNull(abs);
  if (current === null) {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, PROJECT_YML, 'utf8');
    return ['context/project.yml: записан каркас — поля-плейсхолдеры в вопросах ниже'];
  }
  try {
    parse(current);
  } catch {
    return ['context/project.yml: невалидный YAML — дополнять не рискую, приведи в порядок сам'];
  }
  let text = upsertRuntimeYaml(current, runtime);
  const sync = ensureSyncContractYaml(text);
  text = sync.text;
  await writeFile(abs, text, 'utf8');
  lines.push(
    `context/project.yml: runtime: ${runtime} записан, ${sync.changed ? 'sync.contract v3 дописан' : 'sync.contract v3 на месте'}; остальное содержание сохранено`,
  );
  return lines;
}

export async function ensureContextSkeleton(root: string): Promise<string[]> {
  const lines: string[] = [];
  const files: readonly [string, string][] = [
    ['autonomy.yml', AUTONOMY_YML],
    ['skills.yml', SKILLS_YML],
  ];
  for (const [name, content] of files) {
    const abs = path.join(root, 'context', name);
    if (existsSync(abs)) {
      lines.push(`context/${name}: уже есть — не трогаю`);
      continue;
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
    lines.push(`context/${name}: записан каркас`);
  }
  return lines;
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
  const abs = path.join(root, '.ops', 'locks', 'install');
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `oc3 init ${new Date().toISOString()}\n`, 'utf8');
  return 'маркер установки .ops/locks/install создан — сними его (rm .ops/locks/install) после ответов на вопросы';
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
        `  context/views/${name} → goals/${base}.expect.ts — переложи записи в describe/crit (skill goals)`,
      );
    }
  }
  if (existsSync(path.join(root, 'context', 'workflow.md')))
    lines.push(
      '  context/workflow.md → протоколы встроены в skill workflow источника; файл можно архивировать',
    );
  return lines;
}

export async function humanQuestions(created: boolean): Promise<string[]> {
  const lines = ['вопросы человеку (без ответов установку не завершай):'];
  if (created) lines.push('  1. заполни name и summary в context/project.yml');
  else lines.push('  1. проверь name и summary в context/project.yml');
  lines.push('  2. впиши reality — код-базу проекта (репозиторий, стек) в context/project.yml');
  lines.push(
    `  3. подтверди реквизиты источника контракта (sync.index_source, по умолчанию ${DEFAULT_INDEX_SOURCE})`,
  );
  lines.push('  4. назначь модели ролей: oc3 models set <role> <model>');
  return lines;
}
