import type { CommandArgs } from '#shared/args';
import { CONFIG_PATH, loadConfig } from '#shared/config';
import { UsageError } from '#shared/diagnostics';
import type { ScriptDef } from '#shared/node';
import { COMMAND_NODES } from './commands.ts';

const commandOf = (path: readonly string[]) =>
  COMMAND_NODES.find((c) => c.path.length === path.length && c.path.every((p, i) => p === path[i]));

export async function runScript(script: ScriptDef, args: CommandArgs): Promise<number> {
  const name = script.path.join(' ');
  const gated = script.steps.some((s) => s.enabledBy !== undefined);
  const config = gated ? await loadConfig(args.root) : null;
  if (gated && config === null)
    throw new UsageError(`нет ${CONFIG_PATH}: harness в проекте не настроен`);
  const steps = script.steps.filter(
    (s) => s.enabledBy === undefined || config?.checks[s.enabledBy] !== undefined,
  );
  if (steps.length === 0) {
    console.log(`${name}: в ${CONFIG_PATH} не включено ни одной проверки`);
    return 0;
  }
  let code = 0;
  for (const step of steps) {
    const command = commandOf(step.command);
    if (command === undefined) throw new Error(`${name}: нет команды ${step.command.join(' ')}`);
    code = Math.max(code, await command.run({ ...args, params: {} }));
  }
  const ran = steps.map((s) => s.command.join(' ')).join(', ');
  if (code === 0) console.log(`${name} (${ran}): ok`);
  else console.error(`${name} (${ran}): есть нарушения`);
  return code;
}
