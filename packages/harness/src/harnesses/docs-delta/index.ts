import { DOCS_VERIFY } from '#scripts/index';
import type { CommandArgs } from '#shared/args';
import {
  commandAction,
  failureAction,
  handoff,
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
        handoff<ProcessContext>(
          (ctx) =>
            `собери дельту context/.delta/${ctx.session.data.title}.yml из намерений и примени её пункты по skill docs-keeper`,
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
  options: '[--name <дельта>]',
  title: (args: CommandArgs) => args.name ?? 'delta',
});
