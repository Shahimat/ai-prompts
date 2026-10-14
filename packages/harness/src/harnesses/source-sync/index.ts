// source-sync: синхронизация проекта с источниками промптов. harness
// сообщает о новой версии, агент обновляет файлы, harness пересобирает и
// проверяет проект.

import { REFRESH } from '../../scripts/index.ts';
import {
  failureAction,
  handoff,
  processModule,
  reportAction,
  scriptAction,
  type ProcessContext,
  type Registry,
} from '../core/index.ts';

function registry(): Registry<ProcessContext> {
  return {
    actions: new Map([
      ['harness-outdated', reportAction<ProcessContext>(['outdated'])],
      [
        'source-update',
        handoff<ProcessContext>(
          () =>
            'сверь источники по их index.yml и обнови подключённые файлы и version в context/harness.yml по skill source-sync',
        ),
      ],
      ['source-refresh', scriptAction<ProcessContext>(REFRESH)],
      ['report-failure', failureAction<ProcessContext>()],
    ]),
    guards: new Map(),
  };
}

export const SOURCE_SYNC = processModule('source-sync', registry, { title: () => 'sync' });
