import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type { CommandArgs } from '#shared/args';
import { UsageError, type Diagnostic } from '#shared/diagnostics';
import { parseFrontmatter } from '#shared/frontmatter';
import { errorCode, isRecord } from '#shared/guards';
import { report } from '#shared/report';

const CORE_ROLES = [
  'operator',
  'researcher',
  'executor',
  'external-executor',
  'judge',
  'librarian',
];
const MODELS = ['zai/glm-5.3#max', 'zai/glm-5.3-flashx#max', 'zai/glm-5.3-flashx#low'];
const OPERATOR_SKILLS = ['operator-feedback', 'browser-read'];
const CONTRACT_SKILLS = ['contract-setup', 'workflow', 'source-sync', 'source-feedback', 'cli'];

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

function stringList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v): v is string => typeof v === 'string')) return null;
  return value;
}

function manifestOf(
  text: string,
  file: string,
): { skills: Record<string, unknown>[]; diags: Diagnostic[] } {
  const diags: Diagnostic[] = [];
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    return { skills: [], diags: [{ file, message: `невалидный YAML: ${String(error)}` }] };
  }
  if (!isRecord(data) || !Array.isArray(data['skills']))
    return { skills: [], diags: [{ file, message: 'ожидается skills: []' }] };
  const skills: Record<string, unknown>[] = [];
  for (const item of data['skills']) {
    if (!isRecord(item)) {
      diags.push({ file, message: 'элемент skills — объект' });
      continue;
    }
    skills.push(item);
  }
  return { skills, diags };
}

async function manifest(args: CommandArgs): Promise<{
  skills: Record<string, unknown>[];
  diags: Diagnostic[];
  roles: Map<string, string[]>;
}> {
  const file = 'context/skills.yml';
  const text = await readOrNull(path.join(args.root, file));
  if (text === null)
    return { skills: [], diags: [{ file, message: 'нет файла' }], roles: new Map() };
  const parsed = manifestOf(text, file);
  const roles = new Map<string, string[]>();
  for (const skill of parsed.skills) {
    const key = skill['key'];
    const bindings = stringList(skill['roles']) ?? [];
    if (typeof key === 'string')
      for (const role of bindings) {
        const list = roles.get(role) ?? [];
        list.push(key);
        roles.set(role, list);
      }
  }
  return { ...parsed, roles };
}

async function roleDirs(root: string): Promise<{ dir: string; names: string[] }> {
  for (const dir of ['.agents/agents', 'agents']) {
    const names = (await listDir(path.join(root, dir)))
      .filter((n) => n.endsWith('.md'))
      .map((n) => n.slice(0, -3));
    if (names.length > 0) return { dir, names };
  }
  return { dir: '.agents/agents', names: [] };
}

