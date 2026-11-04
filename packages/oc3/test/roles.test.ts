import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InputError, isRecord } from '@shahimat/ai-core';
import { parse } from 'yaml';
import { ensureRoleAgents, ensureSkillsPreset, parseRoles } from '#install';
import { ROLE_AGENTS, ROLE_NAMES, skillsForRoles } from '#templates';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oc3-roles-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const put = async (rel: string, text: string): Promise<void> => {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, text, 'utf8');
};

const read = async (rel: string): Promise<string> => readFile(path.join(root, rel), 'utf8');

const skillsData = async (): Promise<Record<string, unknown>> => {
  const data: unknown = parse(await read('context/skills.yml'));
  if (!isRecord(data)) throw new Error('skills.yml не объект');
  return data;
};

const rolesOf = async (key: string): Promise<string[]> => {
  const data = await skillsData();
  const list = Array.isArray(data['skills']) ? data['skills'] : [];
  for (const item of list) {
    if (isRecord(item) && item['key'] === key && Array.isArray(item['roles']))
      return item['roles'].filter((role): role is string => typeof role === 'string');
  }
  throw new Error(`skills.yml: нет записи ${key}`);
};

const keysOf = async (): Promise<string[]> => {
  const data = await skillsData();
  const list = Array.isArray(data['skills']) ? data['skills'] : [];
  return list.map((item) => (isRecord(item) && typeof item['key'] === 'string' ? item['key'] : ''));
};

describe('parseRoles', () => {
  it('дефолтный список проходит, регистр и повторы срезаются', () => {
    expect(parseRoles('researcher,executor,judge,librarian')).toEqual(ROLE_NAMES);
    expect(parseRoles(' Executor , executor, judge')).toEqual(['executor', 'judge']);
  });

  it('watch-request/watch-triage — отказ с подсказкой contract-setup и watchers', () => {
    for (const role of ['watch-request', 'watch-triage']) {
      expect(() => parseRoles(`researcher,${role}`)).toThrow(InputError);
      expect(() => parseRoles(`researcher,${role}`)).toThrow(/watchers.*contract-setup/s);
    }
  });

  it('пустой список — отказ с перечнем встроенного набора', () => {
    expect(() => parseRoles('')).toThrow(InputError);
    expect(() => parseRoles('  ,  ')).toThrow(/researcher, executor, judge, librarian/);
  });

  it('неизвестная роль — отказ с перечнем встроенного набора', () => {
    expect(() => parseRoles('researcher,batman')).toThrow(/batman/);
    expect(() => parseRoles('researcher,batman')).toThrow(/researcher, executor, judge, librarian/);
  });
});

describe('skillsForRoles', () => {
  it('пресет фильтруется по выбранным ролям', () => {
    const only = skillsForRoles(['researcher']);
    const keys = only.map((entry) => entry.key);
    expect(keys).toEqual([
      'operator-feedback',
      'research',
      'domain',
      'manuals',
      'workflow',
      'contract-setup',
      'source-sync',
      'cli',
    ]);
    const domain = only.find((entry) => entry.key === 'domain');
    expect(domain?.roles).toEqual(['researcher']);
    const feedback = only.find((entry) => entry.key === 'operator-feedback');
    expect(feedback?.roles).toEqual(['operator']);
    const workflow = only.find((entry) => entry.key === 'workflow');
    expect(workflow?.roles).toEqual([]);
  });

  it('полный дефолт отдаёт domain и manuals всем четырём', () => {
    const all = skillsForRoles(ROLE_NAMES);
    expect(all.map((entry) => entry.key)).toEqual([
      'operator-feedback',
      'research',
      'executor',
      'judge',
      'librarian',
      'domain',
      'manuals',
      'workflow',
      'contract-setup',
      'source-sync',
      'cli',
    ]);
    expect(all.find((entry) => entry.key === 'domain')?.roles).toEqual([...ROLE_NAMES]);
    expect(all.find((entry) => entry.key === 'manuals')?.roles).toEqual([...ROLE_NAMES]);
  });
});

