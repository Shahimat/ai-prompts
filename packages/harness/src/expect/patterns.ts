import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { crit, pattern } from '@shahimat/ai-core/expect';
import { HARNESS } from '#cli';
import { BUILTIN_HARNESSES, parseMachine } from '#harnesses/index';
import { expect } from 'vitest';

const OPS = ['start', 'open x', 'list', 'status x', 'validate', 'graph'];

export const harnessCommands = pattern('harness-commands', (o: { harness: string }) => {
  crit(`команды harness ${o.harness} start | open | list | status | validate | graph`, () => {
    expect(
      OPS.filter((op) => HARNESS.findCommand([o.harness, ...op.split(' ')]) === undefined),
    ).toEqual([]);
  });
});

export interface ChainStep {
  state: string;
  event: string;
}

export interface ChainOptions {
  harness: string;
  chain: readonly ChainStep[];
  fails: readonly string[];
  back: string;
  limit: number;
}

async function builtinMachine(harness: string) {
  const file = path.join(BUILTIN_HARNESSES, harness, 'harness.yaml');
  const { def, errors } = parseMachine(await readFile(file, 'utf8'), file);
  if (def === undefined) throw new Error(errors.join('\n'));
  return def;
}

export const harnessChain = pattern('harness-chain', (o: ChainOptions) => {
  const states = o.chain.map((s) => s.state).join(' → ');
  crit(
    `автомат ${o.harness}: ${states}; провал ${o.fails.join(' или ')} возвращает в ${o.back} не больше ${o.limit} раз, затем failed`,
    async () => {
      const def = await builtinMachine(o.harness);
      const on = (state: string, event: string) =>
        (def.states.find((s) => s.name === state)?.on[event] ?? []).map((t) =>
          t.count === undefined ? { to: t.to } : { to: t.to, count: t.count },
        );
      const counter = on(o.fails[0] ?? '', 'fail')[0]?.count ?? '';
      const forward = o.chain.map((s) => ({
        state: s.state,
        next: on(s.state, s.event),
      }));
      expect({
        initial: def.initial,
        forward,
        fails: o.fails.map((f) => ({ state: f, on: on(f, 'fail') })),
        limit: def.limits[counter],
        retry: on('failed', 'retry'),
        reset: def.states.find((s) => s.name === 'failed')?.on['retry']?.[0]?.reset ?? [],
        done: def.states.find((s) => s.name === 'done')?.final,
      }).toEqual({
        initial: o.chain[0]?.state,
        forward: o.chain.map((s, i) => ({
          state: s.state,
          next: [{ to: o.chain[i + 1]?.state ?? 'done' }],
        })),
        fails: o.fails.map((f) => ({
          state: f,
          on: [{ to: o.back, count: counter }, { to: 'failed' }],
        })),
        limit: o.limit,
        retry: [{ to: o.back }],
        reset: [counter],
        done: true,
      });
    },
  );
});
