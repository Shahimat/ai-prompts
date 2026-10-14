// Загрузка определения harness: harness.yaml, criteria.yaml, реестр
// действий с плагинами пользователя и статическая проверка графа.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from '../../shared/diagnostics.ts';
import { errorMessage } from '../../shared/guards.ts';
import { parseMachine, staticErrors, type MachineDef, type Registry } from '../core/index.ts';
import { parseCriteria, type Criterion } from './plan/criteria.ts';
import { FORMAL_CRITERIA } from './plan/formal.ts';
import { harnessExists, harnessFile } from '../core/index.ts';
import { loadPlugins } from '../core/index.ts';
import { planIterRegistry, type PlanContext } from './actions.ts';

export interface LoadedHarness {
  name: string;
  def: MachineDef;
  criteria: Criterion[];
  registry: Registry<PlanContext>;
  plugins: string[];
}

export interface LoadResult {
  harness?: LoadedHarness;
  /** Ошибки с путём до поля; пусто — определение пригодно. */
  errors: string[];
}

/** Определение категории plan: встроенный реестр plan/iter и плагины. */
export async function loadHarness(home: string, name: string): Promise<LoadResult> {
  if (!harnessExists(home, name)) throw new UsageError(`нет harness ${name}`);
  const where = (rel: string) => path.relative(home, harnessFile(home, name, rel)) || rel;
  const yamlPath = harnessFile(home, name, 'harness.yaml');
  const parsed = parseMachine(await readFile(yamlPath, 'utf8'), where('harness.yaml'));
  if (parsed.def === undefined) return { errors: parsed.errors };

  let criteria: Criterion[];
  const criteriaPath = harnessFile(home, name, 'criteria.yaml');
  try {
    criteria = parseCriteria(await readFile(criteriaPath, 'utf8'), where('criteria.yaml'));
  } catch (error) {
    return { errors: [errorMessage(error)] };
  }
  const errors: string[] = [];
  for (const c of criteria)
    if (c.stage === '1a' && !FORMAL_CRITERIA.some((f) => f === c.id))
      errors.push(
        `${where('criteria.yaml')}: критерий 1a ${c.id} не реализован скриптом (${FORMAL_CRITERIA.join(', ')})`,
      );

  const registry = planIterRegistry();
  let plugins: string[] = [];
  try {
    plugins = await loadPlugins(registry, path.join(home, 'harnesses', name, 'handlers'));
  } catch (error) {
    errors.push(errorMessage(error));
  }
  errors.push(...staticErrors(parsed.def, registry, where('harness.yaml')));
  if (errors.length > 0) return { errors };
  return { harness: { name, def: parsed.def, criteria, registry, plugins }, errors: [] };
}

export async function loadHarnessOrFail(home: string, name: string): Promise<LoadedHarness> {
  const result = await loadHarness(home, name);
  if (result.harness === undefined) throw new UsageError(result.errors.join('\n'));
  return result.harness;
}
