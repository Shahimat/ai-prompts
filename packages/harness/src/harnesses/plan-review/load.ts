// Загрузка plan-review: общий автомат ядра и критерии ревью criteria.yaml.

import { readFile } from 'node:fs/promises';
import { UsageError } from '../../shared/diagnostics.ts';
import { errorMessage } from '../../shared/guards.ts';
import {
  definitionWhere,
  harnessFile,
  loadMachine,
  type MachineDef,
  type Registry,
} from '../core/index.ts';
import { planReviewRegistry, type PlanContext } from './actions.ts';
import { parseCriteria, type Criterion } from './plan/criteria.ts';
import { FORMAL_CRITERIA } from './plan/formal.ts';

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

async function loadCriteria(
  home: string,
  name: string,
): Promise<{ criteria: Criterion[]; errors: string[] }> {
  const where = definitionWhere(home, name, 'criteria.yaml');
  let criteria: Criterion[];
  try {
    criteria = parseCriteria(
      await readFile(harnessFile(home, name, 'criteria.yaml'), 'utf8'),
      where,
    );
  } catch (error) {
    return { criteria: [], errors: [errorMessage(error)] };
  }
  const errors = criteria
    .filter((c) => c.stage === '1a' && !FORMAL_CRITERIA.some((f) => f === c.id))
    .map(
      (c) => `${where}: критерий 1a ${c.id} не реализован скриптом (${FORMAL_CRITERIA.join(', ')})`,
    );
  return { criteria, errors };
}

/** Определение категории plan: встроенный реестр plan-review, плагины и критерии. */
export async function loadHarness(home: string, name: string): Promise<LoadResult> {
  const { criteria, errors } = await loadCriteria(home, name);
  const loaded = await loadMachine(home, name, planReviewRegistry());
  const all = [...errors, ...loaded.errors];
  if (loaded.machine === undefined || all.length > 0) return { errors: all };
  return { harness: { ...loaded.machine, criteria }, errors: [] };
}

export async function loadHarnessOrFail(home: string, name: string): Promise<LoadedHarness> {
  const result = await loadHarness(home, name);
  if (result.harness === undefined) throw new UsageError(result.errors.join('\n'));
  return result.harness;
}
