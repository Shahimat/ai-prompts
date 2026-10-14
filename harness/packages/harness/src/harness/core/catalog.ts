// Каталог harness: общие операции категорий и сессий поверх модулей
// конкретных harness. Ядро модули не импортирует — их передаёт каталог
// слоя (`harness/index.ts`).

import type { CommandArgs } from '../../shared/args.ts';
import { UsageError } from '../../shared/diagnostics.ts';
import {
  drive,
  machineMermaid,
  type DriveResult,
  type Journal,
  type MachineDef,
  type Registry,
} from './fsm/machine.ts';
import {
  harnessHome,
  listHarnesses,
  listSessions,
  openSession,
  type Session,
} from './store/session.ts';

/** Модуль harness: как загрузить автомат и вести его сессию. */
export interface HarnessModule {
  /** `plan/iter`. */
  name: string;
  /** Ошибки определения с путём до поля и загруженные плагины. */
  validate: (home: string) => Promise<{ errors: string[]; plugins: string[]; def?: MachineDef }>;
  /** Действие текущего состояния и дальше — до паузы или конца. */
  drive: (session: Session, home: string, event?: string) => Promise<DriveResult>;
  /** Строки `session status` сверх общих. */
  status?: (session: Session) => Promise<string[]>;
  /** Подготовка сессии к retry из failed. */
  beforeRetry?: (session: Session) => Promise<void>;
}

export function param(args: CommandArgs, key: string): string {
  const value = args.params?.[key];
  if (value === undefined) throw new UsageError(`нет параметра <${key}>`);
  return value;
}

export const homeOf = (args: CommandArgs): string => harnessHome(args.home);

/** Журнал автомата в сессии: состояние, счётчики и строка в log.jsonl на переход. */
export function sessionJournal(session: Session): Journal {
  return {
    load: async () => ({ state: session.data.state, counters: { ...session.data.counters } }),
    save: async (next, from, event) => {
      session.data.state = next.state;
      session.data.counters = next.counters;
      await session.save();
      await session.log({ from, event, to: next.state, counters: next.counters });
    },
  };
}

/** Прогон автомата сессии по определению и реестру модуля. */
export const driveSession = <C>(
  def: MachineDef,
  registry: Registry<C>,
  session: Session,
  ctx: C,
  event?: string,
): Promise<DriveResult> => drive(def, registry, sessionJournal(session), ctx, event);

export function report(session: Session, result: DriveResult): number {
  if ('final' in result) console.log(`${session.id}: ${result.final}`);
  else console.log(`${session.id}: ${result.paused} — ${result.message}`);
  return 0;
}

export interface CatalogOps {
  moduleOf: (name: string) => HarnessModule;
  /** Шаг сессии с отчётом: общий для start, resume и retry. */
  run: (session: Session, home: string, event?: string) => Promise<number>;
  list: (category: string) => (args: CommandArgs) => Promise<number>;
  validate: (category: string) => (args: CommandArgs) => Promise<number>;
  graph: (category: string) => (args: CommandArgs) => Promise<number>;
  sessionList: (args: CommandArgs) => Promise<number>;
  sessionStatus: (args: CommandArgs) => Promise<number>;
  sessionResume: (args: CommandArgs) => Promise<number>;
  sessionRetry: (args: CommandArgs) => Promise<number>;
}

export function catalog(modules: readonly HarnessModule[]): CatalogOps {
  const moduleOf = (name: string): HarnessModule => {
    const found = modules.find((m) => m.name === name);
    if (found === undefined) throw new UsageError(`нет harness ${name}`);
    return found;
  };
  const named = (category: string, args: CommandArgs): string =>
    `${category}/${param(args, 'harness')}`;
  const run = async (session: Session, home: string, event?: string): Promise<number> =>
    report(session, await moduleOf(session.data.harness).drive(session, home, event));
  const sessionOf = (args: CommandArgs): Promise<Session> =>
    openSession(homeOf(args), param(args, 'session'));

  return {
    moduleOf,
    run,
    list: (category) => async (args) => {
      for (const name of await listHarnesses(homeOf(args), category)) console.log(name);
      return 0;
    },
    validate: (category) => async (args) => {
      const name = named(category, args);
      const result = await moduleOf(name).validate(homeOf(args));
      if (result.errors.length === 0) {
        const plugins = result.plugins;
        console.log(`${name}: ok${plugins.length > 0 ? ` (плагины: ${plugins.join(', ')})` : ''}`);
        return 0;
      }
      for (const e of result.errors) console.error(e);
      console.error(`${name}: ошибок ${result.errors.length}`);
      return 1;
    },
    graph: (category) => async (args) => {
      const result = await moduleOf(named(category, args)).validate(homeOf(args));
      if (result.def === undefined) throw new UsageError(result.errors.join('\n'));
      console.log(machineMermaid(result.def));
      return 0;
    },
    sessionList: async (args) => {
      for (const s of await listSessions(homeOf(args)))
        console.log(`${s.id}\t${s.data.harness}\t${s.data.state}\t${s.data.title}`);
      return 0;
    },
    sessionStatus: async (args) => {
      const s = await sessionOf(args);
      console.log(`сессия: ${s.id}`);
      console.log(`harness: ${s.data.harness}`);
      console.log(`состояние: ${s.data.state}`);
      console.log(`проект: ${s.data.project}`);
      const extra = moduleOf(s.data.harness).status;
      for (const line of extra === undefined ? [] : await extra(s)) console.log(line);
      return 0;
    },
    sessionResume: async (args) => run(await sessionOf(args), homeOf(args)),
    sessionRetry: async (args) => {
      const s = await sessionOf(args);
      if (s.data.state !== 'failed')
        throw new UsageError(`retry — только из failed; сейчас ${s.data.state}`);
      await moduleOf(s.data.harness).beforeRetry?.(s);
      return run(s, homeOf(args), 'retry');
    },
  };
}
