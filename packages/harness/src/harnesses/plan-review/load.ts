import { UsageError } from '@shahimat/ai-core';
import { loadMachine, type MachineDef, type Registry } from '#harnesses/core/index';
import { planReviewRegistry, type PlanContext } from './actions.ts';

export interface LoadedHarness {
  name: string;
  def: MachineDef;
  registry: Registry<PlanContext>;
  plugins: string[];
}

export interface LoadResult {
  harness?: LoadedHarness;
  errors: string[];
}

export async function loadHarness(home: string, name: string): Promise<LoadResult> {
  const loaded = await loadMachine(home, name, planReviewRegistry());
  if (loaded.machine === undefined) return { errors: loaded.errors };
  return { harness: loaded.machine, errors: [] };
}

export async function loadHarnessOrFail(home: string, name: string): Promise<LoadedHarness> {
  const result = await loadHarness(home, name);
  if (result.harness === undefined) throw new UsageError(result.errors.join('\n'));
  return result.harness;
}
