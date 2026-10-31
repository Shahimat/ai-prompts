import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { errorCode, errorMessage, isRecord, runtime, UsageError } from '@shahimat/ai-core';
import { listSessions } from '#harnesses/core/store/session';
import { loadAutonomy, loadOpsConfig } from './config.ts';
import { emit } from './events.ts';
import { readYaml, remove, writeAtomic, writeYaml } from './files.ts';
import { addFeedback, JOB_HARNESS, markExternal } from './jobs.ts';
import { cached, loadRegistry } from './machine.ts';
import { hashOf, OPS_VERSION, posixRelative, projectFile, watchesDir } from './paths.ts';
import {
  asSnapshot,
  callRead,
  callWrite,
  loadProvider,
  providerContext,
  type Snapshot,
  type WatchItem,
} from './providers.ts';
import { opsRole, PRIORITY } from './runner.ts';

export const WATCH_INTERFACES = ['review', 'checks'] as const;
export type WatchInterface = (typeof WATCH_INTERFACES)[number];
export const UNTIL = ['merged', 'closed', 'done', 'job-done'] as const;
export type Until = (typeof UNTIL)[number];
export const DEFAULT_EVERY_MIN = 5;
export const TRIAGE_ROLE = 'watch-triage';
export const REQUEST_ROLE = 'watch-request';

export interface Watch {
  v: number;
  id: string;
  interface: WatchInterface;
  query: string;
  every: number;
  until?: Until;
  job?: string;
  next: string;
  fingerprint?: string;
  items?: WatchItem[];
}

const watchFile = (root: string, id: string): string => path.join(watchesDir(root), `${id}.yml`);

const isItem = (v: unknown): v is WatchItem =>
  isRecord(v) &&
  typeof v['id'] === 'string' &&
  typeof v['state'] === 'string' &&
  typeof v['summary'] === 'string';

function asWatch(data: unknown, where: string): Watch {
  if (
    !isRecord(data) ||
    typeof data['id'] !== 'string' ||
    !WATCH_INTERFACES.some((i) => i === data['interface']) ||
    typeof data['query'] !== 'string' ||
    typeof data['every'] !== 'number' ||
    typeof data['next'] !== 'string'
  )
    throw new UsageError(`${where}: наблюдатель — { id, interface, query, every, next }`);
  const iface = WATCH_INTERFACES.find((i) => i === data['interface']) ?? 'review';
  const w: Watch = {
    v: OPS_VERSION,
    id: data['id'],
    interface: iface,
    query: data['query'],
    every: data['every'],
    next: data['next'],
  };
  const until = UNTIL.find((u) => u === data['until']);
  if (until !== undefined) w.until = until;
  if (typeof data['job'] === 'string') w.job = data['job'];
  if (typeof data['fingerprint'] === 'string') w.fingerprint = data['fingerprint'];
  if (Array.isArray(data['items'])) w.items = data['items'].filter(isItem);
  return w;
}

