import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '@shahimat/ai-core';
import { artifactKey, errorCode, isRecord, machineArtifactPath } from '@shahimat/ai-core';

export function harnessHome(option?: string): string {
  const fromEnv = process.env['HARNESS_HOME'];
  if (option !== undefined) return path.resolve(option);
  if (fromEnv !== undefined && fromEnv !== '') return path.resolve(fromEnv);
  return path.join(homedir(), '.config', 'harness');
}

export const BUILTIN_HARNESSES = path.dirname(
  fileURLToPath(import.meta.resolve('#harnesses/index')),
);

export function harnessFile(home: string, harness: string, rel: string): string {
  const own = path.join(home, 'harnesses', harness, rel);
  return existsSync(own) ? own : path.join(BUILTIN_HARNESSES, harness, rel);
}

export async function listHarnesses(home: string): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of [BUILTIN_HARNESSES, path.join(home, 'harnesses')]) {
    try {
      for (const e of await readdir(dir, { withFileTypes: true }))
        if (e.isDirectory() && e.name !== 'core') names.add(e.name);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
  }
  return [...names].sort();
}

export const harnessExists = (home: string, harness: string): boolean =>
  existsSync(path.join(BUILTIN_HARNESSES, harness, 'harness.yaml')) ||
  existsSync(path.join(home, 'harnesses', harness, 'harness.yaml'));

export interface SessionData {
  storage_scope?: 'machine';
  id: string;
  harness: string;
  project: string;
  title: string;
  request: string;
  created: string;
  state: string;
  counters: Record<string, number>;
  plannerSession?: string;
  stageTask?: string;
  pendingQuestion?: string;
  handoff?: string;
  planFile?: string;
  taskPacket?: string;
}

export function parseSession(text: string, where: string): SessionData {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data)) throw new UsageError(`${where}: корень должен быть объектом`);
  const str = (key: string): string => {
    const v = data[key];
    if (typeof v !== 'string') throw new UsageError(`${where}: ${key} должно быть строкой`);
    return v;
  };
  const counters: Record<string, number> = {};
  const rawCounters = data['counters'];
  if (isRecord(rawCounters))
    for (const [k, v] of Object.entries(rawCounters)) if (typeof v === 'number') counters[k] = v;
  const session: SessionData = {
    id: str('id'),
    harness: str('harness'),
    project: str('project'),
    title: str('title'),
    request: str('request'),
    created: str('created'),
    state: str('state'),
    counters,
  };
  if (typeof data['plannerSession'] === 'string') session.plannerSession = data['plannerSession'];
  if (typeof data['stageTask'] === 'string') session.stageTask = data['stageTask'];
  if (typeof data['pendingQuestion'] === 'string')
    session.pendingQuestion = data['pendingQuestion'];
  if (typeof data['handoff'] === 'string') session.handoff = data['handoff'];
  if (typeof data['planFile'] === 'string') session.planFile = data['planFile'];
  if (typeof data['taskPacket'] === 'string') session.taskPacket = data['taskPacket'];
  return session;
}

export class Session {
  readonly dir: string;
  private readonly home: string;
  data: SessionData;

  constructor(dir: string, data: SessionData, home = dir) {
    this.dir = dir;
    this.home = home;
    this.data = { ...data, storage_scope: 'machine' };
  }

  get id(): string {
    return this.data.id;
  }

  get short(): string {
    return this.data.id.slice(0, SHORT_ID);
  }

  file(rel: string): string {
    const prefix = path.relative(this.home, this.dir).split(path.sep).join('/');
    const file = machineArtifactPath({ kind: 'machine', home: this.dir }, rel);
    machineArtifactPath(
      { kind: 'machine', home: this.home },
      prefix === '' ? rel : `${prefix}/${rel}`,
    );
    return file;
  }

