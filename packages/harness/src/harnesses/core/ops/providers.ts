import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorMessage, isRecord, isStringArray, UsageError } from '@shahimat/ai-core';
import { BUILTIN_PROVIDERS } from './builtin.ts';
import { INTERFACES, type Autonomy, type InterfaceName, levelOf } from './config.ts';
import { machineProviders, PROJECT_PROVIDERS } from './paths.ts';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ProviderContext {
  root: string;
  home: string;
  repo: string;
  exec: (cmd: string, args: readonly string[], cwd?: string) => ExecResult;
}

export interface TaskCard {
  ref: string;
  title: string;
  body: string;
  dod: string[];
  links: string[];
}

export interface WatchItem {
  id: string;
  state: string;
  summary: string;
  url?: string;
}

export interface Snapshot {
  items: WatchItem[];
  done: boolean;
}

export interface ScheduleUnit {
  name: string;
  command: string[];
  every: number;
  log: string;
}

export const WRITE_METHODS: Readonly<Record<InterfaceName, readonly string[]>> = {
  tasks: ['update'],
  vcs: ['publish'],
  review: ['comment', 'approve'],
  checks: ['start'],
  notify: ['send'],
  schedule: ['install', 'remove'],
};

export const READ_METHODS: Readonly<Record<InterfaceName, readonly string[]>> = {
  tasks: ['fetch'],
  vcs: ['create', 'diff', 'remove'],
  review: ['poll'],
  checks: ['poll'],
  notify: [],
  schedule: ['status'],
};

export const REQUIRED: Readonly<Record<InterfaceName, readonly string[]>> = {
  tasks: ['fetch'],
  vcs: ['create', 'diff', 'remove'],
  review: ['poll'],
  checks: ['poll'],
  notify: ['send'],
  schedule: ['install', 'remove', 'status'],
};

export type Method = (...args: unknown[]) => unknown;

export interface Provider {
  iface: InterfaceName;
  name: string;
  source: string;
  methods: Map<string, Method>;
}

export function execIn(cmd: string, args: readonly string[], cwd?: string): ExecResult {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? (r.error === undefined ? '' : errorMessage(r.error)),
  };
}

export const providerContext = (root: string, home: string, repo = root): ProviderContext => ({
  root,
  home,
  repo,
  exec: execIn,
});

export function asProvider(
  value: unknown,
  iface: InterfaceName,
  name: string,
  source: string,
): Provider {
  if (!isRecord(value))
    throw new UsageError(`${source}: export default { interface, name, …методы } — объект`);
  if (value['interface'] !== iface)
    throw new UsageError(`${source}: interface — «${iface}», а не «${String(value['interface'])}»`);
  if (value['name'] !== name)
    throw new UsageError(`${source}: name — «${name}», а не «${String(value['name'])}»`);
  const methods = new Map<string, Method>();
  for (const [key, fn] of Object.entries(value)) {
    if (key === 'interface' || key === 'name') continue;
    if (typeof fn !== 'function') throw new UsageError(`${source}: ${key} — функция`);
    methods.set(key, (...args: unknown[]) => Reflect.apply(fn, undefined, args));
  }
  const missing = REQUIRED[iface].filter((m) => !methods.has(m));
  if (missing.length > 0) throw new UsageError(`${source}: нет методов ${missing.join(', ')}`);
  return { iface, name, source, methods };
}

const EXTENSIONS = ['ts', 'js', 'mjs'];

function fileAt(dir: string, iface: string, name: string): string | undefined {
  return EXTENSIONS.map((e) => path.join(dir, iface, `${name}.${e}`)).find((f) => existsSync(f));
}