async function checkRoles(args: CommandArgs): Promise<number> {
  const diagnostics: Diagnostic[] = [];
  const m = await manifest(args);
  diagnostics.push(...m.diags);
  const { dir, names } = await roleDirs(args.root);
  if (names.length === 0) diagnostics.push({ file: dir, message: 'нет ролей' });
  for (const name of names) {
    const file = `${dir}/${name}.md`;
    const text = await readOrNull(path.join(args.root, file));
    if (text === null) continue;
    let fm;
    try {
      fm = parseFrontmatter(text);
    } catch (error) {
      diagnostics.push({ file, message: `невалидный frontmatter: ${String(error)}` });
      continue;
    }
    if (fm === null) {
      diagnostics.push({ file, message: 'нет frontmatter' });
      continue;
    }
    if (fm['name'] !== name)
      diagnostics.push({ file, message: `name не совпадает с файлом: ${name}` });
    for (const key of [
      'kind',
      'description',
      'model',
      'permissions',
      'lifecycle',
      'output',
      'artifacts',
    ]) {
      if (fm[key] === undefined) diagnostics.push({ file, message: `нет поля ${key}` });
    }
    if (!MODELS.includes(String(fm['model'])))
      diagnostics.push({
        file,
        message: `model — zai/glm-5.3#max | zai/glm-5.3-flashx#max|low`,
      });
    if (name === 'judge' && fm['model'] !== 'zai/glm-5.3-flashx#low')
      diagnostics.push({ file, message: 'judge должен быть на flashx#low' });
    if (name !== 'judge' && fm['model'] === 'zai/glm-5.3-flashx#low')
      diagnostics.push({ file, message: 'flashx#low разрешён только judge' });
    if (fm['output'] === undefined) diagnostics.push({ file, message: 'нет output' });
    const skills = m.roles.get(name) ?? [];
    for (const skill of skills) {
      if (!m.skills.some((s) => s['key'] === skill))
        diagnostics.push({
          file,
          message: `skills.yml: роль ${name} ссылается на ${skill}, которого нет`,
        });
    }
  }
  for (const [role, skills] of m.roles) {
    if (!CORE_ROLES.includes(role) && !names.includes(role))
      diagnostics.push({ file: 'context/skills.yml', message: `роль ${role} не существует` });
    if (role === 'operator')
      for (const skill of skills)
        if (!OPERATOR_SKILLS.includes(skill))
          diagnostics.push({
            file: 'context/skills.yml',
            message: `оператору нельзя skill ${skill}`,
          });
  }
  return report('roles check', diagnostics);
}

async function checkSkills(args: CommandArgs): Promise<number> {
  const diagnostics: Diagnostic[] = [];
  const m = await manifest(args);
  diagnostics.push(...m.diags);
  const { names } = await roleDirs(args.root);
  const seen = new Set<string>();
  for (const skill of m.skills) {
    const key = typeof skill['key'] === 'string' ? skill['key'] : '';
    if (key === '') {
      diagnostics.push({ file: 'context/skills.yml', message: 'skill без key' });
      continue;
    }
    seen.add(key);
    const declared = typeof skill['path'] === 'string' ? skill['path'] : `.agents/skills/${key}`;
    const file = `${declared}/SKILL.md`;
    const text = await readOrNull(path.join(args.root, file));
    if (text === null) {
      diagnostics.push({ file, message: 'нет SKILL.md' });
      continue;
    }
    let fm;
    try {
      fm = parseFrontmatter(text);
    } catch (error) {
      diagnostics.push({ file, message: `невалидный frontmatter: ${String(error)}` });
      continue;
    }
    if (fm === null) {
      diagnostics.push({ file, message: 'нет frontmatter' });
      continue;
    }
    if (fm['name'] !== key) diagnostics.push({ file, message: `name не совпадает с key: ${key}` });
    if (typeof fm['description'] !== 'string' || fm['description'] === '')
      diagnostics.push({ file, message: 'нет description' });
    const roles = stringList(skill['roles']) ?? [];
    if (roles.length === 0 && skill['kind'] !== 'core')
      diagnostics.push({ file: 'context/skills.yml', message: `skill ${key} не привязан к роли` });
    for (const role of roles) {
      if (!CORE_ROLES.includes(role) && !names.includes(role))
        diagnostics.push({
          file: 'context/skills.yml',
          message: `skill ${key}: роль ${role} не существует`,
        });
      if (role === 'operator' && !OPERATOR_SKILLS.includes(key))
        diagnostics.push({ file: 'context/skills.yml', message: `оператору нельзя skill ${key}` });
    }
  }
  for (const name of await listDir(path.join(args.root, '.agents/skills')))
    if (!seen.has(name) && !CONTRACT_SKILLS.includes(name))
      diagnostics.push({
        file: `.agents/skills/${name}`,
        message: 'skill не описан в context/skills.yml',
      });
  return report('skills check', diagnostics);
}

export async function runRoles(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command === 'check') return checkRoles(args);
  throw new UsageError(`неизвестная команда: roles ${command ?? ''}`.trimEnd());
}

export async function runSkills(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command === 'check') return checkSkills(args);
  throw new UsageError(`неизвестная команда: skills ${command ?? ''}`.trimEnd());
}
