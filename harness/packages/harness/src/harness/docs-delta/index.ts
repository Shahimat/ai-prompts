// docs/delta: запись в проектную документацию через дельту. Агент
// docs-keeper собирает и применяет дельту, harness проверяет и закрывает её.

import { DOCS_VERIFY } from '../../scripts/index.ts';
import type { CommandArgs } from '../../shared/args.ts';
import {
  commandAction,
  failureAction,
  handoff,
  processModule,
  scriptAction,
  type ProcessContext,
  type Registry,
} from '../core/index.ts';

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

export const DOCS_DELTA = processModule('docs/delta', registry);

/** `harness docs delta start --name <дельта>`: имя файла дельты без расширения. */
export const runDocsStart = (args: CommandArgs): Promise<number> =>
  DOCS_DELTA.start(args, args.name ?? 'delta');
