import { DOCS_VERIFY } from '#scripts/index';
import type { CommandArgs } from '#shared/args';
import {
  commandAction,
  failureAction,
  roleOrHandoff,
  processModule,
  scriptAction,
  type ProcessContext,
  type Registry,
} from '#harnesses/core/index';

function registry(): Registry<ProcessContext> {
  return {
    actions: new Map([
      [
        'delta-apply',
        roleOrHandoff<ProcessContext>(
          'docs-keeper',
          (ctx) =>
            `собери дельту context/.delta/${ctx.session.data.title}.yml из намерений и примени её пункты по skill docs-keeper; процесс docs-delta уже идёт — сам его не запускай, verify и close сделает harness`,
        ),
      ],
      ['docs-verify', scriptAction<ProcessContext>(DOCS_VERIFY)],
      ['delta-close', commandAction<ProcessContext>(['delta', 'close'])],
      ['report-failure', failureAction<ProcessContext>()],
    ]),
    guards: new Map(),
  };
}

export const DOCS_DELTA = processModule('docs-delta', registry, {
  options: '[--name <дельта>] [--file <намерения>]',
  title: (args: CommandArgs) => args.name ?? 'delta',
  request: (args: CommandArgs) => args.file ?? '',
});
