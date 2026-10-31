import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { errorCode, isRecord } from '@shahimat/ai-core';
import { appendLine, readJson, writeJson } from './files.ts';
import { machineFile, OPS_VERSION, projectKey } from './paths.ts';

export const EVENT_KINDS = [
  'question',
  'answered',
  'ready',
  'failed',
  'done',
  'feedback',
  'external',
  'request',
  'notify',
  'suggest',
  'rate-limit',
  'watch-stopped',
  'warn',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const IMPORTANT: readonly EventKind[] = [
  'question',
  'ready',
  'failed',
  'done',
  'feedback',
  'external',
  'request',
  'suggest',
  'rate-limit',
  'answered',
];

export interface OpsEvent {
  v: number;
  at: string;
  project: string;
  kind: EventKind;
  text: string;
  job?: string;
}

const eventsFile = (home: string): string => machineFile(home, 'events.jsonl');
const cursorFile = (home: string, key: string): string =>
  machineFile(home, 'cursors', `${key}.json`);

export async function emit(
  home: string,
  root: string,
  kind: EventKind,
  text: string,
  job?: string,
): Promise<OpsEvent> {
  const event: OpsEvent = {
    v: OPS_VERSION,
    at: new Date().toISOString(),
    project: path.resolve(root),
    kind,
    text,
  };
  if (job !== undefined) event.job = job;
  await appendLine(eventsFile(home), JSON.stringify(event));
  return event;
}

function isEvent(v: unknown): v is OpsEvent {
  return (
    isRecord(v) &&
    v['v'] === OPS_VERSION &&
    typeof v['at'] === 'string' &&
    typeof v['project'] === 'string' &&
    typeof v['kind'] === 'string' &&
    EVENT_KINDS.some((k) => k === v['kind']) &&
    typeof v['text'] === 'string' &&
    (v['job'] === undefined || typeof v['job'] === 'string')
  );
}

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 0;
    throw error;
  }
}

export async function readEvents(
  home: string,
  from: number,
): Promise<{ events: OpsEvent[]; end: number }> {
  const file = eventsFile(home);
  const end = await sizeOf(file);
  if (end <= from) return { events: [], end: Math.max(end, 0) };
  const handle = await open(file, 'r');
  try {
    const buf = Buffer.alloc(end - from);
    await handle.read(buf, 0, buf.length, from);
    const events: OpsEvent[] = [];
    for (const line of buf.toString('utf8').split('\n')) {
      if (line.trim() === '') continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (isEvent(parsed)) events.push(parsed);
      } catch {
        continue;
      }
    }
    return { events, end };
  } finally {
    await handle.close();
  }
}

export const cursorKey = (root: string, all: boolean): string => (all ? 'all' : projectKey(root));

export async function readCursor(home: string, key: string): Promise<number> {
  const data = await readJson(cursorFile(home, key), `cursors/${key}.json`);
  return isRecord(data) && typeof data['offset'] === 'number' ? data['offset'] : 0;
}

export const writeCursor = (home: string, key: string, offset: number): Promise<void> =>
  writeJson(cursorFile(home, key), { v: OPS_VERSION, offset });

export const forProject = (events: readonly OpsEvent[], root: string, all: boolean): OpsEvent[] =>
  all ? [...events] : events.filter((e) => e.project === path.resolve(root));

export const eventLine = (e: OpsEvent, all: boolean): string =>
  `${e.at.slice(11, 16)} ${e.kind}${e.job === undefined ? '' : ` ${e.job}`}${all ? ` [${path.basename(e.project)}]` : ''} — ${e.text}`;
