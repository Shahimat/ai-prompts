import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  drive,
  machineMermaid,
  parseMachine,
  resolve,
  staticErrors,
  type ActionDef,
  type MachineDef,
  type MachineState,
  type Registry,
} from '#harnesses/core/fsm/machine';
import { loadHarness } from '#harnesses/plan-review/load';
import { loadPlugins } from '#harnesses/core/plugins';
import { BUILTIN_HARNESSES } from '#harnesses/core/store/session';

type Ctx = { calls: string[]; events: Record<string, string[]> };

const scripted = (name: string, events: string[]): ActionDef<Ctx> => ({
  events,
  run: async (ctx) => {
    ctx.calls.push(name);
    const next = ctx.events[name]?.shift();
    return next === undefined ? { pause: `${name}: нет события` } : { event: next };
  },
});

function registry(): Registry<Ctx> {
  return {
    actions: new Map([
      ['work', scripted('work', ['done', 'again'])],
      ['ask', scripted('ask', ['yes', 'no'])],
      ['end', scripted('end', [])],
    ]),
    guards: new Map([['never', () => false]]),
  };
}

const YAML = `harness: test-loop
initial: work
limits: { loop: 2 }
states:
  work:
    action: work
    on:
      done: ask
      again:
        - { to: work, count: loop }
        - ask
  ask:
    actor: user
    action: ask
    on:
      yes: done
      no: { to: work, reset: [loop] }
  done:
    final: true
    action: end
`;

function def(text = YAML): MachineDef {
  const parsed = parseMachine(text, 'h.yaml');
  expect(parsed.errors).toEqual([]);
  if (parsed.def === undefined) throw new Error('нет def');
  return parsed.def;
}

describe('harness.yaml: форма и статическая проверка', () => {
  it('встроенный plan-review проходит статическую проверку', async () => {
    const result = await loadHarness(path.join(tmpdir(), 'нет-такого-home'), 'plan-review');
    expect(result.errors).toEqual([]);
    expect(result.harness?.def.limits).toEqual({ formal: 3, fix: 3 });
    expect(result.harness?.def.review).toEqual({ mode: 'collect', budget: { crit: 0, warn: 3 } });
  });

  it('ошибка формы называет путь до поля', () => {
    const bad = parseMachine(YAML.replace('limits: { loop: 2 }', 'limits: { loop: 0 }'), 'h.yaml');
    expect(bad.errors.join('\n')).toContain('h.yaml/limits/loop');
    const expr = parseMachine(
      YAML.replace('done: ask', "done: 'counter > 2 ? ask : work'"),
      'h.yaml',
    );
    expect(expr.errors.join('\n')).toContain('h.yaml/states/work/on/done');
  });

  it('чистый граф — без ошибок', () => {
    expect(staticErrors(def(), registry(), 'h.yaml')).toEqual([]);
  });

  it('недостижимое состояние, тупик, лишнее и необработанное событие, неизвестные имена', () => {
    const r = registry();
    const unreachable = def(`${YAML}  lost:\n    final: true\n`);
    expect(staticErrors(unreachable, r, 'h.yaml')).toEqual([
      'h.yaml/states/lost: недостижимо из work',
    ]);

    const deadEnd = def(
      YAML.replace('    on:\n      yes: done\n      no: { to: work, reset: [loop] }\n', ''),
    );
    expect(staticErrors(deadEnd, r, 'h.yaml').join('\n')).toContain('тупик');

    const missing = def(YAML.replace('      yes: done\n', ''));
    expect(staticErrors(missing, r, 'h.yaml')).toContain(
      'h.yaml/states/ask/on: не обработано событие yes',
    );

    const unknown = def(
      YAML.replace('action: end', 'action: nope').replace(
        '- ask\n',
        '- { to: ask, guard: maybe }\n        - ask\n',
      ),
    );
    const errors = staticErrors(unknown, r, 'h.yaml').join('\n');
    expect(errors).toContain('нет действия nope');
    expect(errors).toContain('нет guard maybe');
  });

  it('цикл без лимита — ошибка; лимит или решение человека его разрывают', () => {
    const r = registry();
    const noLimit = def(YAML.replace('- { to: work, count: loop }', '- work'));
    expect(staticErrors(noLimit, r, 'h.yaml').join('\n')).toContain('цикл без лимита: work → work');
    const scriptAsk = def(YAML.replace('    actor: user\n', ''));
    expect(staticErrors(scriptAsk, r, 'h.yaml').join('\n')).toContain('цикл без лимита');
    const noFallback = def(
      YAML.replace(
        '        - { to: work, count: loop }\n        - ask\n',
        '        - { to: work, count: loop }\n',
      ),
    );
    expect(staticErrors(noFallback, r, 'h.yaml').join('\n')).toContain('запасной вариант');
  });

  it('graph — Mermaid автомата с лимитами и сбросами', () => {
    const mermaid = machineMermaid(def());
    expect(mermaid).toContain('stateDiagram-v2');
    expect(mermaid).toContain('work --> work: again loop++');
    expect(mermaid).toContain('ask --> work: no loop=0');
    expect(mermaid).toContain('done --> [*]');
  });
});

