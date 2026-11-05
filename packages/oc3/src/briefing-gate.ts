import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from '@opencode/plugin';
import { isOneOf } from '@shahimat/ai-core';

const SESSION_PATTERN = /^[A-Za-z0-9._-]+$/;
const ACK_SUFFIX = '.briefing';
const GATED = ['bash', 'edit', 'write', 'subagent'] as const;
const GATE_MESSAGE =
  'брифинг не проведён — спроси: дефолт проекта или кастом на сессию, затем вызови oc3.briefing_done';

export function briefingGate(action: string, acked: boolean): string | undefined {
  if (acked) return undefined;
  if (!isOneOf(GATED, action)) return undefined;
  return GATE_MESSAGE;
}

export function ackPath(root: string, sessionID: string): string {
  return path.join(root, '.oc3', 'sessions', `${sessionID}${ACK_SUFFIX}`);
}

export function isBriefingAcked(root: string, sessionID: string): boolean {
  if (!SESSION_PATTERN.test(sessionID)) return false;
  return existsSync(ackPath(root, sessionID));
}

export async function markBriefingAcked(
  root: string,
  sessionID: string,
  now: Date,
): Promise<string> {
  if (!SESSION_PATTERN.test(sessionID))
    throw new Error(`briefing_done: sessionID некорректен: ${sessionID}`);
  const file = ackPath(root, sessionID);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `briefing_done ${now.toISOString()}\n`, 'utf8');
  return file;
}

const isOperatorSession = async (
  session: Plugin.Context['session'],
  primary: Map<string, boolean>,
  sessionID: string,
): Promise<boolean> => {
  const cached = primary.get(sessionID);
  if (cached !== undefined) return cached;
  let value = false;
  try {
    const info = await session.get({ sessionID });
    value = info.parentID === undefined;
  } catch {
    value = false;
  }
  primary.set(sessionID, value);
  return value;
};

export async function registerBriefingGate(ctx: Plugin.Context): Promise<void> {
  const root = ctx.location.directory;
  const primary = new Map<string, boolean>();
  await ctx.permission.hook('evaluate', async (event) => {
    if (!isOneOf(GATED, event.action)) return;
    if (!(await isOperatorSession(ctx.session, primary, event.sessionID))) return;
    if (isBriefingAcked(root, event.sessionID)) return;
    event.effect = 'deny';
    event.message = GATE_MESSAGE;
  });
}
