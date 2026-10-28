import type { CommandArgs } from '#shared/args';

export interface Runtime {
  self: readonly string[];
  runScript: (path: readonly string[], args: CommandArgs) => Promise<number>;
}

let current: Runtime | undefined;

export function setRuntime(runtime: Runtime): void {
  current = runtime;
}

export function runtime(): Runtime {
  if (current === undefined)
    throw new Error('runtime не задан: команды, скрипты и автоматы запускаются через CLI ai');
  return current;
}
