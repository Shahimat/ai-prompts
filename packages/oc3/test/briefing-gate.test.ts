import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ackPath, briefingGate, isBriefingAcked, markBriefingAcked } from '#briefing-gate';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oc3-briefing-gate-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('briefingGate', () => {
  it('до ack гейт отказывает bash/edit/write/subagent с указанием спросить схему и вызвать briefing_done', () => {
    for (const action of ['bash', 'edit', 'write', 'subagent']) {
      const message = briefingGate(action, false);
      expect(message).toContain('брифинг не проведён');
      expect(message).toContain('схему работы (дефолтная или кастомная)');
      expect(message).toContain('oc3.briefing_done');
    }
  });

  it('после ack работа разблокирована', () => {
    for (const action of ['bash', 'edit', 'write', 'subagent'])
      expect(briefingGate(action, true)).toBeUndefined();
  });

  it('read-инструменты не блокируются даже без ack', () => {
    expect(briefingGate('read', false)).toBeUndefined();
    expect(briefingGate('glob', false)).toBeUndefined();
    expect(briefingGate('grep', false)).toBeUndefined();
  });
});

describe('ack по sessionID', () => {
  it('mark пишет файл в .oc3/sessions, виден только своей сессии', async () => {
    expect(isBriefingAcked(root, 'ses_one')).toBe(false);
    const file = await markBriefingAcked(root, 'ses_one', new Date(0));
    expect(file.startsWith(path.join(root, '.oc3', 'sessions'))).toBe(true);
    expect(file.endsWith('ses_one.briefing')).toBe(true);
    expect(await readFile(file, 'utf8')).toContain('briefing_done');
    expect(isBriefingAcked(root, 'ses_one')).toBe(true);
    expect(isBriefingAcked(root, 'ses_two')).toBe(false);
    const sessions = path.join(root, '.oc3', 'sessions');
    expect((await readdir(sessions)).length).toBe(1);
    await markBriefingAcked(root, 'ses_two', new Date(0));
    expect((await readdir(sessions)).length).toBe(2);
  });

  it('некорректный sessionID не ack-ается и не уходит в путь', async () => {
    await expect(markBriefingAcked(root, '../escape', new Date())).rejects.toThrow(
      'sessionID некорректен',
    );
    expect(isBriefingAcked(root, '../escape')).toBe(false);
    expect(isBriefingAcked(root, 'ses_')).toBe(false);
  });

  it('ackPath кладёт файл рядом с submit-состоянием в .oc3', () => {
    expect(ackPath('/p', 'ses_x')).toBe(path.join('/p', '.oc3', 'sessions', 'ses_x.briefing'));
  });
});
