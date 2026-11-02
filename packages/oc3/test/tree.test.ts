import { describe, expect, it } from 'vitest';
import { main } from '#cli';
import { OC3_TREE } from '#tree';

describe('oc3 tree', () => {
  it('потребительский срез: models, goals, operator, roles, skills, adapters, expect report, init', () => {
    expect(OC3_TREE.findCommand(['models'])).toBeDefined();
    expect(OC3_TREE.findCommand(['models', 'set', 'judge', 'zai/glm-5.3#max'])).toBeDefined();
    expect(OC3_TREE.findCommand(['goals', 'check', 'goals/a.expect.ts'])).toBeDefined();
    expect(OC3_TREE.findCommand(['goals', 'status'])).toBeDefined();
    expect(OC3_TREE.findCommand(['operator', 'state', 'check'])).toBeDefined();
    expect(OC3_TREE.findCommand(['adapters', 'sync'])).toBeDefined();
    expect(OC3_TREE.findCommand(['init'])).toBeDefined();
  });

  it('инструменты источника не попадают в срез', () => {
    expect(OC3_TREE.findCommand(['index', 'build'])).toBeUndefined();
    expect(OC3_TREE.findCommand(['role', 'run', 'judge'])).toBeUndefined();
    expect(OC3_TREE.findCommand(['secrets', 'scan'])).toBeUndefined();
    expect(OC3_TREE.findCommand(['expect', 'judge', 'a.ts'])).toBeUndefined();
  });

  it('bin знает команды и уровни', async () => {
    expect(await main(['init', '--root', '/nonexistent-project'])).toBe(1);
    expect(OC3_TREE.childrenOf([])).toContain('models');
    expect(OC3_TREE.childrenOf([])).toContain('goals');
  });
});