describe('ensureSkillsPreset', () => {
  it('нет файла — пресет по ролям записан, привязки соответствуют выбору', async () => {
    const lines = await ensureSkillsPreset(root, ['researcher']);
    expect(lines[0]).toContain('пресет operator-centric');
    expect(lines[0]).toContain('researcher');
    const text = await read('context/skills.yml');
    expect(text).toContain('# Сгенерировано oc3 init --roles');
    expect(await rolesOf('research')).toEqual(['researcher']);
    expect(await rolesOf('domain')).toEqual(['researcher']);
    expect(await rolesOf('workflow')).toEqual([]);
    expect(await rolesOf('operator-feedback')).toEqual(['operator']);
    expect(await keysOf()).not.toContain('judge');
    expect(await keysOf()).not.toContain('executor');
  });

  it('скелет skills: [] разворачивается в блочный список', async () => {
    await put('context/skills.yml', '# пусто\nskills: []\n');
    const lines = await ensureSkillsPreset(root, ['judge']);
    expect(lines[0]).toContain('дописаны привязки');
    const text = await read('context/skills.yml');
    expect(text).toContain('# пусто');
    expect(text).not.toContain('skills: []');
    expect(await rolesOf('judge')).toEqual(['judge']);
    expect(await rolesOf('domain')).toEqual(['judge']);
  });

  it('повторный запуск — merge: пользовательские записи и правки не перетираются', async () => {
    await put(
      'context/skills.yml',
      [
        '# мои привязки',
        'skills:',
        '  - key: research',
        '    kind: core',
        '    roles: [researcher, external-executor]',
        '  - key: life',
        '    kind: core',
        '    path: .agents/skills/life',
        '    roles: [researcher]',
      ].join('\n') + '\n',
    );
    const first = await ensureSkillsPreset(root, ['researcher']);
    expect(first[0]).toContain('дописаны привязки');
    const text = await read('context/skills.yml');
    expect(text).toContain('# мои привязки');
    expect(text).toContain('key: life');
    expect(text.match(/key: research/g)?.length).toBe(1);
    expect(await rolesOf('research')).toEqual(['researcher', 'external-executor']);
    expect(await rolesOf('manuals')).toEqual(['researcher']);
    const second = await ensureSkillsPreset(root, ['researcher']);
    expect(second[0]).toContain('на месте');
    expect((await read('context/skills.yml')).match(/key: domain/g)?.length).toBe(1);
  });

  it('второй прогон с расширенным списком добавляет только недостающее', async () => {
    await ensureSkillsPreset(root, ['researcher']);
    const before = await read('context/skills.yml');
    const lines = await ensureSkillsPreset(root, ROLE_NAMES);
    expect(lines[0]).toContain('дописаны привязки');
    expect(await read('context/skills.yml')).toContain('# Сгенерировано oc3 init --roles');
    expect(before).not.toContain('key: judge');
    expect(await rolesOf('judge')).toEqual(['judge']);
    expect(await rolesOf('executor')).toEqual(['executor']);
    expect(await rolesOf('librarian')).toEqual(['librarian']);
    expect(await rolesOf('domain')).toEqual([...ROLE_NAMES]);
    expect((await read('context/skills.yml')).match(/key: research/g)?.length).toBe(1);
  });

  it('битый YAML не переписывается', async () => {
    await put('context/skills.yml', 'skills: [unclosed\n');
    const lines = await ensureSkillsPreset(root, ['researcher']);
    expect(lines[0]).toContain('невалидный YAML');
    expect(await read('context/skills.yml')).toBe('skills: [unclosed\n');
  });

  it('старый каркас без списка skills перезаписывается пресетом', async () => {
    await put('context/skills.yml', 'roles: {}\n');
    const lines = await ensureSkillsPreset(root, ['executor']);
    expect(lines[0]).toContain('старый каркас');
    expect(await rolesOf('executor')).toEqual(['executor']);
    expect(await rolesOf('operator-feedback')).toEqual(['operator']);
  });
});

describe('ensureRoleAgents', () => {
  it('пишет снимки только выбранных ролей', async () => {
    const lines = await ensureRoleAgents(root, ['researcher', 'judge']);
    expect(lines.join(' ')).toContain('.agents/agents/researcher.md');
    expect(lines.join(' ')).toContain('.agents/agents/judge.md');
    expect(await read('.agents/agents/researcher.md')).toContain('name: researcher');
    expect(await read('.agents/agents/judge.md')).toContain('name: judge');
    await expect(read('.agents/agents/executor.md')).rejects.toThrow();
    await expect(read('.agents/agents/librarian.md')).rejects.toThrow();
  });

  it('повторный запуск не перетирает пользовательские правки', async () => {
    await ensureRoleAgents(root, ['executor']);
    await put('.agents/agents/executor.md', '---\nname: executor\n---\nмои правки\n');
    const lines = await ensureRoleAgents(root, ['executor']);
    expect(lines[0]).toContain('не перетираю');
    expect(await read('.agents/agents/executor.md')).toContain('мои правки');
  });
});

describe('снимки ролей', () => {
  it('frontmatter снимка совпадает с ролью, обязательные поля на месте', () => {
    for (const agent of ROLE_AGENTS) {
      expect(agent.body.startsWith('---\n')).toBe(true);
      const fm = agent.body.split('---')[1] ?? '';
      expect(fm).toContain(`name: ${agent.role}`);
      for (const field of ['kind', 'description', 'model', 'permissions', 'lifecycle', 'output'])
        expect(fm).toContain(field);
    }
  });

  it('watch-роли не встроены', () => {
    const roles = ROLE_AGENTS.map((agent) => agent.role);
    expect(roles).not.toContain('watch-request');
    expect(roles).not.toContain('watch-triage');
    expect(roles).toEqual([...ROLE_NAMES]);
  });
});
