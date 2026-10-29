import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { runtime, UsageError, type CommandArgs, type CommandNode } from '@shahimat/ai-core';
import { harnessHome } from '#harnesses/core/store/session';
import { loadAutonomy, loadOpsConfig } from './config.ts';
import {
  cursorKey,
  eventLine,
  forProject,
  IMPORTANT,
  readCursor,
  readEvents,
  writeCursor,
} from './events.ts';
import { jobDir, posixRelative } from './paths.ts';
import { pending, projectJobs } from './jobs.ts';
import { loadRegistry, register, TICK_SECONDS, TICK_UNIT, unregister } from './machine.ts';
import {
  callWrite,
  isInterface,
  loadProvider,
  providerContext,
  scheduleName,
} from './providers.ts';
import { pollMs } from './runner.ts';
import { serveBoard } from './serve.ts';
import {
  addWatch,
  everyOf,
  listWatches,
  stopWatch,
  tickAll,
  tickProject,
  untilOf,
} from './watches.ts';

const OPTIONS = { home: '[--home <dir>]' } as const;
const homeOf = (args: CommandArgs): string => harnessHome(args.home);

function param(args: CommandArgs, key: string): string {
  const value = args.params?.[key];
  if (value === undefined) throw new UsageError(`нет параметра <${key}>`);
  return value;
}

const BRIEF_LINES = 20;

export async function briefLines(home: string, root: string): Promise<string[]> {
  const jobs = (await projectJobs(home, root)).filter((s) => s.data.state !== 'done');
  const watches = await listWatches(root);
  const { events } = await readEvents(home, await readCursor(home, cursorKey(root, false)));
  const unseen = forProject(events, root, false).filter((e) => IMPORTANT.includes(e.kind));
  const asked: string[] = [];
  for (const s of jobs) {
    const p = await pending(s);
    if (p !== undefined && p.answer === undefined) asked.push(s.short);
  }
  const lines = [
    `ops: jobs ${jobs.length} · ждут ответа ${asked.length} · наблюдателей ${watches.length} · новых событий ${unseen.length}`,
  ];
  for (const s of jobs.slice(0, 10))
    lines.push(
      `${s.short} ${s.data.state}${asked.includes(s.short) ? ' ?' : ''} — ${s.data.title}`,
    );
  for (const e of unseen.slice(-5)) lines.push(eventLine(e, false));
  if (jobs.length + unseen.length > 0) lines.push('подробно: ai ops status; события: ai ops wait');
  return lines.slice(0, BRIEF_LINES);
}

async function brief(args: CommandArgs): Promise<number> {
  for (const line of await briefLines(homeOf(args), args.root)) console.log(line);
  return 0;
}

async function status(args: CommandArgs): Promise<number> {
  const home = homeOf(args);
  for (const s of await projectJobs(home, args.root))
    console.log(
      `${s.short}\t${s.data.state}\t${s.data.title}\t${posixRelative(args.root, jobDir(args.root, s.short))}`,
    );
  for (const w of await listWatches(args.root))
    console.log(
      `watch ${w.id}\t${w.interface} «${w.query}»\tкаждые ${w.every} мин\tследующий ${w.next}${w.job === undefined ? '' : `\tjob ${w.job}`}`,
    );
  const registry = await loadRegistry(home);
  console.log(
    `планировщик: ${registry.projects.includes(path.resolve(args.root)) ? 'проект в реестре' : 'проекта нет в реестре'} (${registry.projects.length} проектов на машине)`,
  );
  return 0;
}

function timeoutOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new UsageError(`--timeout — секунды: ${value}`);
  return Number.parseInt(value, 10) * 1000;
}

async function wait(args: CommandArgs): Promise<number> {
  const home = homeOf(args);
  const all = args.all === true;
  const key = cursorKey(args.root, all);
  const limit = timeoutOf(args.timeout);
  const start = Date.now();
  let offset = await readCursor(home, key);
  for (;;) {
    const { events, end } = await readEvents(home, offset);
    const mine = forProject(events, args.root, all);
    offset = end;
    if (mine.length > 0) {
      for (const e of mine) console.log(eventLine(e, all));
      await writeCursor(home, key, offset);
      if (mine.some((e) => IMPORTANT.includes(e.kind))) return 0;
    } else await writeCursor(home, key, offset);
    if (limit !== undefined && Date.now() - start >= limit) {
      console.log('событий нет');
      return 0;
    }
    await sleep(pollMs());
  }
}

async function watchAdd(args: CommandArgs): Promise<number> {
  const until = untilOf(args.until);
  const spec: Parameters<typeof addWatch>[1] = {
    iface: param(args, 'interface'),
    query: param(args, 'query'),
    every: everyOf(args.every),
  };
  if (until !== undefined) spec.until = until;
  if (args.job !== undefined) spec.job = args.job;
  const w = await addWatch(args.root, spec, args.now);
  console.log(`наблюдатель ${w.id}: ${w.interface} «${w.query}» каждые ${w.every} мин`);
  const registry = await loadRegistry(homeOf(args));
  if (!registry.projects.includes(path.resolve(args.root)))
    console.log(
      'проекта нет в реестре планировщика — тик не придёт: ai ops schedule on (после «да» пользователя)',
    );
  return 0;
}

async function watchList(args: CommandArgs): Promise<number> {
  for (const w of await listWatches(args.root))
    console.log(
      `${w.id}\t${w.interface} «${w.query}»\tкаждые ${w.every} мин${w.until === undefined ? '' : `\tдо ${w.until}`}${w.job === undefined ? '' : `\tjob ${w.job}`}`,
    );
  return 0;
}

