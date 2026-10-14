// Сессии и артефакты harness в user scope: `~/.config/harness/`
// (переопределяется `--home` или HARNESS_HOME). В проект попадает только
// то, что выгрузили командой clone.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../../../shared/diagnostics.ts';
import { errorCode, isOneOf, isRecord, isStringArray } from '../../../shared/guards.ts';

export function harnessHome(option?: string): string {
  const fromEnv = process.env['HARNESS_HOME'];
  if (option !== undefined) return path.resolve(option);
  if (fromEnv !== undefined && fromEnv !== '') return path.resolve(fromEnv);
  return path.join(homedir(), '.config', 'harness');
}

/** Встроенные определения лежат рядом с кодом: `harnesses/<имя>/harness.yaml`. */
export const BUILTIN_HARNESSES = fileURLToPath(new URL('../../', import.meta.url));

/** Файл определения: вариант пользователя перекрывает встроенный. */
export function harnessFile(home: string, harness: string, rel: string): string {
  const own = path.join(home, 'harnesses', harness, rel);
  return existsSync(own) ? own : path.join(BUILTIN_HARNESSES, harness, rel);
}

/** Процессы: встроенные и пользовательские, без повторов. */
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

export type FixInput =
  | { source: 'review'; round: number }
  | { source: 'user'; mode: 'revise' | 'rework'; items: string[]; comment: string };

export interface SessionData {
  id: string;
  /** Имя процесса: `plan-review`. */
  harness: string;
  /** Абсолютный путь проекта, из которого запущен start. */
  project: string;
  title: string;
  request: string;
  created: string;
  state: string;
  counters: Record<string, number>;
  /** Сессия Claude Code для `--resume` при провале 1a: планер или последний исправитель. */
  plannerSession?: string;
  /** Номер последнего раунда ревью. */
  round: number;
  /** Первый раунд текущего цикла ревью — для справки о провале. */
  cycleStart: number;
  fix?: FixInput;
  question?: string;
  /** Hook отпустил планера после предела блокировок. */
  formalExhausted?: boolean;
  /** Состояние, в котором агенту выдано задание: resume продолжает с него. */
  handoff?: string;
}

function parseFix(value: unknown): FixInput | undefined {
  if (!isRecord(value)) return undefined;
  if (value['source'] === 'review' && typeof value['round'] === 'number')
    return { source: 'review', round: value['round'] };
  const { mode, items, comment } = value;
  if (
    value['source'] === 'user' &&
    isOneOf(['revise', 'rework'], mode) &&
    isStringArray(items) &&
    typeof comment === 'string'
  )
    return { source: 'user', mode, items, comment };
  return undefined;
}

export function parseSession(text: string, where: string): SessionData {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data)) throw new UsageError(`${where}: корень должен быть объектом`);
  const str = (key: string): string => {
    const v = data[key];
    if (typeof v !== 'string') throw new UsageError(`${where}: ${key} должно быть строкой`);
    return v;
  };
  const num = (key: string): number => {
    const v = data[key];
    if (typeof v !== 'number') throw new UsageError(`${where}: ${key} должно быть числом`);
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
    round: num('round'),
    cycleStart: num('cycleStart'),
  };
  if (typeof data['plannerSession'] === 'string') session.plannerSession = data['plannerSession'];
  const fix = parseFix(data['fix']);
  if (fix !== undefined) session.fix = fix;
  if (typeof data['question'] === 'string') session.question = data['question'];
  if (data['formalExhausted'] === true) session.formalExhausted = true;
  if (typeof data['handoff'] === 'string') session.handoff = data['handoff'];
  return session;
}

export class Session {
  readonly dir: string;
  data: SessionData;

  constructor(dir: string, data: SessionData) {
    this.dir = dir;
    this.data = data;
  }

  get id(): string {
    return this.data.id;
  }

  /** Короткий id для вывода и команд, как у коммитов git. */
  get short(): string {
    return this.data.id.slice(0, SHORT_ID);
  }

  file(rel: string): string {
    return path.join(this.dir, rel);
  }

  get planPath(): string {
    return this.file('plan.md');
  }

  get contextPath(): string {
    return this.file('context.md');
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

  async readPlan(): Promise<string | undefined> {
    try {
      return await readFile(this.planPath, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return undefined;
      throw error;
    }
  }
}

export const sessionsDir = (home: string): string => path.join(home, 'sessions');

/** Длина короткого id в выводе и минимальный префикс в командах. */
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
  // id — sha256: уникален без знания других сессий, короткий префикс читается как у git.
  const salt = randomBytes(16).toString('hex');
  const id = createHash('sha256')
    .update(`${opts.harness}\n${opts.now.toISOString()}\n${salt}`)
    .digest('hex');
  const dir = path.join(sessionsDir(home), id);
  await mkdir(dir, { recursive: true });
  const session = new Session(dir, {
    id,
    harness: opts.harness,
    project: opts.project,
    title: opts.title,
    request: opts.request,
    created: opts.now.toISOString(),
    state: opts.initial,
    counters: {},
    round: 0,
    cycleStart: 1,
  });
  await session.save();
  await writeFile(
    session.contextPath,
    `# Контекст: ${opts.title}\n\n## Запрос\n\n${opts.request}\n`,
    'utf8',
  );
  await session.log({ event: 'start', to: opts.initial });
  return session;
}

export async function openSession(home: string, id: string): Promise<Session> {
  const dir = path.join(sessionsDir(home), id);
  let text: string;
  try {
    text = await readFile(path.join(dir, 'session.json'), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT')
      throw new UsageError(`нет сессии ${id} в ${sessionsDir(home)}`);
    throw error;
  }
  return new Session(dir, parseSession(text, `${id}/session.json`));
}

/**
 * Сессия по префиксу id (от 4 символов): ни одной или несколько — ошибка
 * вызова; `harness` — сессия должна принадлежать этому harness.
 */
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
    if (existsSync(path.join(sessionsDir(home), name, 'session.json')))
      sessions.push(await openSession(home, name));
  }
  return sessions;
}
