import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isRecord } from '@shahimat/ai-core';
import { appendBridgeEvent, plannerGuard, readBridge } from '#plan-bridge';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oc3-plan-bridge-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const bridgeOf = async (): Promise<{
  root: string;
  events: string;
  plan: string;
  report: string;
}> => {
  const events = path.join(root, '.oc3/sessions/plan-review', 's1', 'planner-events.jsonl');
  const plan = 'plans/демо.expect.ts';
  const report = 'ai expect report plans/демо.expect.ts --root .';
  await mkdir(path.join(root, '.oc3/sessions/plan-review'), { recursive: true });
  await writeFile(
    path.join(root, '.oc3/sessions/plan-review/bridge.json'),
    `${JSON.stringify({ root, events, plan, report }, null, 2)}\n`,
    'utf8',
  );
  return { root, events, plan, report };
};

describe('readBridge', () => {
  it('foreign record.root is rejected by the reader and guard without appending events', async () => {
    const bridge = await bridgeOf();
    await mkdir(path.dirname(bridge.events), { recursive: true });
    await writeFile(bridge.events, 'unchanged sentinel\n');
    const foreign = { ...bridge, root: path.join(root, 'foreign-root') };
    await writeFile(
      path.join(root, '.oc3/sessions/plan-review/bridge.json'),
      JSON.stringify(foreign),
    );
    expect(await readBridge(root)).toBeUndefined();
    await expect(plannerGuard('edit', [bridge.plan], foreign, root)).rejects.toThrow(
      'ARTIFACT_SCOPE_MISMATCH',
    );
    await expect(plannerGuard('bash', [bridge.report], foreign, root)).rejects.toThrow(
      'ARTIFACT_SCOPE_MISMATCH',
    );
    expect(await readFile(bridge.events, 'utf8')).toBe('unchanged sentinel\n');
  });
  it.each(['final', 'ancestor'])(
    'symlink events %s is rejected by the reader and guard with target bytes unchanged',
    async (kind) => {
      const bridge = await bridgeOf();
      const targetDir = path.join(root, 'sentinel-events');
      await mkdir(targetDir);
      const target = path.join(targetDir, 'planner-events.jsonl');
      await writeFile(target, 'unchanged symlink sentinel\n');
      if (kind === 'final') {
        await mkdir(path.dirname(bridge.events), { recursive: true });
        await symlink(target, bridge.events);
      } else await symlink(targetDir, path.dirname(bridge.events));
      await expect(readBridge(root)).rejects.toThrow('ARTIFACT_SYMLINK');
      await expect(plannerGuard('edit', [bridge.plan], bridge, root)).rejects.toThrow(
        'ARTIFACT_SYMLINK',
      );
      await expect(plannerGuard('bash', [bridge.report], bridge, root)).rejects.toThrow(
        'ARTIFACT_SYMLINK',
      );
      expect(await readFile(target, 'utf8')).toBe('unchanged symlink sentinel\n');
    },
  );
  it('мост без файла или с неполными полями не поднимается', async () => {
    expect(await readBridge(root)).toBeUndefined();
    await mkdir(path.dirname(path.join(root, '.oc3/sessions/plan-review/bridge.json')), {
      recursive: true,
    });
    await writeFile(path.join(root, '.oc3/sessions/plan-review/bridge.json'), '{}');
    expect(await readBridge(root)).toBeUndefined();
    const bridge = await bridgeOf();
    expect(await readBridge(root)).toEqual(bridge);
  });
});

describe('plannerGuard', () => {
  it('правка файла ожиданий разрешается и попадает в события, чужая — отказ', async () => {
    const bridge = await bridgeOf();
    expect(await plannerGuard('edit', [bridge.plan], bridge, root)).toBeUndefined();
    expect(await plannerGuard('write', [bridge.plan], bridge, root)).toBeUndefined();
    const lines = (await readFile(bridge.events, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(JSON.parse(line)).toMatchObject({ kind: 'edit' });
    const denial = await plannerGuard('edit', ['README.md'], bridge, root);
    expect(denial).toContain('только файл ожиданий');
    expect(await plannerGuard('edit', [bridge.plan, 'README.md'], bridge, root)).toContain(
      'только файл ожиданий',
    );
    expect((await readFile(bridge.events, 'utf8')).trim().split('\n')).toHaveLength(2);
  });

  it('Bash — только команда отчёта; прочие действия мост не трогает', async () => {
    const bridge = await bridgeOf();
    expect(await plannerGuard('bash', [bridge.report], bridge, root)).toBeUndefined();
    expect(await plannerGuard('shell', [`  ${bridge.report}  `], bridge, root)).toBeUndefined();
    const denial = await plannerGuard('bash', ['ls -la'], bridge, root);
    expect(denial).toContain('только команда отчёта');
    expect(await plannerGuard('read', [bridge.plan], bridge, root)).toBeUndefined();
    const lines = (await readFile(bridge.events, 'utf8')).trim().split('\n');
    const events = lines.flatMap((l) => {
      const data: unknown = JSON.parse(l);
      return isRecord(data) ? [data] : [];
    });
    expect(events.filter((e) => e['kind'] === 'bash')).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ kind: 'bash', command: 'ls -la', allowed: false });
  });

  it('путь файла ожиданий сравнивается по абсолютному пути', async () => {
    const bridge = await bridgeOf();
    const abs = path.resolve(root, bridge.plan);
    expect(await plannerGuard('edit', [abs], bridge, root)).toBeUndefined();
    expect(await plannerGuard('edit', [`./${bridge.plan}`], bridge, root)).toBeUndefined();
  });
});

describe('appendBridgeEvent', () => {
  it('события пишутся построчно с отметкой времени', async () => {
    const bridge = await bridgeOf();
    await appendBridgeEvent(bridge, { kind: 'prompt', text: 'запрос' });
    await appendBridgeEvent(bridge, { kind: 'edit', path: bridge.plan });
    const lines = (await readFile(bridge.events, 'utf8')).trim().split('\n');
    const parsed = lines.flatMap((l) => {
      const data: unknown = JSON.parse(l);
      return isRecord(data) ? [data] : [];
    });
    expect(parsed[0]).toMatchObject({ kind: 'prompt', text: 'запрос' });
    expect(typeof parsed[1]?.['at']).toBe('string');
  });
});
