import { randomBytes } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  askRole,
  errorCode,
  errorMessage,
  findRole,
  isRecord,
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
): Promise<string | undefined> {
  await mkdir(slotsDir(home), { recursive: true });
  for (let i = 0; i < cap; i++) {
    const file = machineFile(home, 'slots', `${prefix}-${i}.json`);
    try {
      await writeFile(file, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
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
}

export async function opsRole(run: OpsRoleRun): Promise<RoleOutcome> {
  const role = await findRole(run.root, run.role);
  const limits = await loadLimits(run.home);
  const opus = run.lane === 'jobs' && (role.model ?? 'opus') === 'opus';
  const cap = run.lane === 'jobs' ? limits.jobs : limits.watchers;
  const token = randomBytes(8).toString('hex');
  const ticket = machineFile(run.home, 'queue', `${run.lane}-${token}.json`);
  const at = Date.now();
  await writeJson(ticket, { pid: process.pid, priority: run.priority, at, token });
  try {
    for (;;) {
      const until = await backoffUntil(run.home);
      if (Date.now() < until) {
        await sleep(Math.min(until - Date.now(), pollMs()));
        continue;
      }
      const ahead = (await waiters(run.home, run.lane)).filter(
        (w) =>
          w.token !== token &&
          (w.priority < run.priority || (w.priority === run.priority && w.at < at)),
      );
      const lane = ahead.length < cap ? await takeSlot(run.home, run.lane, cap, token) : undefined;
      const big =
        lane !== undefined && opus
          ? await takeSlot(run.home, 'opus', limits.opus, token)
          : undefined;
      if (lane === undefined || (opus && big === undefined)) {
        if (lane !== undefined) await remove(lane);
        await sleep(pollMs());
        continue;
      }
      try {
        const outcome = await askRole(run.root, run.role, run.task, run.options ?? {});
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