export async function listWatches(root: string): Promise<Watch[]> {
  let names: string[];
  try {
    names = (await readdir(watchesDir(root))).filter((n) => n.endsWith('.yml')).sort();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  const out: Watch[] = [];
  for (const n of names)
    out.push(
      asWatch(
        await readYaml(path.join(watchesDir(root), n), `.ops/watches/${n}`),
        `.ops/watches/${n}`,
      ),
    );
  return out;
}

export function everyOf(value: string | undefined): number {
  if (value === undefined) return DEFAULT_EVERY_MIN;
  if (!/^\d+$/.test(value) || Number.parseInt(value, 10) < 1)
    throw new UsageError(`--every — минуты, целое ≥ 1: ${value}`);
  return Number.parseInt(value, 10);
}

export function untilOf(value: string | undefined): Until | undefined {
  if (value === undefined) return undefined;
  const found = UNTIL.find((u) => u === value);
  if (found === undefined) throw new UsageError(`--until — одно из ${UNTIL.join(', ')}: ${value}`);
  return found;
}

export async function addWatch(
  root: string,
  spec: { iface: string; query: string; every: number; until?: Until; job?: string },
  now: Date,
): Promise<Watch> {
  const iface = WATCH_INTERFACES.find((i) => i === spec.iface);
  if (iface === undefined)
    throw new UsageError(
      `наблюдатель — интерфейс ${WATCH_INTERFACES.join(' или ')}: ${spec.iface}`,
    );
  const id = hashOf(`${iface}\n${spec.query}\n${spec.job ?? ''}`).slice(0, 8);
  const watch: Watch = {
    v: OPS_VERSION,
    id,
    interface: iface,
    query: spec.query,
    every: spec.every,
    next: now.toISOString(),
  };
  if (spec.until !== undefined) watch.until = spec.until;
  if (spec.job !== undefined) watch.job = spec.job;
  await writeYaml(watchFile(root, id), watch);
  return watch;
}

export async function stopWatch(root: string, id: string): Promise<boolean> {
  const file = watchFile(root, id);
  if (!existsSync(file)) return false;
  await remove(file);
  return true;
}

export async function stopJobWatches(home: string, root: string, job: string): Promise<number> {
  let n = 0;
  for (const w of await listWatches(root))
    if (w.job === job && (await stopWatch(root, w.id))) {
      n++;
      await emit(home, root, 'watch-stopped', `наблюдатель ${w.id} снят: job ${job} закрыт`, job);
    }
  return n;
}

export const isDue = (w: Watch, now: Date): boolean => Date.parse(w.next) <= now.getTime();

const fingerprint = (s: Snapshot): string =>
  hashOf(
    JSON.stringify(
      [...s.items].sort((a, b) => a.id.localeCompare(b.id)).map((i) => [i.id, i.state, i.summary]),
    ),
  );

export function snapshotDiff(before: readonly WatchItem[], after: readonly WatchItem[]): string[] {
  const old = new Map(before.map((i) => [i.id, i]));
  const lines: string[] = [];
  for (const i of after) {
    const was = old.get(i.id);
    if (was === undefined)
      lines.push(`+ ${i.id} [${i.state}] ${i.summary}${i.url === undefined ? '' : ` ${i.url}`}`);
    else if (was.state !== i.state || was.summary !== i.summary)
      lines.push(
        `~ ${i.id} [${was.state} → ${i.state}] ${i.summary}${i.url === undefined ? '' : ` ${i.url}`}`,
      );
    old.delete(i.id);
  }
  for (const i of old.values()) lines.push(`- ${i.id} [${i.state}] ${i.summary}`);
  return lines;
}

export type Decision = 'ignore' | 'notify' | 'act';

export function decisionOf(report: string): { decision: Decision; text: string } {
  const [head = '', ...rest] = report.trim().split('\n');
  const m = /^(ignore|notify|act)\b[:\s—-]*(.*)$/i.exec(head.trim());
  const word = m?.[1]?.toLowerCase();
  const decision: Decision = word === 'ignore' || word === 'act' ? word : 'notify';
  return { decision, text: [m?.[2] ?? head, ...rest].join('\n').trim() };
}

export interface ActLine {
  method: string;
  target: string;
  text: string;
}

export function actLines(report: string): { acts: ActLine[]; rest: string } {
  const acts: ActLine[] = [];
  const rest: string[] = [];
  for (const line of report.split('\n')) {
    const m = /^\s*act:\s*([a-z][a-z0-9-]*)\s+(\S+)\s*(?:—|-)\s*(.+)$/.exec(line);
    if (m === null) rest.push(line);
    else acts.push({ method: m[1] ?? '', target: m[2] ?? '', text: (m[3] ?? '').trim() });
  }
  return { acts, rest: rest.join('\n').trim() };
}

const reportOf = (data: unknown): string =>
  isRecord(data) && typeof data['report'] === 'string' ? data['report'] : '';

async function jobDone(home: string, root: string, short: string): Promise<boolean> {
  const s = (await listSessions(home)).find(
    (x) =>
      x.data.harness === JOB_HARNESS &&
      x.short === short &&
      path.resolve(x.data.project) === path.resolve(root),
  );
  return s === undefined || s.data.state === 'done';
}

export interface TickResult {
  checked: number;
  changed: number;
  stopped: number;
  errors: string[];
}

async function ladder(home: string, root: string, w: Watch, diff: string[]): Promise<void> {
  const triage = await opsRole({
    root,
    home,
    role: TRIAGE_ROLE,
    lane: 'watchers',
    priority: PRIORITY.watch,
    task: [
      `Наблюдатель ${w.id}: ${w.interface} «${w.query}»${w.job === undefined ? '' : `, job ${w.job}`}.`,
      'Изменения с прошлого тика:',
      ...diff,
      '',
      'Первое слово report — ignore | notify | act, дальше — одна строка для пользователя.',
    ].join('\n'),
  });
  const { decision, text } = decisionOf(reportOf(triage.data));
  if (decision === 'ignore') return;
  if (decision === 'notify') {
    await emit(home, root, 'notify', `${w.interface} «${w.query}»: ${text}`, w.job);
    return;
  }
  const card = w.job === undefined ? undefined : projectFile(root, 'jobs', w.job, 'task.md');
  const request = await opsRole({
    root,
    home,
    role: REQUEST_ROLE,
    lane: 'watchers',
    priority: PRIORITY.watch,
    task: [
      `Наблюдатель ${w.id}: ${w.interface} «${w.query}».`,
      card === undefined || !existsSync(card)
        ? 'Job не привязан.'
        : `Карточка задачи: ${posixRelative(root, card)}`,
      `Решение триажа: ${text}`,
      'Изменения:',
      ...diff,
    ].join('\n'),
  });
  const { acts, rest } = actLines(reportOf(request.data));
  const policy = await loadAutonomy(root);
  const config = await loadOpsConfig(root);
  for (const a of acts) {
    const provider = await loadProvider(root, home, w.interface, config.providers[w.interface]);
    const outcome = await callWrite(provider, policy, a.method, false, [
      a.target,
      a.text,
      providerContext(root, home, config.repo),
    ]);
    if (outcome.done)
      await emit(
        home,
        root,
        'notify',
        `${w.interface}.${a.method} ${a.target} — сделано: ${a.text}`,
        w.job,
      );
    else {
      const file = projectFile(
        root,
        'suggest',
        `${hashOf(`${a.method}${a.target}${a.text}`).slice(0, 8)}.md`,
      );
      await writeAtomic(file, `${a.text}\n`);
      await emit(
        home,
        root,
        'suggest',
        `${w.interface}.${a.method} ${a.target} — после «да»: ai ops act ${w.interface} ${a.method} ${a.target} --file ${posixRelative(root, file)}`,
        w.job,
      );
    }
  }
  if (rest === '') return;
  if (w.job !== undefined) {
    await addFeedback(root, w.job, rest);
    await emit(
      home,
      root,
      'feedback',
      `запрос в job: ${rest.split('\n')[0] ?? ''} — ai ticket-work open ${w.job}`,
      w.job,
    );
  } else await emit(home, root, 'request', rest, w.job);
}

export async function tickProject(home: string, root: string, now: Date): Promise<TickResult> {
  const result: TickResult = { checked: 0, changed: 0, stopped: 0, errors: [] };
  const due = (await listWatches(root)).filter((w) => isDue(w, now));
  if (due.length === 0) return result;
  const config = await loadOpsConfig(root);
  for (const w of due) {
    result.checked++;
    try {
      if (w.until === 'job-done' && w.job !== undefined && (await jobDone(home, root, w.job))) {
        await stopWatch(root, w.id);
        result.stopped++;
        await emit(
          home,
          root,
          'watch-stopped',
          `наблюдатель ${w.id} снят: job ${w.job} закрыт`,
          w.job,
        );
        continue;
      }
      const name = config.providers[w.interface];
      const provider = await loadProvider(root, home, w.interface, name);
      const { value } = await cached(
        home,
        `${w.interface}/${name}\n${w.query}`,
        w.every * 60_000,
        now,
        () =>
          Promise.resolve(
            callRead(provider, 'poll', [w.query, providerContext(root, home, config.repo)]),
          ),
      );
      const snap = asSnapshot(value, `${w.interface}/${name}`);
      const print = fingerprint(snap);
      const diff = snapshotDiff(w.items ?? [], snap.items);
      const first = w.fingerprint === undefined;
      w.fingerprint = print;
      w.items = snap.items;
      w.next = new Date(now.getTime() + w.every * 60_000).toISOString();
      if (snap.done && w.until !== undefined && w.until !== 'job-done') {
        await stopWatch(root, w.id);
        result.stopped++;
        await emit(home, root, 'watch-stopped', `наблюдатель ${w.id} снят: ${w.until}`, w.job);
        if (w.job !== undefined && w.until === 'merged') {
          await markExternal(root, w.job, `${w.interface} «${w.query}»: ${w.until}`);
          await emit(
            home,
            root,
            'external',
            `job ${w.job}: ${w.until} — ai ticket-work open ${w.job}`,
            w.job,
          );
        }
        continue;
      }
      await writeYaml(watchFile(root, w.id), w);
      if (first || diff.length === 0) continue;
      result.changed++;
      await ladder(home, root, w, diff);
    } catch (error) {
      result.errors.push(`${w.id}: ${errorMessage(error)}`);
      await emit(home, root, 'warn', `наблюдатель ${w.id}: ${errorMessage(error)}`, w.job);
    }
  }
  return result;
}

function projectBin(root: string): string[] {
  const bin = path.join(root, 'node_modules', '@shahimat', 'cli', 'dist', 'bin.js');
  return existsSync(bin) ? [process.execPath, bin] : [...runtime().self];
}

export async function tickAll(
  home: string,
  now: Date,
): Promise<{ visited: number; errors: string[] }> {
  const registry = await loadRegistry(home);
  const errors: string[] = [];
  let visited = 0;
  for (const root of registry.projects) {
    if (!existsSync(root)) {
      errors.push(`${root}: каталога нет`);
      continue;
    }
    let due = false;
    try {
      due = (await listWatches(root)).some((w) => isDue(w, now));
    } catch (error) {
      errors.push(`${root}: ${errorMessage(error)}`);
      continue;
    }
    if (!due) continue;
    visited++;
    const [bin = process.execPath, ...pre] = projectBin(root);
    const r = spawnSync(bin, [...pre, 'ops', 'tick', '--root', root, '--home', home], {
      cwd: root,
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      const msg = `${root}: ops tick — код ${r.status ?? 'null'}: ${(r.stderr ?? '').trim().slice(0, 300)}`;
      errors.push(msg);
      await emit(home, root, 'warn', msg);
    }
  }
  return { visited, errors };
}
