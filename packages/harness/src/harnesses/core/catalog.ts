// Каталог harness: общие команды каждого harness поверх его модуля —
// `harness <имя> start | open <id> | list | status <id> | validate | graph`.
// Ядро модули не импортирует — их передаёт каталог слоя (`harnesses/index.ts`).

import type { CommandArgs } from '../../shared/args.ts';
import { UsageError } from '../../shared/diagnostics.ts';
import type { CommandNode } from '../../shared/node.ts';
import {
  drive,
  machineMermaid,
  type DriveResult,
  type Journal,
  type MachineDef,
  type Registry,
} from './fsm/machine.ts';
import { harnessHome, listSessions, resolveSession, type Session } from './store/session.ts';

/** Модуль harness: как начать сессию, загрузить автомат и вести его. */
export interface HarnessModule {
  /** `plan-review`. */
  name: string;
  /** Опции `start` для справки, кроме общей `--home`. */
  startOptions?: string;
  /** Новая сессия по аргументам `start`; автомат ещё не запущен. */
  start: (args: CommandArgs) => Promise<Session>;
  /** Ошибки определения с путём до поля и загруженные плагины. */
  validate: (home: string) => Promise<{ errors: string[]; plugins: string[]; def?: MachineDef }>;
  /** Действие текущего состояния и дальше — до паузы или конца. */
  drive: (session: Session, home: string, event?: string) => Promise<DriveResult>;
  /** Строки `status` сверх общих. */
  status?: (session: Session) => Promise<string[]>;
  /** Подготовка сессии к повтору из failed. */
  beforeRetry?: (session: Session) => Promise<void>;
  /** Свои команды harness: `plan-review render <id>`. */
  nodes?: readonly CommandNode[];
}

export const HOME = '[--home <dir>]';

export function param(args: CommandArgs, key: string): string {
  const value = args.params?.[key];
  if (value === undefined) throw new UsageError(`нет параметра <${key}>`);
  return value;
}

export const homeOf = (args: CommandArgs): string => harnessHome(args.home);

/** Сессия этого harness по префиксу id из параметра `<id>`. */
export const sessionOf = (args: CommandArgs, harness: string): Promise<Session> =>
  resolveSession(homeOf(args), param(args, 'id'), harness);

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
  if ('final' in result) console.log(`${session.short}: ${result.final}`);
  else console.log(`${session.short}: ${result.paused} — ${result.message}`);
  return 0;
}

/**
 * Пауза — выход: каждый переход уже на диске. open заново выполняет
 * действие текущего состояния; из failed — повтор со сбросом счётчиков.
 */
async function open(m: HarnessModule, session: Session, home: string): Promise<number> {
  if (session.data.state !== 'failed') return report(session, await m.drive(session, home));
  await m.beforeRetry?.(session);
  return report(session, await m.drive(session, home, 'retry'));
}

/** Узлы CLI harness: общие команды и свои команды модуля. */
export function harnessNodes(m: HarnessModule): CommandNode[] {
  const at = (...words: string[]): string[] => [m.name, ...words];
  return [
    {
      path: at('start'),
      kind: 'harness',
      effect: 'mutation',
      options: [m.startOptions, HOME].filter((o) => o !== undefined).join(' '),
      run: async (args) => {
        const session = await m.start(args);
        console.log(`сессия ${session.short}`);
        return report(session, await m.drive(session, homeOf(args)));
      },
    },
    {
      path: at('open', '<id>'),
      kind: 'harness',
      effect: 'mutation',
      options: HOME,
      run: async (args) => open(m, await sessionOf(args, m.name), homeOf(args)),
    },
    {
      path: at('list'),
      kind: 'harness',
      effect: 'query',
      options: HOME,
      run: async (args) => {
        for (const s of await listSessions(homeOf(args)))
          if (s.data.harness === m.name)
            console.log(`${s.short}\t${s.data.state}\t${s.data.title}`);
        return 0;
      },
    },
    {
      path: at('status', '<id>'),
      kind: 'harness',
      effect: 'query',
      options: HOME,
      run: async (args) => {
        const s = await sessionOf(args, m.name);
        console.log(`сессия: ${s.short}`);
        console.log(`harness: ${s.data.harness}`);
        console.log(`состояние: ${s.data.state}`);
        console.log(`проект: ${s.data.project}`);
        for (const line of m.status === undefined ? [] : await m.status(s)) console.log(line);
        return 0;
      },
    },
    {
      path: at('validate'),
      kind: 'harness',
      effect: 'query',
      options: HOME,
      run: async (args) => {
        const result = await m.validate(homeOf(args));
        if (result.errors.length === 0) {
          const plugins = result.plugins;
          console.log(
            `${m.name}: ok${plugins.length > 0 ? ` (плагины: ${plugins.join(', ')})` : ''}`,
          );
          return 0;
        }
        for (const e of result.errors) console.error(e);
        console.error(`${m.name}: ошибок ${result.errors.length}`);
        return 1;
      },
    },
    {
      path: at('graph'),
      kind: 'harness',
      effect: 'query',
      options: HOME,
      run: async (args) => {
        const result = await m.validate(homeOf(args));
        if (result.def === undefined) throw new UsageError(result.errors.join('\n'));
        console.log(machineMermaid(result.def));
        return 0;
      },
    },
    ...(m.nodes ?? []),
  ];
}
