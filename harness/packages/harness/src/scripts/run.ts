// Исполнитель скриптов: единственное место слоя scripts, где есть логика.
// Объявления скриптов — данные (`ScriptDef`), команды ищет дерево CLI.

import type { CommandArgs } from '../shared/args.ts';
import { CONFIG_PATH, loadConfig } from '../shared/config.ts';
import { UsageError } from '../shared/diagnostics.ts';
import type { ScriptDef } from '../shared/node.ts';

export type FindRun = (
  path: readonly string[],
) => ((args: CommandArgs) => Promise<number>) | undefined;

/**
 * Выполняет шаги по порядку, все до конца: код выхода — худший из кодов
 * шагов. Шаг с `enabledBy` выполняется, только если проверка включена в
 * context/harness.yml.
 */
export async function runScript(
  script: ScriptDef,
  args: CommandArgs,
  find: FindRun,
): Promise<number> {
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
    const run = find(step.command);
    if (run === undefined) throw new Error(`${name}: нет команды ${step.command.join(' ')}`);
    code = Math.max(code, await run({ ...args, params: {} }));
  }
  const ran = steps.map((s) => s.command.join(' ')).join(', ');
  if (code === 0) console.log(`${name} (${ran}): ok`);
  else console.error(`${name} (${ran}): есть нарушения`);
  return code;
}
