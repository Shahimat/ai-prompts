import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { errorCode, errorMessage, UsageError } from '@shahimat/ai-core';

export async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

export async function readYaml(file: string, where: string): Promise<unknown> {
  const text = await readText(file);
  if (text === undefined) return undefined;
  try {
    return parse(text);
  } catch (error) {
    throw new UsageError(`${where}: невалидный YAML: ${errorMessage(error).split('\n')[0] ?? ''}`);
  }
}

export async function readJson(file: string, where: string): Promise<unknown> {
  const text = await readText(file);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${where}: невалидный JSON: ${errorMessage(error)}`);
  }
}

export async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}

export const writeJson = (file: string, data: unknown): Promise<void> =>
  writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`);

export const writeYaml = (file: string, data: unknown): Promise<void> =>
  writeAtomic(file, stringify(data));

export async function appendLine(file: string, line: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${line}\n`, 'utf8');
}

export const remove = (file: string): Promise<void> => rm(file, { recursive: true, force: true });
