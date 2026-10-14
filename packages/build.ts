import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function binFiles(bin: unknown): string[] {
  if (typeof bin === 'string') return [bin];
  if (!isRecord(bin)) return [];
  return Object.values(bin).filter((f): f is string => typeof f === 'string');
}

function tscBin(): string {
  const manifest = createRequire(path.resolve('package.json')).resolve('typescript/package.json');
  const ts: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
  const bin = isRecord(ts) && isRecord(ts['bin']) ? ts['bin']['tsc'] : undefined;
  if (typeof bin !== 'string') throw new Error(`${manifest}: нет bin.tsc`);
  return path.join(path.dirname(manifest), bin);
}

const pkg: unknown = JSON.parse(readFileSync('package.json', 'utf8'));
rmSync('dist', { recursive: true, force: true });
const tsc = tscBin();
const { status } = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], {
  stdio: 'inherit',
});
if (status !== 0) process.exit(status ?? 1);
if (existsSync('src'))
  cpSync('src', 'dist', {
    recursive: true,
    filter: (src) => !src.endsWith('.ts'),
  });
for (const file of binFiles(isRecord(pkg) ? pkg['bin'] : undefined)) chmodSync(file, 0o755);
