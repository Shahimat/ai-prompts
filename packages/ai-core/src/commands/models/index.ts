import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import type { CommandArgs } from '#shared/args';
import { UsageError } from '#shared/diagnostics';
import { errorCode, isRecord } from '#shared/guards';
import { parseFrontmatter } from '#shared/frontmatter';
import { PROJECT_PATH } from '#shared/layout';
import { ROLE_MODEL_PATTERN } from '#lib/agent';

export { ROLE_MODEL_PATTERN };

const ROLE_DIRS = ['.agents/agents', 'agents'];
const DERIVED = '.opencode/agents';

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

async function listDir(abs: string): Promise<string[]> {
  try {
    return (await readdir(abs)).sort();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
}

async function roleNames(root: string, dir: string): Promise<string[]> {
  return (await listDir(path.join(root, dir))).filter((n) => n.endsWith('.md'));
}

function replaceModel(text: string, model: string): string {
  const lines = text.split('\n');
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end < 0) throw new UsageError('нет frontmatter (--- … ---)');
  let found = false;
  for (let i = 1; i < end; i++) {
    if (/^model:\s*\S/.test(lines[i] ?? '')) {
      lines[i] = `model: ${model}`;
      found = true;
      break;
    }
  }
  if (!found) throw new UsageError('в frontmatter нет поля model');
  return lines.join('\n');
}

function modelProviderMarker(model: string): string | null {
  if (model.startsWith('zai-coding-plan/')) return 'план';
  if (model.startsWith('zai/')) return 'платный API';
  return null;
}

async function projectOverrides(root: string): Promise<Record<string, string>> {
  const text = await readOrNull(path.join(root, PROJECT_PATH));
  if (text === null) return {};
  let data: unknown;
  try {
    data = parse(text);
  } catch {
    return {};
  }
  const roles = isRecord(data) ? data['roles'] : undefined;
  const models = isRecord(roles) ? roles['models'] : undefined;
  const out: Record<string, string> = {};
  if (isRecord(models))
    for (const [role, model] of Object.entries(models))
      if (typeof model === 'string') out[role] = model;
  return out;
}

async function writeOverride(root: string, role: string, model: string): Promise<boolean> {
  const file = path.join(root, PROJECT_PATH);
  const text = await readOrNull(file);
  if (text === null) return false;
  const lines = text.split('\n');
  const entry = `    ${role}: ${model}`;
  const start = lines.findIndex((line) => line.startsWith('roles:'));
  const inline = start >= 0 ? /^roles:[ \t]*\{(.*)\}[ \t]*(#.*)?$/.exec(lines[start] ?? '') : null;
  if (inline !== null) {
    const current: unknown = parse(`{${inline[1] ?? ''}}`);
    const merged = isRecord(current) ? current : {};
    const models = isRecord(merged['models']) ? { ...merged['models'] } : {};
    models[role] = model;
    merged['models'] = models;
    lines[start] =
      `roles: ${stringify(merged, { collectionStyle: 'flow', lineWidth: 0 }).trimEnd()}`;
  } else if (start < 0) {
    const block = ['roles:', '  models:', entry];
    const sync = lines.findIndex((line) => line.startsWith('sync:'));
    if (sync >= 0) lines.splice(sync, 0, ...block, '');
    else {
      while (lines.at(-1) === '') lines.pop();
      lines.push('', ...block);
    }
  } else {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^[A-Za-z][A-Za-z-]*:/.test(lines[i] ?? '')) {
        end = i;
        break;
      }
    }
    let modelsAt = -1;
    for (let i = start + 1; i < end; i++) {
      if (/^  models:\s*(#.*)?$/.test(lines[i] ?? '')) {
        modelsAt = i;
        break;
      }
    }
    if (modelsAt < 0) lines.splice(end, 0, '  models:', entry);
    else {
      let modelsEnd = end;
      for (let i = modelsAt + 1; i < end; i++) {
        if (/^  \S/.test(lines[i] ?? '')) {
          modelsEnd = i;
          break;
        }
      }
      let existing = -1;
      for (let i = modelsAt + 1; i < modelsEnd; i++) {
        if (new RegExp(`^    ${role}:`).test(lines[i] ?? '')) {
          existing = i;
          break;
        }
      }
      if (existing >= 0) lines[existing] = entry;
      else lines.splice(modelsAt + 1, 0, entry);
    }
  }
  await writeFile(file, `${lines.join('\n').replace(/\n*$/, '\n')}`, 'utf8');
  return true;
}

