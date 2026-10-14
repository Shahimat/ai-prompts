// Сборка пакета одной командой: чистый dist, tsc по tsconfig.build.json,
// исполняемые файлы из поля bin. Запуск из каталога пакета: node ../../build.ts

import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Файлы поля bin: строка или объект «команда → файл». */
function binFiles(bin: unknown): string[] {
  if (typeof bin === 'string') return [bin];
  if (!isRecord(bin)) return [];
  return Object.values(bin).filter((f): f is string => typeof f === 'string');
}

/** Исполняемый файл tsc: из поля bin пакета typescript, а не по пути внутри него. */
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
for (const file of binFiles(isRecord(pkg) ? pkg['bin'] : undefined)) chmodSync(file, 0o755);
