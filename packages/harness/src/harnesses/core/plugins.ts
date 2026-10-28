import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ActionDef, ActionResult, Guard, Registry } from './fsm/machine.ts';
import { UsageError } from '@shahimat/ai-core';
import { errorCode, isRecord, isStringArray } from '@shahimat/ai-core';

function asResult(value: unknown, where: string): ActionResult {
  if (isRecord(value) && typeof value['event'] === 'string') return { event: value['event'] };
  if (isRecord(value) && typeof value['pause'] === 'string') return { pause: value['pause'] };
  throw new Error(`${where}: действие вернуло не { event } и не { pause }`);
}

function pluginAction<C>(value: unknown, where: string): ActionDef<C> {
  if (!isRecord(value)) throw new UsageError(`${where}: действие должно быть объектом`);
  const { events, run } = value;
  if (!isStringArray(events)) throw new UsageError(`${where}.events: список строк`);
  if (typeof run !== 'function') throw new UsageError(`${where}.run: функция`);
  return {
    events,
    run: async (ctx) => {
      const result: unknown = await Promise.resolve(Reflect.apply(run, undefined, [ctx]));
      return asResult(result, where);
    },
  };
}

function pluginGuard<C>(value: unknown, where: string): Guard<C> {
  if (typeof value !== 'function') throw new UsageError(`${where}: guard должен быть функцией`);
  return async (ctx) => {
    const result: unknown = await Promise.resolve(Reflect.apply(value, undefined, [ctx]));
    if (typeof result !== 'boolean') throw new Error(`${where}: guard вернул не boolean`);
    return result;
  };
}

export async function loadPlugins<C>(registry: Registry<C>, dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => /\.(m?js|ts)$/.test(n)).sort();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  for (const name of names) {
    const where = `handlers/${name}`;
    const mod: unknown = await import(pathToFileURL(path.join(dir, name)).href);
    const plugin = isRecord(mod) ? mod['default'] : undefined;
    if (!isRecord(plugin))
      throw new UsageError(`${where}: нет export default { actions?, guards? }`);
    const { actions, guards } = plugin;
    if (isRecord(actions))
      for (const [key, a] of Object.entries(actions))
        registry.actions.set(key, pluginAction<C>(a, `${where}: actions.${key}`));
    if (isRecord(guards))
      for (const [key, g] of Object.entries(guards))
        registry.guards.set(key, pluginGuard<C>(g, `${where}: guards.${key}`));
  }
  return names;
}