export async function loadProvider(
  root: string,
  home: string,
  iface: InterfaceName,
  name: string,
): Promise<Provider> {
  if (name === 'none')
    throw new UsageError(`провайдер ${iface} не выбран: context/ops.yml → providers.${iface}`);
  const own = fileAt(path.join(root, PROJECT_PROVIDERS), iface, name);
  const machine = fileAt(machineProviders(home), iface, name);
  const builtin = BUILTIN_PROVIDERS.find((p) => p.interface === iface && p.name === name);
  const found = [own, machine, builtin === undefined ? undefined : 'builtin'].filter(
    (f) => f !== undefined,
  );
  if (found.length > 1)
    throw new UsageError(`провайдер ${iface}/${name} объявлен дважды: ${found.join(', ')}`);
  const file = own ?? machine;
  if (file !== undefined) {
    const mod: unknown = await import(pathToFileURL(file).href);
    return asProvider(isRecord(mod) ? mod['default'] : undefined, iface, name, file);
  }
  if (builtin !== undefined) return asProvider(builtin, iface, name, `builtin:${iface}/${name}`);
  throw new UsageError(
    `нет провайдера ${iface}/${name}: ни в ${PROJECT_PROVIDERS}/${iface}/, ни в ${machineProviders(home)}/${iface}/, ни среди встроенных`,
  );
}

export function scheduleName(name: string): string {
  if (name !== 'auto') return name;
  if (process.platform === 'darwin') return 'launchd';
  if (process.platform === 'linux') return 'systemd';
  throw new UsageError(`schedule auto: нет встроенного планировщика для ${process.platform}`);
}

export interface WriteOutcome {
  done: boolean;
  level: 'self' | 'ask' | 'never';
  result?: unknown;
}

const targetOf = (args: readonly unknown[]): string | undefined =>
  typeof args[0] === 'string' ? args[0] : undefined;

export async function callWrite(
  provider: Provider,
  policy: Autonomy,
  method: string,
  approved: boolean,
  args: readonly unknown[],
  target?: string,
): Promise<WriteOutcome> {
  const action = `${provider.iface}.${method}`;
  if (!WRITE_METHODS[provider.iface].includes(method))
    throw new UsageError(
      `${action} — не метод записи интерфейса: ${WRITE_METHODS[provider.iface].join(', ') || 'нет'}`,
    );
  const fn = provider.methods.get(method);
  if (fn === undefined) throw new UsageError(`${provider.source}: нет метода ${method}`);
  const level = levelOf(policy, action, target ?? targetOf(args), true);
  if (level === 'never')
    throw new UsageError(`${action}: запрещено политикой context/autonomy.yml`);
  if (level === 'ask' && !approved) return { done: false, level };
  return { done: true, level, result: await fn(...args) };
}

export async function callRead(
  provider: Provider,
  method: string,
  args: readonly unknown[],
): Promise<unknown> {
  if (WRITE_METHODS[provider.iface].includes(method))
    throw new UsageError(`${provider.iface}.${method} — запись: только через политику автономии`);
  if (!READ_METHODS[provider.iface].includes(method))
    throw new UsageError(
      `${provider.iface}.${method} — не объявлен в интерфейсе: чтение — ${READ_METHODS[provider.iface].join(', ') || 'нет'}, запись — ${WRITE_METHODS[provider.iface].join(', ')}`,
    );
  const fn = provider.methods.get(method);
  if (fn === undefined) throw new UsageError(`${provider.source}: нет метода ${method}`);
  return fn(...args);
}

const isWatchItem = (v: unknown): v is WatchItem =>
  isRecord(v) &&
  typeof v['id'] === 'string' &&
  typeof v['state'] === 'string' &&
  typeof v['summary'] === 'string' &&
  (v['url'] === undefined || typeof v['url'] === 'string');

export function asSnapshot(value: unknown, where: string): Snapshot {
  if (!isRecord(value) || !Array.isArray(value['items']))
    throw new UsageError(`${where}: poll вернул не { items: [...], done? }`);
  const bad = value['items'].findIndex((i) => !isWatchItem(i));
  if (bad >= 0) throw new UsageError(`${where}: items[${bad}] — { id, state, summary, url? }`);
  return { items: value['items'].filter(isWatchItem), done: value['done'] === true };
}

export function asCard(value: unknown, where: string): TaskCard {
  if (
    !isRecord(value) ||
    typeof value['ref'] !== 'string' ||
    typeof value['title'] !== 'string' ||
    typeof value['body'] !== 'string' ||
    !isStringArray(value['dod']) ||
    !isStringArray(value['links'])
  )
    throw new UsageError(`${where}: fetch вернул не { ref, title, body, dod: [], links: [] }`);
  return {
    ref: value['ref'],
    title: value['title'],
    body: value['body'],
    dod: value['dod'],
    links: value['links'],
  };
}

export const isInterface = (v: string): v is InterfaceName => INTERFACES.some((i) => i === v);
