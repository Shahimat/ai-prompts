import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { parse } from 'yaml';
import type { CommandArgs } from '@shahimat/ai-core';
import { isRecord } from '@shahimat/ai-core';

const CONFIGS = [
  'opencode.json',
  'opencode.jsonc',
  '.opencode/opencode.json',
  '.opencode/opencode.jsonc',
];
const PACKAGES = ['@shahimat/ai-core', '@shahimat/oc3'];

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

export async function runInit(args: CommandArgs): Promise<number> {
  const problems: string[] = [];
  const project = await readOrNull(path.join(args.root, 'context/project.yml'));
  if (project === null) problems.push('нет context/project.yml — разверни контракт v3');
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
      problems.push(`context/project.yml: невалидный YAML (${String(error)})`);
    }
  }
  const pkg = await readOrNull(path.join(args.root, 'package.json'));
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
  let wired = false;
  for (const rel of CONFIGS) {
    const text = await readOrNull(path.join(args.root, rel));
    if (text !== null && text.includes('@shahimat/oc3')) {
      wired = true;
      break;
    }
  }
  if (!wired)
    problems.push(
      'opencode.json(c): в plugins нет "@shahimat/oc3" — добавь запись и выполни /reload',
    );
  if (existsSync(path.join(args.root, '.ops/locks/install')))
    problems.push(
      'есть .ops/locks/install — установка не завершена: сними маркер в конце установки',
    );
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error('oc3 init: не готов');
    return 1;
  }
  console.log('oc3 init: ok — маркер, пакеты и плагин на месте');
  return 0;
}
