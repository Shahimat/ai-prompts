import { loadConfig, CONFIG_PATH } from '#shared/config';
import { UsageError } from '#shared/diagnostics';
import { isRecord } from '#shared/guards';
import type { CommandArgs } from '#shared/args';

const PACKAGE = '@shahimat/ai-core';
const REGISTRY = `https://registry.npmjs.org/${PACKAGE.replace('/', '%2f')}`;
const CHANGELOG_URL =
  'https://raw.githubusercontent.com/Shahimat/ai-prompts/main/packages/ai-core/CHANGELOG.md';

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

export async function runOutdated(args: CommandArgs, fetcher: Fetcher = fetch): Promise<number> {
  const config = await loadConfig(args.root);
  if (config?.version === undefined) throw new UsageError(`нет version в ${CONFIG_PATH}`);
  const meta = await fetcher(REGISTRY);
  if (!meta.ok) throw new Error(`npm: ${PACKAGE} — HTTP ${meta.status}`);
  const data: unknown = JSON.parse(await meta.text());
  const tags = isRecord(data) ? data['dist-tags'] : undefined;
  const latest = isRecord(tags) ? tags['latest'] : undefined;
  if (typeof latest !== 'string') throw new Error(`npm: у ${PACKAGE} нет dist-tag latest`);

  if (compareVersions(config.version, latest) >= 0) {
    console.log(`harness: ${config.version} — актуальная версия`);
    return 0;
  }
  console.log(`harness: ${config.version} → ${latest}`);
  const log = await fetcher(CHANGELOG_URL);
  if (log.ok) {
    for (const entry of changelogBetween(await log.text(), config.version, latest))
      console.log(`\n${entry}`);
  } else {
    console.log('журнал изменений недоступен');
  }
  return 1;
}
