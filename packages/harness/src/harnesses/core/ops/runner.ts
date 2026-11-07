import { randomBytes } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  askRole,
  errorCode,
  errorMessage,
  findRole,
  isRecord,
  resolveProjectModel,
  type AskOptions,
  type RoleOutcome,
} from '@shahimat/ai-core';
import { emit } from './events.ts';
import { readJson, remove, writeJson } from './files.ts';
import { loadLimits } from './machine.ts';
import { machineFile } from './paths.ts';

export type Lane = 'jobs' | 'watchers';

export const PRIORITY = {
  answered: 0,
  review: 1,
  implement: 2,
  plan: 3,
  research: 4,
  watch: 0,
} as const;

const RATE_LIMIT = /rate.?limit|usage limit|\b429\b|overloaded|too many requests/i;
const backoffStart = (): number => {
  const raw = process.env['HARNESS_OPS_BACKOFF_S'];
  const n = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : 60;
};
const BACKOFF_MAX_S = 1800;

export const pollMs = (): number => {
  const raw = process.env['HARNESS_OPS_POLL_MS'];
  const n = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : 2000;
};

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
}

const slotsDir = (home: string): string => machineFile(home, 'slots');
const queueDir = (home: string): string => machineFile(home, 'queue');

async function list(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
}

async function pidOf(file: string): Promise<number | undefined> {
  const data = await readJson(file, 'ops/slots').catch(() => undefined);
  return isRecord(data) && typeof data['pid'] === 'number' ? data['pid'] : undefined;
}

async function takeSlot(
  home: string,
  prefix: string,
  cap: number,
  token: string,
  meta: Record<string, unknown> = {},
): Promise<string | undefined> {
  await mkdir(slotsDir(home), { recursive: true });
  for (let i = 0; i < cap; i++) {
    const file = machineFile(home, 'slots', `${prefix}-${i}.json`);
    try {
      await writeFile(file, JSON.stringify({ ...meta, pid: process.pid, token }), { flag: 'wx' });
      return file;
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      const pid = await pidOf(file);
      if (pid === undefined || !alive(pid)) {
        await remove(file);
        i--;
      }
    }
  }
  return undefined;
}

interface Waiter {
  priority: number;
  at: number;
  token: string;
}

async function waiters(home: string, lane: Lane): Promise<Waiter[]> {
  const out: Waiter[] = [];
  for (const name of (await list(queueDir(home))).filter((n) => n.startsWith(`${lane}-`))) {
    const file = machineFile(home, 'queue', name);
    const data = await readJson(file, 'ops/queue').catch(() => undefined);
    if (!isRecord(data) || typeof data['pid'] !== 'number' || !alive(data['pid'])) {
      await remove(file);
      continue;
    }
    if (
      typeof data['priority'] === 'number' &&
      typeof data['at'] === 'number' &&
      typeof data['token'] === 'string'
    )
      out.push({ priority: data['priority'], at: data['at'], token: data['token'] });
  }
  return out;
}

async function backoffUntil(home: string): Promise<number> {
  const data = await readJson(machineFile(home, 'backoff.json'), 'ops/backoff.json');
  return isRecord(data) && typeof data['until'] === 'number' ? data['until'] : 0;
}

async function startBackoff(
  home: string,
  root: string,
  role: string,
  job: string | undefined,
): Promise<void> {
  const file = machineFile(home, 'backoff.json');
  const data = await readJson(file, 'ops/backoff.json');
  const attempts =
    isRecord(data) && typeof data['attempts'] === 'number' ? data['attempts'] + 1 : 1;
  const seconds = Math.min(backoffStart() * 2 ** (attempts - 1), BACKOFF_MAX_S);
  await writeJson(file, { until: Date.now() + seconds * 1000, attempts });
  await emit(
    home,
    root,
    'rate-limit',
    `роль ${role}: лимит модели — очередь на паузе ${seconds} с`,
    job,
  );
}

export interface OpsRoleRun {
  root: string;
  home: string;
  role: string;
  task: string;
  lane: Lane;
  priority: number;
  job?: string;
  options?: AskOptions;
  waitMin?: number;
}

const WAIT_PROGRESS_S = 30;

const waitLabel = (ms: number): string =>
  ms < 120_000 ? `${Math.max(1, Math.round(ms / 1000))} с` : `${Math.round(ms / 60_000)} мин`;

export const stepWaitMin = (): number => {
  const raw = process.env['HARNESS_STEP_WAIT_MIN'];
  const n = raw === undefined ? Number.NaN : Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 5;
};