async function watchStop(args: CommandArgs): Promise<number> {
  const id = param(args, 'id');
  if (!(await stopWatch(args.root, id))) throw new UsageError(`нет наблюдателя ${id}`);
  console.log(`наблюдатель ${id} снят`);
  return 0;
}

async function tick(args: CommandArgs): Promise<number> {
  const home = homeOf(args);
  if (args.all === true) {
    const { visited, errors } = await tickAll(home, args.now);
    console.log(
      `tick --all: проектов с работой ${visited}${errors.length === 0 ? '' : `, ошибок ${errors.length}`}`,
    );
    for (const e of errors) console.error(e);
    return errors.length === 0 ? 0 : 1;
  }
  const r = await tickProject(home, args.root, args.now);
  console.log(`tick: проверено ${r.checked}, изменилось ${r.changed}, снято ${r.stopped}`);
  for (const e of r.errors) console.error(e);
  return r.errors.length === 0 ? 0 : 1;
}

async function scheduleProvider(args: CommandArgs) {
  const config = await loadOpsConfig(args.root);
  return loadProvider(args.root, homeOf(args), 'schedule', scheduleName(config.providers.schedule));
}

async function scheduleOn(args: CommandArgs): Promise<number> {
  const home = homeOf(args);
  const provider = await scheduleProvider(args);
  const ctx = providerContext(args.root, home);
  const dispatcher = [
    ...runtime().self,
    'ops',
    'tick',
    '--all',
    ...(args.home === undefined ? [] : ['--home', home]),
  ];
  const registry = await register(home, args.root, dispatcher);
  const state = await Promise.resolve(provider.methods.get('status')?.(TICK_UNIT, ctx));
  if (state === 'active') {
    console.log(
      `проект в реестре; планировщик уже работает (${registry.projects.length} проектов)`,
    );
    return 0;
  }
  const unit = {
    name: TICK_UNIT,
    command: registry.dispatcher ?? dispatcher,
    every: TICK_SECONDS,
    log: path.join(home, 'ops', 'tick.log'),
  };
  const outcome = await callWrite(provider, await loadAutonomy(args.root), 'install', true, [
    unit,
    ctx,
  ]);
  console.log(
    `${outcome.done ? 'планировщик поставлен' : 'планировщик не поставлен'}: ${provider.source}, раз в ${TICK_SECONDS} с`,
  );
  return 0;
}

async function scheduleOff(args: CommandArgs): Promise<number> {
  const home = homeOf(args);
  const registry = await unregister(home, args.root);
  if (registry.projects.length > 0) {
    console.log(
      `проект убран из реестра; планировщик остаётся для ${registry.projects.length} проектов`,
    );
    return 0;
  }
  const provider = await scheduleProvider(args);
  await callWrite(provider, await loadAutonomy(args.root), 'remove', true, [
    TICK_UNIT,
    providerContext(args.root, home),
  ]);
  console.log('реестр пуст — планировщик снят');
  return 0;
}

async function scheduleStatus(args: CommandArgs): Promise<number> {
  const home = homeOf(args);
  const registry = await loadRegistry(home);
  const provider = await scheduleProvider(args);
  const state = await Promise.resolve(
    provider.methods.get('status')?.(TICK_UNIT, providerContext(args.root, home)),
  );
  console.log(`планировщик ${provider.name}: ${String(state)}`);
  for (const p of registry.projects) console.log(`- ${p}`);
  if (registry.dispatcher !== undefined) console.log(`диспетчер: ${registry.dispatcher.join(' ')}`);
  return 0;
}

async function act(args: CommandArgs): Promise<number> {
  const iface = param(args, 'interface');
  if (!isInterface(iface)) throw new UsageError(`нет интерфейса ${iface}`);
  const config = await loadOpsConfig(args.root);
  const provider = await loadProvider(args.root, homeOf(args), iface, config.providers[iface]);
  const text =
    args.file === undefined ? '' : await readFile(path.resolve(args.root, args.file), 'utf8');
  const outcome = await callWrite(
    provider,
    await loadAutonomy(args.root),
    param(args, 'method'),
    true,
    [param(args, 'target'), text.trim(), providerContext(args.root, homeOf(args), config.repo)],
  );
  console.log(
    `${iface}.${param(args, 'method')} ${param(args, 'target')}: ${outcome.done ? 'сделано' : 'не сделано'}`,
  );
  return 0;
}

const node = (
  words: string[],
  effect: 'query' | 'mutation',
  run: (args: CommandArgs) => Promise<number>,
  options: string = OPTIONS.home,
): CommandNode => ({ path: ['ops', ...words], kind: 'harness', effect, options, run });

export const OPS_NODES: readonly CommandNode[] = [
  node(['brief'], 'query', brief),
  node(['status'], 'query', status),
  node(['wait'], 'mutation', wait, '[--all] [--timeout <секунды>] [--home <dir>]'),
  node(
    ['watch', 'add', '<interface>', '<query>'],
    'mutation',
    watchAdd,
    '[--every <мин>] [--until <условие>] [--job <id>] [--home <dir>]',
  ),
  node(['watch', 'list'], 'query', watchList),
  node(['watch', 'stop', '<id>'], 'mutation', watchStop),
  node(['tick'], 'mutation', tick, '[--all] [--home <dir>]'),
  node(['schedule', 'on'], 'mutation', scheduleOn),
  node(['schedule', 'off'], 'mutation', scheduleOff),
  node(['schedule', 'status'], 'query', scheduleStatus),
  node(
    ['act', '<interface>', '<method>', '<target>'],
    'mutation',
    act,
    '[--file <текст>] [--home <dir>]',
  ),
  node(
    ['serve'],
    'mutation',
    (args) => serveBoard(args, homeOf(args)),
    '[--port <n>] [--all] [--home <dir>]',
  ),
];
