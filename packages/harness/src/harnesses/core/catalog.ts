import { existsSync } from 'node:fs';
import path from 'node:path';
import type { CommandArgs } from '#shared/args';
import { UsageError } from '#shared/diagnostics';
import type { CommandNode } from '#shared/node';
import {
  drive,
  machineMermaid,
  type DriveResult,
  type Journal,
  type MachineDef,
  type Registry,
} from './fsm/machine.ts';
import { harnessHome, listSessions, resolveSession, type Session } from './store/session.ts';

export interface HarnessModule {
  name: string;
  startOptions?: string;
  startParams?: readonly string[];
  start: (args: CommandArgs) => Promise<Session>;
  validate: (home: string) => Promise<{ errors: string[]; plugins: string[]; def?: MachineDef }>;
  drive: (session: Session, home: string, event?: string) => Promise<DriveResult>;
  status?: (session: Session) => Promise<string[]>;
  nodes?: readonly CommandNode[];
}

export const HOME = '[--home <dir>]';

export function requireProject(root: string): void {
  if (!existsSync(path.join(root, '.claude')))
    throw new UsageError(
      `нет каталога .claude в ${root}: harness запускается в проекте с .claude (поиск вверх от места вызова или --root)`,
    );
}

export function param(args: CommandArgs, key: string): string {
  const value = args.params?.[key];
  if (value === undefined) throw new UsageError(`нет параметра <${key}>`);
  return value;
}

export const homeOf = (args: CommandArgs): string => harnessHome(args.home);

export const sessionOf = (args: CommandArgs, harness: string): Promise<Session> =>
  resolveSession(homeOf(args), param(args, 'id'), harness);

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

async function open(m: HarnessModule, session: Session, home: string): Promise<number> {
  if (session.data.state !== 'failed') return report(session, await m.drive(session, home));
  return report(session, await m.drive(session, home, 'retry'));
}

export function harnessNodes(m: HarnessModule): CommandNode[] {
  const at = (...words: string[]): string[] => [m.name, ...words];
  return [
    {
      path: at('start', ...(m.startParams ?? [])),
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