export async function opsRole(run: OpsRoleRun): Promise<RoleOutcome> {
  const role = await findRole(run.root, run.role);
  const limits = await loadLimits(run.home);
  const effective = await resolveProjectModel(
    run.root,
    run.role,
    role.model ?? 'opus',
    run.options?.modelContext,
  );
  const opus = run.lane === 'jobs' && effective.model === 'opus';
  const cap = run.lane === 'jobs' ? limits.jobs : limits.watchers;
  const token = randomBytes(8).toString('hex');
  const ticket = machineFile(run.home, 'queue', `${run.lane}-${token}.json`);
  const at = Date.now();
  await writeJson(ticket, { pid: process.pid, priority: run.priority, at, token });
  const waitStart = Date.now();
  const waitLimit = run.waitMin === undefined ? undefined : run.waitMin * 60_000;
  let reason = '';
  let reported = 0;
  const reportWait = (next: string): void => {
    const now = Date.now();
    if (next === reason && now - reported < WAIT_PROGRESS_S * 1000) return;
    reason = next;
    reported = now;
    console.error(`роль ${run.role}: ${next}`);
  };
  try {
    for (;;) {
      const until = await backoffUntil(run.home);
      if (Date.now() < until) {
        const left = Math.ceil((until - Date.now()) / 1000);
        reportWait(`жду — лимит модели, очередь на паузе ещё ${left} с`);
        if (waitLimit !== undefined && Date.now() - waitStart > waitLimit)
          throw new Error(
            `роль ${run.role}: ожидание превысило ${waitLabel(waitLimit)} — лимит модели держит очередь до ${new Date(until).toLocaleTimeString()}; сними помеху или повтори позже`,
          );
        await sleep(Math.min(until - Date.now(), pollMs()));
        continue;
      }
      const ahead = (await waiters(run.home, run.lane)).filter(
        (w) =>
          w.token !== token &&
          (w.priority < run.priority || (w.priority === run.priority && w.at < at)),
      );
      const meta = {
        role: run.role,
        project: path.resolve(run.root),
        job: run.job ?? '',
        started: new Date().toISOString(),
        transcript: run.options?.transcript ?? '',
      };
      const lane =
        ahead.length < cap ? await takeSlot(run.home, run.lane, cap, token, meta) : undefined;
      const big =
        lane !== undefined && opus
          ? await takeSlot(run.home, 'opus', limits.opus, token)
          : undefined;
      if (lane === undefined || (opus && big === undefined)) {
        if (lane !== undefined) await remove(lane);
        const busy = opus
          ? `слоты ${run.lane} ${cap}/${cap} и opus ${limits.opus}/${limits.opus}`
          : `слоты ${run.lane} ${cap}/${cap}`;
        reportWait(`жду — заняты ${busy}`);
        if (waitLimit !== undefined && Date.now() - waitStart > waitLimit)
          throw new Error(
            `роль ${run.role}: ожидание превысило ${waitLabel(waitLimit)} — заняты ${busy}; посмотри ai ops status и повтори позже`,
          );
        await sleep(pollMs());
        continue;
      }
      try {
        const outcome = await askRole(run.root, run.role, run.task, {
          ...run.options,
          context: {
            purpose: 'implementation',
            ...run.options?.context,
            execution:
              run.options?.context?.execution ?? `${run.job ?? token}:${run.role}:${token}`,
          },
        });
        await remove(machineFile(run.home, 'backoff.json'));
        return outcome;
      } catch (error) {
        if (!RATE_LIMIT.test(errorMessage(error))) throw error;
        await startBackoff(run.home, run.root, run.role, run.job);
      } finally {
        await remove(lane);
        if (big !== undefined) await remove(big);
      }
    }
  } finally {
    await remove(ticket);
  }
}

export interface ActiveRole {
  role: string;
  project: string;
  job: string;
  started: string;
  transcript: string;
  lane: string;
  pid: number;
}

export async function activeRoles(home: string): Promise<ActiveRole[]> {
  const out: ActiveRole[] = [];
  for (const name of (await list(slotsDir(home))).sort()) {
    if (name.startsWith('opus-')) continue;
    const data = await readJson(machineFile(home, 'slots', name), 'ops/slots').catch(
      () => undefined,
    );
    if (!isRecord(data) || typeof data['pid'] !== 'number' || !alive(data['pid'])) continue;
    const str = (k: string): string => (typeof data[k] === 'string' ? data[k] : '');
    out.push({
      role: str('role'),
      project: str('project'),
      job: str('job'),
      started: str('started'),
      transcript: str('transcript'),
      lane: name.replace(/-\d+\.json$/, ''),
      pid: data['pid'],
    });
  }
  return out;
}

export async function waitingRoles(home: string): Promise<number> {
  return (await list(queueDir(home))).length;
}
