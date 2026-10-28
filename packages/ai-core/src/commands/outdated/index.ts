import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from '#shared/diagnostics';
import { errorCode, isRecord } from '#shared/guards';
import type { CommandArgs } from '#shared/args';

export const PACKAGES = ['@shahimat/ai-core', '@shahimat/harness'] as const;
const registryOf = (pkg: string): string => `https://registry.npmjs.org/${pkg.replace('/', '%2f')}`;
const changelogOf = (pkg: string): string =>
  `https://raw.githubusercontent.com/Shahimat/ai-prompts/main/packages/${pkg.split('/')[1] ?? ''}/CHANGELOG.md`;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10));
  const pb = b.split('.').map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function changelogBetween(changelog: string, from: string, to: string): string[] {
  const sections = changelog.replace(/\r\n?/g, '\n').split(/^## /m).slice(1);
  return sections
    .map((s) => ({
      version: s.split('\n')[0]?.trim() ?? '',
      body: s.split('\n').slice(1).join('\n').trim(),
    }))
    .filter((s) => compareVersions(s.version, from) > 0 && compareVersions(s.version, to) <= 0)
    .map((s) => `${s.version}\n${s.body}`);
}

export interface Fetcher {
  (url: string): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
}

export async function projectVersions(root: string): Promise<Map<string, string>> {
  let text: string;
  try {
    text = await readFile(path.join(root, 'package.json'), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT')
      throw new UsageError('нет package.json: пакеты ставятся в devDependencies проекта');
    throw error;
  }
  const data: unknown = JSON.parse(text);
  const deps = (key: string): Record<string, unknown> => {
    const v = isRecord(data) ? data[key] : undefined;
    return isRecord(v) ? v : {};
  };
  const all = { ...deps('dependencies'), ...deps('devDependencies') };
  const versions = new Map<string, string>();
  for (const pkg of PACKAGES) {
    const v = all[pkg];
    if (typeof v === 'string') versions.set(pkg, v.replace(/^[\^~=]/, ''));
  }
  if (!versions.has('@shahimat/ai-core'))
    throw new UsageError('нет @shahimat/ai-core в devDependencies package.json');
  return versions;
}

export async function runOutdated(args: CommandArgs, fetcher: Fetcher = fetch): Promise<number> {
  let code = 0;
  for (const [pkg, current] of await projectVersions(args.root)) {
    const meta = await fetcher(registryOf(pkg));
    if (!meta.ok) throw new Error(`npm: ${pkg} — HTTP ${meta.status}`);
    const data: unknown = JSON.parse(await meta.text());
    const tags = isRecord(data) ? data['dist-tags'] : undefined;
    const latest = isRecord(tags) ? tags['latest'] : undefined;
    if (typeof latest !== 'string') throw new Error(`npm: у ${pkg} нет dist-tag latest`);
    if (compareVersions(current, latest) >= 0) {
      console.log(`${pkg}: ${current} — актуальная версия`);
      continue;
    }
    code = 1;
    console.log(`${pkg}: ${current} → ${latest}`);
    const log = await fetcher(changelogOf(pkg));
    if (log.ok) {
      for (const entry of changelogBetween(await log.text(), current, latest))
        console.log(`\n${entry}`);
    } else {
      console.log('журнал изменений недоступен');
    }
  }
  return code;
}
