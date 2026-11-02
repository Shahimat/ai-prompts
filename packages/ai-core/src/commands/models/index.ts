import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CommandArgs } from '#shared/args';
import { UsageError } from '#shared/diagnostics';
import { errorCode } from '#shared/guards';
import { parseFrontmatter } from '#shared/frontmatter';

export const ROLE_MODEL_PATTERN =
  /^(zai|zai-coding-plan)\/glm-5\.3(-flash|-flashx)?#(max|high|low)$/;
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

async function list(args: CommandArgs): Promise<number> {
  let listed = 0;
  for (const dir of ROLE_DIRS) {
    for (const name of await roleNames(args.root, dir)) {
      const text = await readOrNull(path.join(args.root, dir, name));
      if (text === null) continue;
      const fm = parseFrontmatter(text);
      const model = fm === null || typeof fm['model'] !== 'string' ? '—' : fm['model'];
      console.log(`${name.slice(0, -3)}: ${model}`);
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
    throw new UsageError(`модель вне семейства glm-5.3 (zai, zai-coding-plan): ${model}`);
  const changed: string[] = [];
  for (const dir of [...ROLE_DIRS, DERIVED]) {
    const rel = path.posix.join(dir, `${role}.md`);
    const text = await readOrNull(path.join(args.root, rel));
    if (text === null) continue;
    const fm = parseFrontmatter(text);
    if (fm !== null && typeof fm['name'] === 'string' && fm['name'] !== role)
      throw new UsageError(`${rel}: name «${fm['name']}» не совпадает с ролью ${role}`);
    await writeFile(path.join(args.root, rel), replaceModel(text, model), 'utf8');
    changed.push(rel);
  }
  if (changed.length === 0)
    throw new UsageError(
      `роль ${role} не найдена: ${ROLE_DIRS.map((d) => `${d}/${role}.md`).join(', ')}`,
    );
  console.log(`${role}: model → ${model} (${changed.join(', ')})`);
  return 0;
}

export async function runModels(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command === undefined || command === 'list') return list(args);
  if (command === 'set') return set(args);
  throw new UsageError(`неизвестная команда: models ${command}`);
}
