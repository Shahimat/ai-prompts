import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from '@shahimat/ai-core';
import { errorMessage } from '@shahimat/ai-core';
import { parseMachine, staticErrors, type MachineDef, type Registry } from './fsm/machine.ts';
import { loadPlugins } from './plugins.ts';
import { harnessExists, harnessFile } from './store/session.ts';

export interface LoadedMachine<C> {
  name: string;
  def: MachineDef;
  registry: Registry<C>;
  plugins: string[];
}

export interface MachineResult<C> {
  machine?: LoadedMachine<C>;
  errors: string[];
}

export const definitionWhere = (home: string, name: string, rel: string): string =>
  path
    .relative(home, harnessFile(home, name, rel))
    .split(path.sep)
    .join('/') || rel;

export async function loadMachine<C>(
  home: string,
  name: string,
  registry: Registry<C>,
): Promise<MachineResult<C>> {
  if (!harnessExists(home, name)) throw new UsageError(`нет harness ${name}`);
  const where = definitionWhere(home, name, 'harness.yaml');
  const parsed = parseMachine(
    await readFile(harnessFile(home, name, 'harness.yaml'), 'utf8'),
    where,
  );
  if (parsed.def === undefined) return { errors: parsed.errors };
  const errors: string[] = [];
  let plugins: string[] = [];
  try {
    plugins = await loadPlugins(registry, path.join(home, 'harnesses', name, 'handlers'));
  } catch (error) {
    errors.push(errorMessage(error));
  }
  errors.push(...staticErrors(parsed.def, registry, where));
  if (errors.length > 0) return { errors };
  return { machine: { name, def: parsed.def, registry, plugins }, errors: [] };
}
