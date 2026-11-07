import { computeSync, type SyncResult } from '#lib/adapters/sync';
import { loadModelManifest } from '#lib/project-models';
import { loadConfig } from '#shared/config';

export async function computeModelPlan(root: string): Promise<SyncResult> {
  const manifest = await loadModelManifest(root);
  if (manifest === null) return { actions: [], diagnostics: [] };
  const config = await loadConfig(root);
  return computeSync(root, config?.adapters ?? []);
}
