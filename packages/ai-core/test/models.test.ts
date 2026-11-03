import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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

const PROJECT = (roles: string): string =>
  `name: demo\nsummary: тест\n${roles}\nsync:\n  index_source: https://example.com/index.yml\n`;

async function putProject(root: string, roles: string): Promise<void> {
  await mkdir(path.join(root, 'context'), { recursive: true });
  await writeFile(path.join(root, 'context/project.yml'), PROJECT(roles), 'utf8');
}

describe('models', () => {
  it('set меняет model в источнике и производной копии и пишет override в project.yml', async () => {
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
    await putProject(root, 'roles:\n  exceptions: []');
    const code = await runModels('set', {
      root,
      now: new Date(),
      params: { role: 'judge', model: 'deepseek/deepseek-v4-pro#max' },
    });
    expect(code).toBe(0);
    expect(await readFile(path.join(root, '.agents/agents/judge.md'), 'utf8')).toContain(
      'model: deepseek/deepseek-v4-pro#max',
    );
    expect(await readFile(path.join(root, '.opencode/agents/judge.md'), 'utf8')).toContain(
      'model: deepseek/deepseek-v4-pro#max',
    );
    const project = await readFile(path.join(root, 'context/project.yml'), 'utf8');
    expect(project).toContain('  models:\n    judge: deepseek/deepseek-v4-pro#max');
    expect(project).toContain('  exceptions: []');
  });

  it('повторный set заменяет строку override, а не добавляет новую', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-models-'));
    await mkdir(path.join(root, '.agents/agents'), { recursive: true });
    await writeFile(path.join(root, '.agents/agents/judge.md'), ROLE('zai/glm-5.3#max'), 'utf8');
    await putProject(root, 'roles:\n  exceptions: []');
    for (const model of ['deepseek/deepseek-flash', 'ollama/qwen3:14b']) {
      const code = await runModels('set', {
        root,
        now: new Date(),
        params: { role: 'judge', model },
      });
      expect(code).toBe(0);
    }
    const project = await readFile(path.join(root, 'context/project.yml'), 'utf8');
    expect(project.match(/^    judge: .*/gm)).toEqual(['    judge: ollama/qwen3:14b']);
  });

  it('set без roles в project.yml вставляет блок перед sync', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-models-'));
    await mkdir(path.join(root, '.agents/agents'), { recursive: true });
    await writeFile(path.join(root, '.agents/agents/judge.md'), ROLE('zai/glm-5.3#max'), 'utf8');
    await putProject(root, '');
    const code = await runModels('set', {
      root,
      now: new Date(),
      params: { role: 'judge', model: 'opencode/glm-5.3-flash-free#high' },
    });
    expect(code).toBe(0);
    const project = await readFile(path.join(root, 'context/project.yml'), 'utf8');
    expect(project).toContain(
      'roles:\n  models:\n    judge: opencode/glm-5.3-flash-free#high\n\nsync:',
    );
  });

  it('set обновляет inline roles, сохраняя flow-вид', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-models-'));
    await mkdir(path.join(root, '.agents/agents'), { recursive: true });
    await writeFile(path.join(root, '.agents/agents/judge.md'), ROLE('zai/glm-5.3#max'), 'utf8');
    await putProject(root, 'roles: {exceptions: []}');
    const code = await runModels('set', {
      root,
      now: new Date(),
      params: { role: 'judge', model: 'deepseek/deepseek-flash#max' },
    });
    expect(code).toBe(0);
    const project = await readFile(path.join(root, 'context/project.yml'), 'utf8');
    expect(project).toContain(
      'roles: { exceptions: [], models: { judge: deepseek/deepseek-flash#max } }',
    );
    await putProject(root, 'roles: {exceptions: []}');
    await runModels('set', {
      root,
      now: new Date(),
      params: { role: 'judge', model: 'ollama/qwen3:14b' },
    });
    const updated = await readFile(path.join(root, 'context/project.yml'), 'utf8');
    expect(updated).toContain('roles: { exceptions: [], models: { judge: ollama/qwen3:14b } }');
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

  it('models apply через дерево CLI восстанавливает override', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-models-'));
    await mkdir(path.join(root, '.agents/agents'), { recursive: true });
    await writeFile(
      path.join(root, '.agents/agents/judge.md'),
      ROLE('zai-coding-plan/glm-5.3-flash#low'),
      'utf8',
    );
    await putProject(root, 'roles:\n  models:\n    judge: zai/glm-5.3-flashx#low');
    const code = await main(['models', 'apply', '--root', root]);
    expect(code).toBe(0);
    expect(await readFile(path.join(root, '.agents/agents/judge.md'), 'utf8')).toContain(
      'model: zai/glm-5.3-flashx#low',
    );
  });

  it('set отклоняет модель вне формата и несуществующую роль', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-models-'));
    for (const model of ['opus', '/lead', 'zai/', 'zai/glm #max'])
      await expect(
        runModels('set', { root, now: new Date(), params: { role: 'judge', model } }),
      ).rejects.toThrow('формата');
    await putProject(root, '');
    await mkdir(path.join(root, '.agents/agents'), { recursive: true });
    await expect(
      runModels('set', {
        root,
        now: new Date(),
        params: { role: 'judge', model: 'zai/glm-5.3#low' },
      }),
    ).rejects.toThrow('не найдена');
  });

  it('list помечает провайдера, override и расхождение с project.yml', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-models-'));
    await mkdir(path.join(root, 'agents'), { recursive: true });
    await writeFile(
      path.join(root, 'agents/executor.md'),
      ROLE('zai-coding-plan/glm-5.3#max'),
      'utf8',
    );
    await writeFile(path.join(root, 'agents/judge.md'), ROLE('zai/glm-5.3-flashx#low'), 'utf8');
    await writeFile(path.join(root, 'agents/librarian.md'), ROLE('zai/glm-5.3#max'), 'utf8');
    await putProject(
      root,
      'roles:\n  models:\n    judge: deepseek/deepseek-v4-pro\n    librarian: zai/glm-5.3#max',
    );
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)));
    try {
      const code = await runModels('list', { root, now: new Date(), params: {} });
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(logs).toContain('executor: zai-coding-plan/glm-5.3#max (план)');
    expect(logs).toContain(
      'judge: zai/glm-5.3-flashx#low (платный API, override: deepseek/deepseek-v4-pro — прогони models apply)',
    );
    expect(logs).toContain('librarian: zai/glm-5.3#max (платный API, override)');
  });

  it('apply восстанавливает модели из project.yml и пропускает отсутствующие роли', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-models-'));
    await mkdir(path.join(root, '.agents/agents'), { recursive: true });
    await mkdir(path.join(root, '.opencode/agents'), { recursive: true });
    await writeFile(
      path.join(root, '.agents/agents/judge.md'),
      ROLE('zai-coding-plan/glm-5.3-flash#low'),
      'utf8',
    );
    await writeFile(
      path.join(root, '.opencode/agents/judge.md'),
      ROLE('zai-coding-plan/glm-5.3-flash#low'),
      'utf8',
    );
    await putProject(
      root,
      'roles:\n  models:\n    judge: zai/glm-5.3-flashx#low\n    executor: zai/glm-5.3#max',
    );
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)));
    try {
      const code = await runModels('apply', { root, now: new Date(), params: {} });
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(await readFile(path.join(root, '.agents/agents/judge.md'), 'utf8')).toContain(
      'model: zai/glm-5.3-flashx#low',
    );
    expect(await readFile(path.join(root, '.opencode/agents/judge.md'), 'utf8')).toContain(
      'model: zai/glm-5.3-flashx#low',
    );
    expect(logs.some((line) => line.startsWith('judge: model → zai/glm-5.3-flashx#low'))).toBe(
      true,
    );
    expect(logs.some((line) => line.startsWith('executor:'))).toBe(true);
    expect(logs.at(-1)).toContain('применено 1/2');
  });

  it('apply без override — ничего не делает', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-models-'));
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)));
    try {
      const code = await runModels('apply', { root, now: new Date(), params: {} });
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(logs).toContain('override нет — context/project.yml → roles.models');
  });

  it('паттерн модели допускает любые модели каталога OpenCode и запрещает прочее', () => {
    expect(ROLE_MODEL_PATTERN.test('zai/glm-5.3#max')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('zai/glm-5.3-flash#max')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('zai-coding-plan/glm-5.3-flash#low')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('deepseek/deepseek-flash#max')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('deepseek/deepseek-v4-pro')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('ollama/qwen3:14b')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('opencode/glm-5.3-flash-free#high')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('openrouter/anthropic/claude-sonnet-5.5#high')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('zai/glm-4.5-air#thinking')).toBe(true);
    expect(ROLE_MODEL_PATTERN.test('opus')).toBe(false);
    expect(ROLE_MODEL_PATTERN.test('/lead')).toBe(false);
    expect(ROLE_MODEL_PATTERN.test('zai/')).toBe(false);
    expect(ROLE_MODEL_PATTERN.test('zai/glm #max')).toBe(false);
  });
});
