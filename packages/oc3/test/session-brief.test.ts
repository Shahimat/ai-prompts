import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendBriefing, briefingLine, type BriefingSystem } from '#session-brief';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oc3-session-brief-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function putProject(text: string): Promise<void> {
  await mkdir(path.join(root, 'context'), { recursive: true });
  await writeFile(path.join(root, 'context', 'project.yml'), text, 'utf8');
}

describe('briefingLine', () => {
  it('режим из project.yml попадает в строку с отсылкой к skill workflow', async () => {
    await putProject('briefing:\n  mode: roles\n');
    const line = await briefingLine(root);
    expect(line.startsWith('брифинг:')).toBe(true);
    expect(line).toContain('режим roles');
    expect(line).toContain('до ролей и тикетов спроси схему работы');
    expect(line).toContain('skill workflow');
  });

  it('custom добавляет поля режима в скобках', async () => {
    await putProject('briefing:\n  mode: custom\n  routing: executor\n  judge: on\n');
    const line = await briefingLine(root);
    expect(line).toContain('режим custom');
    expect(line).toContain('routing: executor');
    expect(line).toContain('judge: on');
  });

  it('нет блока briefing — дежурная строка про дефолт cheap', async () => {
    await putProject('name: demo\nsummary: Демо\n');
    const line = await briefingLine(root);
    expect(line).toContain('режим не задан');
    expect(line).toContain('дефолт cheap');
    expect(line).toContain('до старта спроси схему');
    expect(line).toContain('oc3.briefing_done');
  });

  it('нет project.yml, битый yaml и не-строчный mode — дежурная строка', async () => {
    expect(await briefingLine(root)).toContain('режим не задан');
    await putProject('briefing: [unclosed');
    expect(await briefingLine(root)).toContain('режим не задан');
    await putProject('briefing:\n  mode: 5\n');
    expect(await briefingLine(root)).toContain('режим не задан');
  });

  it('строки ведут вызвать briefing_done после текстового ответа на вопрос схемы', async () => {
    await putProject('briefing:\n  mode: roles\n');
    const line = await briefingLine(root);
    expect(line).toContain(
      'спроси схему работы (дефолтная или кастомная; достаточно текстового ответа)',
    );
    expect(line.indexOf('схему работы')).toBeLessThan(line.indexOf('oc3.briefing_done'));
    expect(await briefingLine(root)).toContain('oc3.briefing_done');
    await putProject('name: demo\n');
    expect(await briefingLine(root)).toContain('достаточно текстового ответа');
  });
});

describe('appendBriefing', () => {
  it('строка попадает в системный промпт сессии один раз', async () => {
    await putProject('briefing:\n  mode: roles\n');
    const seen = new Set<string>();
    const first: BriefingSystem = {
      system: [{ type: 'text', text: 'базовый системный промпт' }],
    };
    await appendBriefing(first, root, seen, 's1');
    expect(first.system.length).toBe(2);
    expect(first.system.at(1)?.text).toContain('режим roles');
    const second: BriefingSystem = { system: [{ type: 'text', text: 'второй запрос' }] };
    await appendBriefing(second, root, seen, 's1');
    expect(second.system.length).toBe(1);
    const next: BriefingSystem = { system: [] };
    await appendBriefing(next, root, seen, 's2');
    expect(next.system.length).toBe(1);
    expect(next.system.at(0)?.text).toContain('режим roles');
  });

  it('без project.yml строка всё равно добавляется и сессия помечается', async () => {
    const seen = new Set<string>();
    const input: BriefingSystem = { system: [] };
    await appendBriefing(input, root, seen, 's1');
    expect(input.system.length).toBe(1);
    expect(input.system.at(0)?.text).toContain('дефолт cheap');
    expect(seen.has('s1')).toBe(true);
  });
});
