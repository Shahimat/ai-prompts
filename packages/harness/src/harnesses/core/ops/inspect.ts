import { stat } from 'node:fs/promises';
import path from 'node:path';
import { errorMessage, stepOf } from '@shahimat/ai-core';
import { listSessions, type Session } from '#harnesses/core/store/session';
import { INTERFACES, loadAutonomy, loadOpsConfig, levelOf, type InterfaceName } from './config.ts';
import { readText } from './files.ts';
import { pending } from './jobs.ts';
import {
  asCard,
  asSnapshot,
  callRead,
  loadProvider,
  providerContext,
  scheduleName,
  WRITE_METHODS,
} from './providers.ts';
import { activeRoles } from './runner.ts';

export type InterfaceStatus = 'ok' | 'none' | 'unmapped' | 'error';

export interface InterfaceReport {
  iface: InterfaceName;
  provider: string;
  system: string;
  status: InterfaceStatus;
  probe: string;
  writes: string;
}

const MACHINE_INTERFACES: readonly InterfaceName[] = ['schedule'];

async function probeOf(
  iface: InterfaceName,
  query: string | undefined,
  call: (method: string, args: unknown[]) => Promise<unknown>,
  where: string,
): Promise<string> {
  if (iface !== 'tasks' && iface !== 'review' && iface !== 'checks') return 'проба не нужна';
  if (query === undefined) return `пробы нет: context/ops.yml → probe.${iface}`;
  if (iface === 'tasks') {
    const card = asCard(await call('fetch', [query]), where);
    return `карточка «${card.title}», DoD ${card.dod.length}`;
  }
  const snap = asSnapshot(await call('poll', [query]), where);
  return `элементов ${snap.items.length}`;
}

export async function providersReport(root: string, home: string): Promise<InterfaceReport[]> {
  const config = await loadOpsConfig(root);
  const policy = await loadAutonomy(root);
  const out: InterfaceReport[] = [];
  for (const iface of INTERFACES) {
    const mapping = config.mapping[iface];
    const machine = MACHINE_INTERFACES.includes(iface);
    const name = machine ? scheduleName(config.providers[iface]) : (mapping?.provider ?? '');
    const row: InterfaceReport = {
      iface,
      provider: name === '' ? '—' : name,
      system: mapping?.system ?? '—',
      status: 'ok',
      probe: '',
      writes: '',
    };
    out.push(row);
    if (mapping === undefined && !machine) {
      row.status = 'unmapped';
      row.probe = `нет записи в context/ops.yml → providers.${iface}: найди аналог в инфраструктуре проекта или запиши provider: none с why`;
      continue;
    }
    if (name === 'none') {
      row.status = mapping?.why === undefined ? 'unmapped' : 'none';
      row.probe = mapping?.why ?? `provider: none без why — запиши, почему аналога нет`;
      continue;
    }
    try {
      const provider = await loadProvider(root, home, iface, name);
      const pctx = providerContext(root, home, config.repo);
      row.probe = await probeOf(
        iface,
        iface === 'tasks' || iface === 'review' || iface === 'checks'
          ? config.probe[iface]
          : undefined,
        (method, args) => Promise.resolve(callRead(provider, method, [...args, pctx])),
        provider.source,
      );
      row.writes = WRITE_METHODS[iface]
        .filter((m) => provider.methods.has(m))
        .map((m) => `${m}=${levelOf(policy, `${iface}.${m}`, undefined, true)}`)
        .join(' ');
    } catch (error) {
      row.status = 'error';
      row.probe = errorMessage(error);
    }
  }
  return out;
}

export const reportFails = (rows: readonly InterfaceReport[]): boolean =>
  rows.some((r) => r.status === 'unmapped' || r.status === 'error');

export function reportLines(rows: readonly InterfaceReport[]): string[] {
  return rows.map((r) =>
    [
      r.iface,
      r.provider,
      `система: ${r.system}`,
      r.status,
      r.probe,
      r.writes === '' ? '' : `запись: ${r.writes}`,
    ]
      .filter((x) => x !== '')
      .join('\t'),
  );
}

export const LINE_MAX = 3;
export const LINE_WINDOW_MS = 24 * 60 * 60_000;
const FINAL_STATES = ['done', 'finished'];
const STEP_MAX = 80;

async function lastActivity(s: Session): Promise<number> {
  const times = await Promise.all(
    ['log.jsonl', 'session.json'].map((f) =>
      stat(s.file(f)).then(
        (st) => st.mtimeMs,
        () => 0,
      ),
    ),
  );
  return Math.max(...times);
}

export async function liveLines(home: string, root: string, now: Date): Promise<string[]> {
  const project = path.resolve(root);
  const roles = (await activeRoles(home)).filter((r) => r.project === project);
  const live: { s: Session; at: number }[] = [];
  for (const s of await listSessions(home)) {
    if (path.resolve(s.data.project) !== project || FINAL_STATES.includes(s.data.state)) continue;
    const at = await lastActivity(s);
    if (now.getTime() - at <= LINE_WINDOW_MS) live.push({ s, at });
  }
  live.sort((a, b) => b.at - a.at);
  const lines: string[] = [];
  for (const { s } of live.slice(0, LINE_MAX)) {
    const parts = [`${s.data.harness} ${s.short}`, s.data.title, s.data.state];
    const role = roles.find((r) => r.job === s.short);
    if (role !== undefined) {
      const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(role.started)) / 60_000));
      const text = role.transcript === '' ? undefined : await readText(role.transcript);
      const last = (text ?? '')
        .split('\n')
        .map(stepOf)
        .filter((x) => x !== undefined)
        .at(-1);
      parts.push(`${role.role} ${minutes} мин`);
      if (last !== undefined)
        parts.push(last.length > STEP_MAX ? `${last.slice(0, STEP_MAX)}…` : last);
    } else {
      const waiting = await pending(s).catch(() => undefined);
      if (waiting !== undefined && waiting.answer === undefined) parts.push('ждёт ответа');
    }
    lines.push(parts.join(' · '));
  }
  if (live.length > LINE_MAX) lines.push(`ещё ${live.length - LINE_MAX}`);
  return lines;
}
