import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '@shahimat/cli';
import { ROLE_MODEL_PATTERN, runModels } from '@shahimat/ai-core';

const ROLE = (model: string): string =>
  [
    '---',
    'name: judge',
    'kind: core',
    'description: Судья для проверки',
    'model: ' + model,
    'output: verdict',
    '---',
    '',
    'Ты — judge.',
    '',
  ].join('\n');

describe('models', () => {
  it('set меняет model в источнике и производной копии', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-models-'));
    await mkdir(path.join(root, '.agents/agents'), { recursive: true });
    await mkdir(path.join(root, '.opencode/agents'), { recursive: true });
    await writeFile(
      path.join(root, '.agents/agents/judge.md'),
      ROLE('zai/glm-5.3-flashx#low'),
      'utf8',
    );
    await writeFile(
      path.join(root, '.opencode/agents/judge.md'),
      ROLE('zai/glm-5.3-flashx#low'),
      'utf8',
    );
    const code = await runModels('set', {
      root,
      now: new Date(),
      params: { role: 'judge', model: 'zai/glm-5.3#low' },
    });
    expect(code).toBe(0);
    expect(await readFile(path.join(root, '.agents/agents/judge.md'), 'utf8')).toContain(
      'model: zai/glm-5.3#low',
    );
    expect(await readFile(path.join(root, '.opencode/agents/judge.md'), 'utf8')).toContain(
      'model: zai/glm-5.3#low',
    );
  });

  it('models set через дерево CLI', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-models-'));
    await mkdir(path.join(root, '.agents/agents'), { recursive: true });
    await writeFile(
      path.join(root, '.agents/agents/judge.md'),
      ROLE('zai/glm-5.3-flashx#low'),
      'utf8',
    );
    const code = await main(['models', 'set', 'judge', 'zai/glm-5.3#low', '--root', root]);
    expect(code).toBe(0);
    expect(await readFile(path.join(root, '.agents/agents/judge.md'), 'utf8')).toContain(
      'model: zai/glm-5.3#low',
    );
  });

  it('set отклоняет модель вне семейства и несуществующую роль', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-models-'));
    await expect(
      runModels('set', { root, now: new Date(), params: { role: 'judge', model: 'free/model' } }),
    ).rejects.toThrow('семейства');
    await expect(
      runModels('set', {
        root,
        now: new Date(),
        params: { role: 'judge', model: 'zai/glm-5.3#low' },
      }),
    ).rejects.toThrow('не найдена');
  });

  it('паттерн модели допускает семейство glm-5.3 (zai, zai-coding-plan) и запрещает остальное', () => {
    expect(ROLE_MODEL_PATTERN.test('zai/glm-5.3#max')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('zai/glm-5.3#high')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('zai/glm-5.3-flash#max')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('zai/glm-5.3-flashx#low')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('zai-coding-plan/glm-5.3#max')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('zai-coding-plan/glm-5.3-flash#max')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('zai-coding-plan/glm-5.3-flash#low')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('deepseek/deepseek-flash#max')).toBe(false);
    expect(ROLE_MODEL_PATTERN.test('zai/glm-4.7#max')).toBe(false);
    expect(ROLE_MODEL_PATTERN.test('zai-coding-plan/glm-4.7#low')).toBe(false);
    expect(ROLE_MODEL_PATTERN.test('opus')).toBe(false);
  });
});
