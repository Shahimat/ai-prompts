// Действия процессов, в которых работает агент, вызвавший harness: задание
// агенту, шаг-скрипт, шаг-команда и справка о провале.

import { COMMAND_NODES, runScript } from '../../scripts/index.ts';
import type { CommandArgs } from '../../shared/args.ts';
import { UsageError } from '../../shared/diagnostics.ts';
import { errorMessage } from '../../shared/guards.ts';
import type { ScriptDef } from '../../shared/node.ts';
import { driveSession, homeOf, report, type HarnessModule } from './catalog.ts';
import type { ActionDef, Registry } from './fsm/machine.ts';
import { loadMachine } from './load.ts';
import { createSession, type Session } from './store/session.ts';

/** Контекст процесса без своих моделей: сессия и каталог harness. */
export interface ProcessContext {
  session: Session;
  home: string;
}

const argsOf = (ctx: ProcessContext): CommandArgs => ({
  root: ctx.session.data.project,
  now: new Date(),
});

const resume = (s: Session): string => `harness session ${s.id} resume`;

/**
 * Состояние агента: при входе — пауза с заданием, после `session resume` —
 * событие done. Задание помнит сессия, поэтому повторный resume не теряет шаг.
 */
export function handoff<C extends ProcessContext>(task: (ctx: C) => string): ActionDef<C> {
  return {
    events: ['done'],
    run: async (ctx) => {
      const s = ctx.session;
      if (s.data.handoff === s.data.state) {
        delete s.data.handoff;
        await s.save();
        return { event: 'done' };
      }
      s.data.handoff = s.data.state;
      await s.save();
      return { pause: `${task(ctx)}; затем ${resume(s)}` };
    },
  };
}

/** Шаг-скрипт: ok — все шаги чисты, fail — иначе. */
export const scriptAction = <C extends ProcessContext>(script: ScriptDef): ActionDef<C> => ({
  events: ['ok', 'fail'],
  run: async (ctx) => ({ event: (await runScript(script, argsOf(ctx))) === 0 ? 'ok' : 'fail' }),
});

function commandOf(path: readonly string[]) {
  const found = COMMAND_NODES.find(
    (c) => c.path.length === path.length && c.path.every((p, i) => p === path[i]),
  );
  if (found === undefined) throw new Error(`нет команды ${path.join(' ')}`);
  return found;
}

/** Шаг-команда: ok — код 0, fail — иначе. */
export const commandAction = <C extends ProcessContext>(path: readonly string[]): ActionDef<C> => ({
  events: ['ok', 'fail'],
  run: async (ctx) => ({
    event: (await commandOf(path).run(argsOf(ctx))) === 0 ? 'ok' : 'fail',
  }),
});

/** Шаг-сведение: команда печатает итог, процесс идёт дальше при любом исходе. */
export const reportAction = <C extends ProcessContext>(path: readonly string[]): ActionDef<C> => ({
  events: ['done'],
  run: async (ctx) => {
    try {
      await commandOf(path).run(argsOf(ctx));
    } catch (error) {
      console.error(`${path.join(' ')}: ${errorMessage(error)}`);
    }
    return { event: 'done' };
  },
});

/** Состояние failed: пауза до `session retry` после исправления причины. */
export const failureAction = <C extends ProcessContext>(): ActionDef<C> => ({
  events: ['retry'],
  run: async (ctx) => ({
    pause: `попытки исчерпаны — исправь причину и запусти harness session ${ctx.session.id} retry`,
  }),
});

/** Модуль каталога для процесса без своих моделей и операция start к нему. */
export function processModule(
  name: string,
  registry: () => Registry<ProcessContext>,
): HarnessModule & { start: (args: CommandArgs, title: string) => Promise<number> } {
  const load = async (home: string) => {
    const { machine, errors } = await loadMachine(home, name, registry());
    if (machine === undefined) throw new UsageError(errors.join('\n'));
    return machine;
  };
  const drive: HarnessModule['drive'] = async (session, home, event) => {
    const machine = await load(home);
    return driveSession(machine.def, machine.registry, session, { session, home }, event);
  };
  return {
    name,
    validate: async (home) => {
      const { machine, errors } = await loadMachine(home, name, registry());
      return machine === undefined
        ? { errors, plugins: [] }
        : { errors: [], plugins: machine.plugins, def: machine.def };
    },
    drive,
    start: async (args, title) => {
      const home = homeOf(args);
      const machine = await load(home);
      const session = await createSession(home, {
        harness: name,
        title,
        request: '',
        project: args.root,
        initial: machine.def.initial,
        now: args.now,
      });
      console.log(`сессия ${session.id}: ${session.dir}`);
      return report(session, await drive(session, home));
    },
  };
}
