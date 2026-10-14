import { COMMAND_NODES, runScript } from '#scripts/index';
import type { CommandArgs } from '#shared/args';
import { UsageError } from '#shared/diagnostics';
import { errorMessage } from '#shared/guards';
import type { ScriptDef } from '#shared/node';
import { driveSession, homeOf, type HarnessModule } from './catalog.ts';
import type { ActionDef, Registry } from './fsm/machine.ts';
import { loadMachine } from './load.ts';
import { createSession, type Session } from './store/session.ts';

export interface ProcessContext {
  session: Session;
  home: string;
}

const argsOf = (ctx: ProcessContext): CommandArgs => ({
  root: ctx.session.data.project,
  now: new Date(),
});

const resume = (s: Session): string => `harness ${s.data.harness} open ${s.short}`;

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

export const commandAction = <C extends ProcessContext>(path: readonly string[]): ActionDef<C> => ({
  events: ['ok', 'fail'],
  run: async (ctx) => ({
    event: (await commandOf(path).run(argsOf(ctx))) === 0 ? 'ok' : 'fail',
  }),
});

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

export const failureAction = <C extends ProcessContext>(): ActionDef<C> => ({
  events: ['retry'],
  run: async (ctx) => ({
    pause: `попытки исчерпаны — исправь причину и запусти harness ${ctx.session.data.harness} open ${ctx.session.short}`,
  }),
});

export function processModule(
  name: string,
  registry: () => Registry<ProcessContext>,
  start: { options?: string; title: (args: CommandArgs) => string },
): HarnessModule {
  const load = async (home: string) => {
    const { machine, errors } = await loadMachine(home, name, registry());
    if (machine === undefined) throw new UsageError(errors.join('\n'));
    return machine;
  };
  const drive: HarnessModule['drive'] = async (session, home, event) => {
    const machine = await load(home);
    return driveSession(machine.def, machine.registry, session, { session, home }, event);
  };
  const module: HarnessModule = {
    name,
    validate: async (home) => {
      const { machine, errors } = await loadMachine(home, name, registry());
      return machine === undefined
        ? { errors, plugins: [] }
        : { errors: [], plugins: machine.plugins, def: machine.def };
    },
    drive,
    start: async (args) => {
      const home = homeOf(args);
      const machine = await load(home);
      return createSession(home, {
        harness: name,
        title: start.title(args),
        request: '',
        project: args.root,
        initial: machine.def.initial,
        now: args.now,
      });
    },
  };
  if (start.options !== undefined) module.startOptions = start.options;
  return module;
}
