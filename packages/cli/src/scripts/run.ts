import type { CommandArgs } from '@shahimat/ai-core';
import { CONFIG_PATH, loadConfig } from '@shahimat/ai-core';
import { UsageError } from '@shahimat/ai-core';
import type { ScriptDef } from '@shahimat/ai-core';
import { COMMAND_NODES } from '@shahimat/ai-core';
import { memoryInstalled } from '@shahimat/ai-core';
import { commandProofRun, runRegisteredCommand } from '@shahimat/ai-core';

const commandOf = (path: readonly string[]) =>
  COMMAND_NODES.find((c) => c.path.length === path.length && c.path.every((p, i) => p === path[i]));

const canonicalMemoryStep = (command: readonly string[]): boolean =>
  command.length === 2 &&
  command[0] === 'memory' &&
  (command[1] === 'build' || command[1] === 'check');

export async function runScript(script: ScriptDef, args: CommandArgs): Promise<number> {
  const proofRun = await commandProofRun(args);
  const name = script.path.join(' ');
  const gated = script.steps.some((s) => s.enabledBy !== undefined);
  const config = gated ? await loadConfig(args.root) : null;
  if (gated && config === null)
    throw new UsageError(`нет ${CONFIG_PATH}: harness в проекте не настроен`);
  const hasMemoryStep = script.steps.some((step) => canonicalMemoryStep(step.command));
  const installedMemory = hasMemoryStep && memoryInstalled(args.root);
  if (hasMemoryStep && !installedMemory) console.log('memory: не установлена — шаг пропущен');
  const steps = script.steps.filter(
    (s) =>
      (!canonicalMemoryStep(s.command) || installedMemory) &&
      (s.enabledBy === undefined || config?.checks[s.enabledBy] !== undefined),
  );
  if (steps.length === 0) {
    console.log(`${name}: в ${CONFIG_PATH} не включено ни одной проверки`);
    return 0;
  }
  let code = 0;
  for (const step of steps) {
    const command = commandOf(step.command);
    if (command === undefined) throw new Error(`${name}: нет команды ${step.command.join(' ')}`);
    const childArgs = { ...args, proofRun, params: {} };
    code = Math.max(
      code,
      await runRegisteredCommand(step.command, childArgs, () => command.run(childArgs)),
    );
  }
  const ran = steps.map((s) => s.command.join(' ')).join(', ');
  if (code === 0) console.log(`${name} (${ran}): ok`);
  else console.error(`${name} (${ran}): есть нарушения`);
  return code;
}