describe('исполнение', () => {
  it('лимит счётчика: после исчерпания берётся запасной вариант; reset обнуляет', async () => {
    const d = def();
    const ctx: Ctx = { calls: [], events: {} };
    let s: MachineState = { state: 'work', counters: {} };
    s = await resolve(d, registry(), s, 'again', ctx);
    s = await resolve(d, registry(), s, 'again', ctx);
    expect(s).toEqual({ state: 'work', counters: { loop: 2 } });
    s = await resolve(d, registry(), s, 'again', ctx);
    expect(s.state).toBe('ask');
    s = await resolve(d, registry(), s, 'no', ctx);
    expect(s).toEqual({ state: 'work', counters: { loop: 0 } });
  });

  it('пауза и продолжение с сохранённого состояния', async () => {
    const d = def();
    let saved: MachineState = { state: 'work', counters: {} };
    const log: string[] = [];
    const journal = {
      load: async () => saved,
      save: async (next: MachineState, from: string, event: string) => {
        saved = next;
        log.push(`${from} -${event}-> ${next.state}`);
      },
    };
    const ctx: Ctx = { calls: [], events: { work: ['again', 'done'] } };
    const first = await drive(d, registry(), journal, ctx);
    expect(first).toEqual({ paused: 'ask', message: 'ask: нет события' });
    ctx.events['ask'] = ['yes'];
    const second = await drive(d, registry(), journal, ctx);
    expect(second).toEqual({ final: 'done' });
    expect(log).toEqual(['work -again-> work', 'work -done-> ask', 'ask -yes-> done']);
    expect(ctx.calls).toEqual(['work', 'work', 'ask', 'ask', 'end']);
  });
});

describe('плагины', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'harness-plugins-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('.ts и .js из handlers/ грузятся без сборки и переопределяют встроенные', async () => {
    const dir = path.join(home, 'handlers');
    await mkdir(dir);
    await writeFile(
      path.join(dir, 'a.ts'),
      'const always = (_ctx: unknown): boolean => true;\nexport default { guards: { always } };\n',
    );
    await writeFile(
      path.join(dir, 'b.mjs'),
      "export default { actions: { work: { events: ['done'], run: async () => ({ event: 'done' }) } } };\n",
    );
    const r = registry();
    expect(await loadPlugins(r, dir)).toEqual(['a.ts', 'b.mjs']);
    expect(await r.guards.get('always')?.({ calls: [], events: {} })).toBe(true);
    expect(await r.actions.get('work')?.run({ calls: [], events: {} })).toEqual({ event: 'done' });
  });

  it('плагин неверной формы — ошибка с именем файла', async () => {
    const dir = path.join(home, 'handlers');
    await mkdir(dir);
    await writeFile(path.join(dir, 'bad.mjs'), 'export default { actions: { x: { run: 1 } } };\n');
    await expect(loadPlugins(registry(), dir)).rejects.toThrow(
      'handlers/bad.mjs: actions.x.events',
    );
  });

  it('вариант пользователя перекрывает встроенный harness.yaml; ошибки — с путём', async () => {
    const own = path.join(home, 'harnesses/plan-review');
    await mkdir(own, { recursive: true });
    const builtin = await readFile(
      path.join(BUILTIN_HARNESSES, 'plan-review/harness.yaml'),
      'utf8',
    );
    await writeFile(
      path.join(own, 'harness.yaml'),
      builtin.replace('mode: collect', 'mode: parallel'),
    );
    const result = await loadHarness(home, 'plan-review');
    expect(result.errors.join('\n')).toContain('harnesses/plan-review/harness.yaml/review/mode');
  });
});
