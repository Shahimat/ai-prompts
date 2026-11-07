import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadModelManifest, resolveProjectModel, validateModelManifest } from '#lib/project-models';
import { computeModelPlan } from '#lib/model-plan';
import { computeSync, checkAdapters } from '#lib/adapters/sync';
import { runModels } from '#commands/models/index';

let root: string;
const base = 'openai/test';
const manifest = (roles: Record<string, string> = {}): string =>
  JSON.stringify({ version: 1, default: base, roles });
const role = (name: string, model = 'legacy/model'): string =>
  `---\nname: ${name}\ndescription: Тестовая роль\nmodel: ${model}\noutput: result\n---\n\nИнструкции ${name}.\n`;
async function put(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}
const args = (): { root: string; now: Date } => ({ root, now: new Date() });

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'project-models-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('project model manifest', () => {
  it('helper > role > default, variants, custom IDs, isolated roots and legacy', async () => {
    expect(await resolveProjectModel(root, 'judge', 'legacy/model')).toEqual({
      model: 'legacy/model',
      origin: 'legacy',
    });
    await put(
      'manifest.json',
      manifest({ judge: 'openai/base#high', 'expect.judge': 'openai/helper#low' }),
    );
    expect((await resolveProjectModel(root, 'judge', 'legacy/model', 'expect.judge')).model).toBe(
      'openai/helper#low',
    );
    expect(
      (await resolveProjectModel(root, 'judge', 'legacy/model', 'plan-review.judge')).model,
    ).toBe('openai/base#high');
    expect((await resolveProjectModel(root, 'plan-review.judge', 'legacy/model')).model).toBe(
      'openai/base#high',
    );
    expect((await resolveProjectModel(root, 'custom', 'legacy/model')).model).toBe(base);
    expect((await resolveProjectModel(root, 'constructor', 'legacy/model')).model).toBe(base);
    expect(
      (await resolveProjectModel(path.join(root, 'other'), 'judge', 'legacy/model')).model,
    ).toBe('legacy/model');
  });

  it('invalid JSON, versions, shape, empty or invalid models fail before writes', async () => {
    for (const value of [
      null,
      {},
      { version: 2, default: base, roles: {} },
      { version: 1, default: '', roles: {} },
      { version: 1, default: base, roles: { judge: 'opus' } },
      { version: 1, default: base, roles: [], extra: true },
    ])
      expect(() => validateModelManifest(value)).toThrow('manifest.json');
    await put('manifest.json', '{broken');
    await expect(loadModelManifest(root)).rejects.toThrow('JSON');
    await expect(runModels('apply', args())).rejects.toThrow('JSON');
    expect(await readFile(path.join(root, 'manifest.json'), 'utf8')).toBe('{broken');
  });

  it('set native/helper/custom IDs only writes manifest and derived, preserving both canonical trees', async () => {
    await put('manifest.json', manifest());
    await put('agents/judge.md', role('judge'));
    await put('.agents/agents/custom.md', role('custom'));
    await put('.oc3/project.yml', 'name: test\nroles: {exceptions: []}\n');
    for (const id of ['general', 'expect.judge', 'custom'])
      expect(
        await runModels('set', { ...args(), params: { role: id, model: 'openai/override#max' } }),
      ).toBe(0);
    expect(await readFile(path.join(root, 'agents/judge.md'), 'utf8')).toBe(role('judge'));
    expect(await readFile(path.join(root, '.agents/agents/custom.md'), 'utf8')).toBe(
      role('custom'),
    );
    expect(await readFile(path.join(root, '.oc3/project.yml'), 'utf8')).toBe(
      'name: test\nroles: {exceptions: []}\n',
    );
    expect(await readFile(path.join(root, '.opencode/agents/custom.md'), 'utf8')).toContain(
      'model: openai/override#max',
    );
    expect(await readFile(path.join(root, '.opencode/opencode.jsonc'), 'utf8')).not.toContain(
      'expect.judge',
    );
    expect(await runModels('list', args())).toBe(0);
  });

  it('apply is idempotent; read-only check detects drift; adapters and models plans agree even disabled', async () => {
    await put('manifest.json', manifest());
    await put('agents/judge.md', role('judge'));
    const before = await computeModelPlan(root);
    expect(before).toEqual(await computeSync(root, []));
    expect(await runModels('apply', args())).toBe(0);
    expect((await computeModelPlan(root)).actions).toEqual([]);
    expect(await checkAdapters(root, [])).toEqual([]);
    expect(await runModels('apply', args())).toBe(0);
    const original = await readFile(path.join(root, '.opencode/agents/judge.md'), 'utf8');
    const drift = original.replace('model: openai/test', 'model: old/model');
    await put('.opencode/agents/judge.md', drift);
    expect(await runModels('check', args())).toBe(1);
    expect(await readFile(path.join(root, '.opencode/agents/judge.md'), 'utf8')).toBe(drift);
    expect((await computeModelPlan(root)).actions).toEqual((await computeSync(root, [])).actions);
  });

  it('preserves operator, builtin permissions, foreign keys, custom agents and memory deny across override removal and source sync', async () => {
    await put('manifest.json', manifest({ judge: 'openai/override' }));
    await put('agents/judge.md', role('judge'));
    await put('.opencode/agents/operator.md', '---\nmode: primary\n---\n\nМой оператор.\n');
    await put(
      '.opencode/opencode.jsonc',
      JSON.stringify({
        plugins: ['mine'],
        agents: {
          operator: { mode: 'primary', system: 'prompt' },
          general: { permissions: [{ action: 'edit', resource: '*', effect: 'deny' }] },
          mine: { system: 'keep', model: 'old/model' },
        },
        permissions: [{ action: 'read', resource: '*', effect: 'allow' }],
      }),
    );
    expect(await runModels('apply', args())).toBe(0);
    await put('manifest.json', manifest());
    await put('agents/judge.md', role('judge', 'source/synced'));
    expect(await runModels('apply', args())).toBe(0);
    const text = await readFile(path.join(root, '.opencode/opencode.jsonc'), 'utf8');
    expect(text).toContain('"primary"');
    expect(text).toContain('"prompt"');
    expect(text).toContain('"keep"');
    expect(text).toContain('"mine"');
    expect(text).toContain('"*memory*"');
    expect(text).toContain('"read"');
    expect(text).toContain('"edit"');
    expect(text).not.toContain('old/model');
    expect(await readFile(path.join(root, '.opencode/agents/operator.md'), 'utf8')).toContain(
      'Мой оператор.',
    );
    expect(await readFile(path.join(root, '.opencode/agents/judge.md'), 'utf8')).toContain(
      'model: openai/test',
    );
    expect(await readFile(path.join(root, 'agents/judge.md'), 'utf8')).toBe(
      role('judge', 'source/synced'),
    );
  });

  it('diagnoses ignored stale legacy overrides instead of merging them', async () => {
    await put('manifest.json', manifest());
    await put('.oc3/project.yml', 'roles:\n  models:\n    judge: legacy/override\n');
    expect(
      (await computeModelPlan(root)).diagnostics.some((d) =>
        d.message.includes('legacy roles.models игнорируются'),
      ),
    ).toBe(true);
    expect((await resolveProjectModel(root, 'judge', 'legacy/model')).model).toBe(base);
  });
});
