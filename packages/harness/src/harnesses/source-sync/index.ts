import { REFRESH } from '@shahimat/ai-core';
import {
  failureAction,
  handoff,
  processModule,
  reportAction,
  scriptAction,
  type ProcessContext,
  type Registry,
} from '#harnesses/core/index';

function registry(): Registry<ProcessContext> {
  return {
    actions: new Map([
      ['harness-outdated', reportAction<ProcessContext>(['outdated'])],
      [
        'source-update',
        handoff<ProcessContext>(
          () =>
            'сверь источники по их index.yml и обнови подключённые файлы и version в context/ai-core.yml по skill source-sync',
        ),
      ],
      ['source-refresh', scriptAction<ProcessContext>(REFRESH)],
      ['report-failure', failureAction<ProcessContext>()],
    ]),
    guards: new Map(),
  };
}

export const SOURCE_SYNC = processModule('source-sync', registry, { title: () => 'sync' });
