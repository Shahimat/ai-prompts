import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { main } from '#cli';
import { OC3_TREE } from '#tree';

const PROJECT = [
  'name: demo',
  'summary: Демо-проект для проверки брифинга оператора',
  'sync:',
  '  index_source: https://example.com/index.yml',
  '  contract:',
  '    key: agent-operational-contract-v3',
  '',
].join('\n');

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'oc3-briefing-'));
  await mkdir(path.join(root, 'context'), { recursive: true });
  await writeFile(path.join(root, 'context/project.yml'), PROJECT, 'utf8');
  return root;
}

describe('briefing', () => {
  it('дерево знает show и set пресетов с полями custom', () => {
    expect(OC3_TREE.findCommand(['briefing'])).toBeDefined();
    expect(OC3_TREE.findCommand(['briefing', 'set', 'cheap'])).toBeDefined();
    expect(
      OC3_TREE.findCommand(['briefing', 'set', 'custom', 'executor', 'researcher', 'on', 'stop']),
    ).toBeDefined();
  });

  it('set cheap пишет пресет перед sync, show его показывает', async () => {
    const root = await project();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)));
    try {
      expect(await main(['briefing', 'set', 'cheap', '--root', root])).toBe(0);
      const text = await readFile(path.join(root, 'context/project.yml'), 'utf8');
      expect(text).toContain('briefing:\n  mode: cheap\n\nsync:');
      expect(await main(['briefing', '--root', root])).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(logs.join('\n')).toContain('mode: cheap');
  });

  it('set custom пишет поля, повторный set заменяет блок', async () => {
    const root = await project();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)));
    try {
      expect(
        await main([
          'briefing',
          'set',
          'custom',
          'executor',
          'researcher',
          'on',
          'all',
          '--root',
          root,
        ]),
      ).toBe(0);
      expect(await main(['briefing', 'set', 'roles', '--root', root])).toBe(0);
      const text = await readFile(path.join(root, 'context/project.yml'), 'utf8');
      expect(text).toContain('mode: roles');
      expect(text).not.toContain('ticket_mode');
    } finally {
      spy.mockRestore();
    }
    expect(logs.join('\n')).toContain('briefing → roles');
  });

  it('custom без полей и чужой режим — ошибки, project.yml не тронут', async () => {
    const root = await project();
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line) => errors.push(String(line)));
    try {
      expect(await main(['briefing', 'set', 'custom', '--root', root])).toBe(2);
      expect(await main(['briefing', 'set', 'free', '--root', root])).toBe(2);
      expect(await main(['briefing', 'set', 'cheap', 'executor', '--root', root])).toBe(2);
    } finally {
      spy.mockRestore();
    }
    const text = await readFile(path.join(root, 'context/project.yml'), 'utf8');
    expect(text).not.toContain('briefing');
    expect(errors.join('\n')).toContain('routing — operator | executor');
    expect(errors.join('\n')).toContain('режим вне списка');
  });

  it('нет project.yml — ошибка установки', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oc3-briefing-empty-'));
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line) => errors.push(String(line)));
    try {
      expect(await main(['briefing', '--root', root])).toBe(2);
    } finally {
      spy.mockRestore();
    }
    expect(errors.join('\n')).toContain('нет context/project.yml');
  });
});