async function applyRole(root: string, role: string, model: string): Promise<string[]> {
  const changed: string[] = [];
  for (const dir of [...ROLE_DIRS, DERIVED]) {
    const rel = path.posix.join(dir, `${role}.md`);
    const text = await readOrNull(path.join(root, rel));
    if (text === null) continue;
    const fm = parseFrontmatter(text);
    if (fm !== null && typeof fm['name'] === 'string' && fm['name'] !== role)
      throw new UsageError(`${rel}: name «${fm['name']}» не совпадает с ролью ${role}`);
    await writeFile(path.join(root, rel), replaceModel(text, model), 'utf8');
    changed.push(rel);
  }
  return changed;
}

async function list(args: CommandArgs): Promise<number> {
  const overrides = await projectOverrides(args.root);
  let listed = 0;
  for (const dir of ROLE_DIRS) {
    for (const name of await roleNames(args.root, dir)) {
      const text = await readOrNull(path.join(args.root, dir, name));
      if (text === null) continue;
      const fm = parseFrontmatter(text);
      const model = fm === null || typeof fm['model'] !== 'string' ? '—' : fm['model'];
      const role = name.slice(0, -3);
      const override = overrides[role];
      const parts: string[] = [];
      const marker = modelProviderMarker(model);
      if (marker !== null) parts.push(marker);
      if (override !== undefined)
        parts.push(
          override === model ? 'override' : `override: ${override} — прогони models apply`,
        );
      console.log(`${role}: ${model}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`);
      listed++;
    }
  }
  if (listed === 0) throw new UsageError(`нет ролей: ${ROLE_DIRS.join(', ')}`);
  return 0;
}

async function set(args: CommandArgs): Promise<number> {
  const role = args.params?.['role'];
  const model = args.params?.['model'];
  if (role === undefined || model === undefined) throw new UsageError('models set <role> <model>');
  if (!ROLE_MODEL_PATTERN.test(model))
    throw new UsageError(`модель вне формата provider/model[#variant]: ${model}`);
  const changed = await applyRole(args.root, role, model);
  if (changed.length === 0)
    throw new UsageError(
      `роль ${role} не найдена: ${ROLE_DIRS.map((d) => `${d}/${role}.md`).join(', ')}`,
    );
  const saved = await writeOverride(args.root, role, model);
  console.log(
    `${role}: model → ${model} (${changed.join(', ')}; override → ${
      saved ? PROJECT_PATH : `нет ${PROJECT_PATH} — переживёт только до синка`
    })`,
  );
  return 0;
}

async function apply(args: CommandArgs): Promise<number> {
  const overrides = await projectOverrides(args.root);
  const roles = Object.keys(overrides);
  if (roles.length === 0) {
    console.log(`override нет — ${PROJECT_PATH} → roles.models`);
    return 0;
  }
  let applied = 0;
  for (const role of roles) {
    const model = overrides[role];
    if (model === undefined) continue;
    const changed = await applyRole(args.root, role, model);
    if (changed.length === 0) {
      console.log(`${role}: файлов роли нет — пропуск`);
      continue;
    }
    applied++;
    console.log(`${role}: model → ${model} (${changed.join(', ')})`);
  }
  console.log(`применено ${applied}/${roles.length} из ${PROJECT_PATH} → roles.models`);
  return 0;
}

export async function runModels(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command === undefined || command === 'list') return list(args);
  if (command === 'set') return set(args);
  if (command === 'apply') return apply(args);
  throw new UsageError(`неизвестная команда: models ${command}`);
}
