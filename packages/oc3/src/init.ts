import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { parse } from 'yaml';
import type { CommandArgs } from '@shahimat/ai-core';
import { isRecord } from '@shahimat/ai-core';
import { ensureDefaultAgent, ensureOperatorAgent, ensurePluginEntry } from '#operator-agent';
import { detectOldLayout, migrateLayout } from '#migrate';
import {
  detectState,
  detectTools,
  ensureAgentsMd,
  ensureContextSkeleton,
  ensureGitFiles,
  ensureLock,
  ensurePackageJson,
  ensureProjectYml,
  ensureMemorySkeleton,
  ensureRoleAgents,
  ensureSkillsPreset,
  humanQuestions,
  migrationReport,
  parseRoles,
  probeOnline,
  resolveRuntime,
  scanPluginWiring,
  toolHints,
} from '#install';

const PACKAGES = ['@shahimat/ai-core', '@shahimat/oc3'];
const PROJECT_FILE_LABEL = '.oc3/project.yml';

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

async function readinessProblems(root: string): Promise<string[]> {
  const problems: string[] = [];
  const project = await readOrNull(path.join(root, '.oc3/project.yml'));
  if (project === null) problems.push(`нет ${PROJECT_FILE_LABEL} — разверни контракт v3`);
  else {
    try {
      const data: unknown = parse(project);
      const contract =
        isRecord(data) && isRecord(data['sync']) && isRecord(data['sync']['contract'])
          ? data['sync']['contract']
          : undefined;
      if (contract?.['edition'] !== 'operator-centric')
        problems.push('sync.contract.edition ≠ operator-centric — плагин не активируется');
    } catch (error) {
      problems.push(`${PROJECT_FILE_LABEL}: невалидный YAML (${String(error)})`);
    }
  }
  const pkg = await readOrNull(path.join(root, 'package.json'));
  if (pkg === null)
    problems.push('нет package.json — поставь @shahimat/ai-core и @shahimat/oc3 в devDependencies');
  else {
    try {
      const data: unknown = JSON.parse(pkg);
      const dev =
        isRecord(data) && isRecord(data['devDependencies']) ? data['devDependencies'] : {};
      for (const name of PACKAGES)
        if (!(name in dev)) problems.push(`package.json: нет devDependencies["${name}"]`);
    } catch {
      problems.push('package.json: невалидный JSON');
    }
  }
  const wiring = await scanPluginWiring(root);
  if (!wiring.wired)
    problems.push(
      'opencode.json(c): в plugins нет "@shahimat/oc3" — добавь запись и выполни /reload',
    );
  if (existsSync(path.join(root, '.oc3/locks/install')))
    problems.push(
      'есть .oc3/locks/install — установка не завершена: сними маркер в конце установки',
    );
  return problems;
}

const STATE_LABELS: Record<string, string> = {
  nothing: 'состояние: nothing — контракта нет, разворачиваю ядро v3',
  v2: 'v2 detected: контракт v2 живёт в context/workflow.md и context/views/ — переношу ядро на v3, содержимое очереди — отчётом миграции ниже, без молчаливой конверсии',
  'v3-partial': 'v3 partial: ядро контракта v3 установлено частично — дозаполняю',
  'v3-ok': 'oc3 init: v3 ok — состояние готовое, идёт проверка',
};

export async function runInit(args: CommandArgs): Promise<number> {
  if (detectOldLayout(args.root)) {
    console.log('layout: обнаружена старая раскладка — переношу в .oc3/ по карте миграции');
    for (const line of await migrateLayout(args.root)) console.log(line);
  }
  const rolesFlag = args.params?.['roles'];
  const roles = rolesFlag === undefined ? null : parseRoles(rolesFlag);
  const detection = await detectState(args.root);
  console.log(STATE_LABELS[detection.state] ?? 'состояние: неизвестно');
  if (detection.state === 'v3-partial' && detection.details.length > 0)
    console.log(`v3 partial: не хватает — ${detection.details.join('; ')}`);
  console.log(`operator-agent: ${await ensureOperatorAgent(args.root)}`);
  console.log(`operator-agent: ${await ensureDefaultAgent(args.root)}`);
  console.log(`operator-agent: ${await ensurePluginEntry(args.root)}`);
  if (roles !== null) {
    console.log(`roles: ${roles.join(', ')} — записываю агенты и привязки skills`);
    for (const line of await ensureRoleAgents(args.root, roles)) console.log(line);
    for (const line of await ensureSkillsPreset(args.root, roles)) console.log(line);
  }
  const online = await probeOnline();
  const runtime = resolveRuntime(online);
  for (const line of runtime.lines) console.log(line);
  if (detection.state === 'v3-ok') {
    for (const line of await ensureProjectYml(args.root, runtime.runtime)) console.log(line);
    const problems = await readinessProblems(args.root);
    if (problems.length > 0) {
      for (const problem of problems) console.error(problem);
      console.error('oc3 init: не готов');
      return 1;
    }
    console.log('oc3 init: ok — маркер, пакеты и плагин на месте');
    return 0;
  }
  const tools = await detectTools();
  for (const hint of toolHints(tools)) console.log(hint);
  const projectExisted = existsSync(path.join(args.root, '.oc3', 'project.yml'));
  for (const line of await ensureAgentsMd(args.root)) console.log(line);
  for (const line of await ensureProjectYml(args.root, runtime.runtime)) console.log(line);
  for (const line of await ensureContextSkeleton(args.root)) console.log(line);
  for (const line of await ensureMemorySkeleton(args.root)) console.log(line);
  for (const line of await ensurePackageJson(args.root)) console.log(line);
  for (const line of await ensureGitFiles(args.root)) console.log(line);
  if (detection.state === 'v2' || detection.v2Leftovers)
    for (const line of await migrationReport(args.root)) console.log(line);
  for (const line of await humanQuestions(!projectExisted, roles !== null)) console.log(line);
  console.log(await ensureLock(args.root));
  console.error('oc3 init: ядро записано — установка не завершена (см. вопросы и маркер выше)');
  return 1;
}
