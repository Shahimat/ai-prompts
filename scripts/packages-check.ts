import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const REGISTRY = 'https://registry.npmjs.org/';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const compare = (a: string, b: string): number => {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10));
  const pb = b.split('.').map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
};

interface Package {
  name: string;
  version: string;
  file: string;
  deps: Record<string, string>;
  publishable: boolean;
}

const readPackage = async (dir: string): Promise<Package> => {
  const file = path.join('packages', dir, 'package.json');
  const data: unknown = JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
  const section = (key: string): Record<string, string> => {
    const value = isRecord(data) ? data[key] : undefined;
    const out: Record<string, string> = {};
    if (isRecord(value))
      for (const [name, spec] of Object.entries(value))
        if (typeof spec === 'string') out[name] = spec;
    return out;
  };
  const name = isRecord(data) && typeof data['name'] === 'string' ? data['name'] : '';
  const version = isRecord(data) && typeof data['version'] === 'string' ? data['version'] : '';
  if (name === '' || version === '') throw new Error(`${file}: нет name или version`);
  return {
    name,
    version,
    file,
    deps: { ...section('dependencies'), ...section('devDependencies'), ...section('peerDependencies') },
    publishable: isRecord(data) && isRecord(data['publishConfig']),
  };
};

const crits: string[] = [];
const warns: string[] = [];

const dirs = (
  await readdir(path.join(ROOT, 'packages'), { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .sort();

const packages = await Promise.all(dirs.map(readPackage));
const versions = new Map(packages.map((pkg) => [pkg.name, pkg.version] as const));

for (const pkg of packages) {
  for (const [dep, spec] of Object.entries(pkg.deps)) {
    const current = versions.get(dep);
    if (current === undefined) continue;
    if (/^\d/.test(spec)) {
      if (spec !== current)
        crits.push(
          `${pkg.file}: пин ${dep} ${spec} ≠ текущей ${current} — подними вместе с версией`,
        );
      continue;
    }
    const base = spec.replace(/^[\^~>=<\s]+/, '');
    if (base !== '' && compare(base, current) > 0)
      crits.push(`${pkg.file}: диапазон ${dep} ${spec} выше текущей ${current}`);
  }
}

for (const pkg of packages.filter((p) => p.publishable)) {
  try {
    const response = await fetch(`${REGISTRY}${pkg.name.replace('/', '%2f')}`);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    const data: unknown = await response.json();
    const tags = isRecord(data) ? data['dist-tags'] : undefined;
    const latest = isRecord(tags) && typeof tags['latest'] === 'string' ? tags['latest'] : '';
    if (latest === '') throw new Error('нет dist-tag latest');
    if (compare(pkg.version, latest) > 0)
      warns.push(
        `⚠ требуется публикация ${pkg.name}@${pkg.version} (npm: ${latest}) — процедура: design/packages.md → «Релиз»`,
      );
    else if (compare(pkg.version, latest) < 0)
      crits.push(`${pkg.name}: в npm ${latest} новее локальной ${pkg.version} — релиз без коммита`);
    else console.log(`${pkg.name}: ${pkg.version} — опубликовано`);
  } catch (error) {
    warns.push(`⚠ npm недоступен — публикация ${pkg.name} не проверена (${String(error)})`);
  }
}

for (const line of crits) console.error(`✗ ${line}`);
for (const line of warns) console.warn(line);
console.log(`пакетов ${packages.length}: критичных ${crits.length} · предупреждений ${warns.length}`);
process.exit(crits.length > 0 ? 1 : 0);
