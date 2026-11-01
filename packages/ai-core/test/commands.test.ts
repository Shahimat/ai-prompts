import { describe, expect, it } from 'vitest';
import { COMMAND_NODES } from '@shahimat/ai-core';

describe('команды операторского контракта', () => {
  it('дерево содержит goals, roles, skills и operator state', () => {
    expect(COMMAND_NODES.map((node) => node.path)).toEqual(
      expect.arrayContaining([
        ['goals', 'check', '<file>'],
        ['goals', 'status'],
        ['goals', 'status', '<file>'],
        ['roles', 'check'],
        ['skills', 'check'],
        ['operator', 'state', 'check'],
      ]),
    );
  });

  it('команды целей и ролей — query, без записи', () => {
    for (const path of [
      'goals check <file>',
      'goals status <file>',
      'roles check',
      'skills check',
      'operator state check',
    ]) {
      const node = COMMAND_NODES.find((n) => n.path.join(' ') === path);
      expect({ path, effect: node?.effect }).toEqual({ path, effect: 'query' });
    }
  });
});