  async save(): Promise<void> {
    await writeFile(this.file('session.json'), `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
  }

  async log(entry: Record<string, unknown>): Promise<void> {
    await appendFile(
      this.file('log.jsonl'),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      'utf8',
    );
  }
}

export const sessionsDir = (home: string): string =>
  machineArtifactPath({ kind: 'machine', home }, 'sessions');
const sessionDir = (home: string, id: string): string =>
  machineArtifactPath({ kind: 'machine', home }, `sessions/${artifactKey(id)}`);

export const SHORT_ID = 7;
const MIN_PREFIX = 4;

export interface NewSession {
  harness: string;
  title: string;
  request: string;
  project: string;
  initial: string;
  now: Date;
}

export async function createSession(home: string, opts: NewSession): Promise<Session> {
  const salt = randomBytes(16).toString('hex');
  const id = createHash('sha256')
    .update(`${opts.harness}\n${opts.now.toISOString()}\n${salt}`)
    .digest('hex');
  const dir = sessionDir(home, id);
  await mkdir(dir, { recursive: true });
  const session = new Session(
    dir,
    {
      id,
      harness: opts.harness,
      project: opts.project,
      title: opts.title,
      request: opts.request,
      created: opts.now.toISOString(),
      state: opts.initial,
      counters: {},
    },
    home,
  );
  await session.save();
  await session.log({ event: 'start', to: opts.initial });
  return session;
}

export async function openSession(home: string, id: string): Promise<Session> {
  const dir = sessionDir(home, id);
  let text: string;
  try {
    text = await readFile(
      machineArtifactPath({ kind: 'machine', home: dir }, 'session.json'),
      'utf8',
    );
  } catch (error) {
    if (errorCode(error) === 'ENOENT')
      throw new UsageError(`нет сессии ${id} в ${sessionsDir(home)}`);
    throw error;
  }
  const data = parseSession(text, `${id}/session.json`);
  if (data.id !== id) throw new Error('SESSION_ID_MISMATCH');
  return new Session(dir, data, home);
}

export async function resolveSession(
  home: string,
  prefix: string,
  harness?: string,
): Promise<Session> {
  if (!new RegExp(`^[0-9a-f]{${MIN_PREFIX},64}$`).test(prefix))
    throw new UsageError(`id сессии — hex от ${MIN_PREFIX} символов: ${prefix}`);
  let names: string[] = [];
  try {
    names = (await readdir(sessionsDir(home))).filter((n) => n.startsWith(prefix));
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  if (names.length === 0) throw new UsageError(`нет сессии ${prefix} в ${sessionsDir(home)}`);
  if (names.length > 1)
    throw new UsageError(
      `id ${prefix} неоднозначен: ${names.map((n) => n.slice(0, SHORT_ID + 2)).join(', ')}`,
    );
  const session = await openSession(home, names[0] ?? '');
  if (harness !== undefined && session.data.harness !== harness)
    throw new UsageError(
      `сессия ${session.short} принадлежит ${session.data.harness}, не ${harness}`,
    );
  return session;
}

export async function listSessions(home: string): Promise<Session[]> {
  let names: string[];
  try {
    names = (await readdir(sessionsDir(home), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  const sessions: Session[] = [];
  for (const name of names) {
    if (
      existsSync(
        machineArtifactPath({ kind: 'machine', home: sessionDir(home, name) }, 'session.json'),
      )
    )
      sessions.push(await openSession(home, name));
  }
  return sessions;
}

export async function activityOf(session: Session): Promise<Date> {
  const created = new Date(session.data.created);
  const fallback = Number.isNaN(created.getTime()) ? new Date(0) : created;
  try {
    const text = await readFile(session.file('log.jsonl'), 'utf8');
    const last = text
      .split('\n')
      .filter((l) => l !== '')
      .at(-1);
    if (last === undefined) return fallback;
    const entry: unknown = JSON.parse(last);
    if (!isRecord(entry) || typeof entry['at'] !== 'string') return fallback;
    const at = new Date(entry['at']);
    return Number.isNaN(at.getTime()) ? fallback : at;
  } catch (error) {
    if (error instanceof SyntaxError) return fallback;
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  return fallback;
}

export interface StaleSession {
  session: Session;
  last: Date;
}

export const DEFAULT_STALE_DAYS = 7;

export function staleDays(argsDays: string | undefined): number {
  if (argsDays !== undefined) {
    const n = Number.parseFloat(argsDays);
    if (!Number.isFinite(n) || n < 0) throw new UsageError(`--days — число дней: ${argsDays}`);
    return n;
  }
  const raw = process.env['HARNESS_STALE_DAYS'];
  const n = raw === undefined ? Number.NaN : Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_STALE_DAYS;
}

export async function staleSessions(home: string, days: number): Promise<StaleSession[]> {
  const threshold = Date.now() - days * 86_400_000;
  const out: StaleSession[] = [];
  for (const session of await listSessions(home)) {
    const last = await activityOf(session);
    if (last.getTime() < threshold) out.push({ session, last });
  }
  return out.sort((a, b) => a.last.getTime() - b.last.getTime());
}
