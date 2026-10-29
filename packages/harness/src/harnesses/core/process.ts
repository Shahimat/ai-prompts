import { COMMAND_NODES, runtime } from '@shahimat/ai-core';
import type { CommandArgs } from '@shahimat/ai-core';
import { UsageError } from '@shahimat/ai-core';
import { errorMessage, isRecord } from '@shahimat/ai-core';
import { driveSession, homeOf, requireProject, type HarnessModule } from './catalog.ts';
import type { ActionDef, Registry } from './fsm/machine.ts';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { RoleOutcome } from '@shahimat/ai-core';
import { opsRole, PRIORITY } from './ops/runner.ts';
import { loadMachine, loadMachineAt } from './load.ts';
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

export function progressTo(file: string): (text: string) => void {
  return (text) => {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toISOString().slice(11, 19)} ${text}\n`, 'utf8');
  };
}

export async function sessionRole(
  ctx: ProcessContext,
  role: string,
  task: string,
): Promise<RoleOutcome> {
  const s = ctx.session;
  const dir = s.file('runs');
  const n = existsSync(dir)
    ? (await readdir(dir)).filter((f) => f.startsWith(`${role}-`)).length + 1
    : 1;
  const transcript = s.file(`runs/${role}-${n}.jsonl`);
  console.error(`роль ${role}: запущена; журнал — ${transcript}`);
  const outcome = await opsRole({
    root: s.data.project,
    home: ctx.home,
    role,
    task,
    lane: 'jobs',
    priority: PRIORITY.answered,
    job: s.short,
    options: { transcript, onProgress: progressTo(s.file('progress.log')) },
  });
  console.error(`роль ${role}: готово`);
  return outcome;
}

export function roleOrHandoff<C extends ProcessContext>(
  role: string,
  task: (ctx: C) => string,
): ActionDef<C> {
  const manual = handoff(task);
  return {
    events: ['done'],
    run: async (ctx) => {
      const s = ctx.session;
      if (s.data.request === '' || s.data.handoff === s.data.state) return manual.run(ctx);
      try {
        const { data } = await sessionRole(
          ctx,
          role,
          `${task(ctx)}.\n\nНамерения (JSON по схеме intents):\n\n${s.data.request}`,
        );
        await s.log({ role, result: data });
        if (isRecord(data) && typeof data['report'] === 'string') console.log(data['report']);
        return { event: 'done' };
      } catch (error) {
        await s.log({ role, error: errorMessage(error) });
        const paused = await manual.run(ctx);
        return 'pause' in paused
          ? {
              pause: `роль ${role}: ${errorMessage(error)} — сделай вручную: ${paused.pause}\nНамерения: ${s.data.request}`,
            }
          : paused;
      }
    },
  };
}

export const scriptAction = <C extends ProcessContext>(
  script: readonly string[],
): ActionDef<C> => ({
  events: ['ok', 'fail'],
  run: async (ctx) => ({
    event: (await runtime().runScript(script, argsOf(ctx))) === 0 ? 'ok' : 'fail',
  }),
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

type MachineLoader = (home: string) => ReturnType<typeof loadMachine<ProcessContext>>;

export function processModule(
  name: string,
  registry: () => Registry<ProcessContext>,
  start: {
    options?: string;
    title: (args: CommandArgs) => string;
    request?: (args: CommandArgs) => Promise<string>;
  },
  loader: MachineLoader = (home) => loadMachine(home, name, registry()),
): HarnessModule {
  const load = async (home: string) => {
    const { machine, errors } = await loader(home);
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
      const { machine, errors } = await loader(home);
      return machine === undefined
        ? { errors, plugins: [] }
        : { errors: [], plugins: machine.plugins, def: machine.def };
    },
    drive,
    start: async (args) => {
      requireProject(args.root);
      const home = homeOf(args);
      const machine = await load(home);
      return createSession(home, {
        harness: name,
        title: start.title(args),
        request: (await start.request?.(args)) ?? '',
        project: args.root,
        initial: machine.def.initial,
        now: args.now,
      });
    },
  };
  if (start.options !== undefined) module.startOptions = start.options;
  return module;
}

export function projectHarnessModule(dir: string): HarnessModule {
  const name = path.basename(dir);
  const registry = (): Registry<ProcessContext> => ({ actions: new Map(), guards: new Map() });
  return processModule(name, registry, { title: (args) => args.name ?? name }, () =>
    loadMachineAt(dir, name, registry()),
  );
}
