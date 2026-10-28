import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readIntents } from '@shahimat/ai-core';
import { askRole } from '@shahimat/ai-core';
import { DOCS_VERIFY } from '@shahimat/ai-core';
import type { CommandArgs } from '@shahimat/ai-core';
import { errorMessage, isRecord } from '@shahimat/ai-core';
import { DELTA_DIR } from '@shahimat/ai-core';
import {
  commandAction,
  failureAction,
  roleOrHandoff,
  processModule,
  scriptAction,
  type ActionDef,
  type ProcessContext,
  type Registry,
} from '#harnesses/core/index';

export interface Conflict {
  file_a: string;
  quote_a: string;
  file_b: string;
  quote_b: string;
  reason: string;
}

const REVIEW_FILE = 'review.json';

const squash = (t: string): string => t.replace(/\s+/g, ' ').trim();

function isConflict(v: unknown): v is Conflict {
  return (
    isRecord(v) &&
    ['file_a', 'quote_a', 'file_b', 'quote_b', 'reason'].every((k) => typeof v[k] === 'string')
  );
}

export async function quotedConflicts(
  root: string,
  data: unknown,
): Promise<{ conflicts: Conflict[]; rejected: string[] }> {
  const list = isRecord(data) ? data['conflicts'] : undefined;
  if (!Array.isArray(list))
    throw new Error('судья вернул не проверку документации (нет conflicts)');
  const conflicts: Conflict[] = [];
  const rejected: string[] = [];
  const quoted = async (file: string, quote: string): Promise<boolean> => {
    const abs = path.resolve(root, file);
    if (!abs.startsWith(path.resolve(root)) || !existsSync(abs)) return false;
    return squash(await readFile(abs, 'utf8')).includes(squash(quote));
  };
  for (const c of list) {
    if (!isConflict(c)) continue;
    if ((await quoted(c.file_a, c.quote_a)) && (await quoted(c.file_b, c.quote_b)))
      conflicts.push(c);
    else rejected.push(`${c.file_a} ↔ ${c.file_b}: цитата не найдена дословно`);
  }
  return { conflicts, rejected };
}

function changedFiles(root: string): string[] {
  const git = (...args: string[]): string[] =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8' })
      .stdout.split('\n')
      .filter((l) => l !== '');
  return [
    ...new Set([
      ...git('diff', '--name-only', 'HEAD'),
      ...git('ls-files', '--others', '--exclude-standard'),
    ]),
  ]
    .filter((f) => !f.startsWith(`${DELTA_DIR}/`))
    .sort();
}

export function reviewTask(delta: string, changed: string[]): string {
  return [
    'Проверь правку проектной документации на противоречия.',
    '',
    'Противоречие — два утверждения в документации (или документ против источника реальности из `context/project.yml` → `reality`), которые не могут быть верны одновременно. Стиль, полнота и формат — не противоречия.',
    '',
    'Сверяй изменённое с документами, на которые оно ссылается и которые указывает маршрут `AGENTS.md` → «Где искать ответ». Полный обход `docs/` и `context/` запрещён.',
    '',
    `Изменённые файлы:\n${changed.map((f) => `- ${f}`).join('\n') || '- (нет)'}`,
    '',
    `Дельта правки:\n\n${delta}`,
    '',
    'Ответ — сообщение verdict с полем conflicts: по противоречию — file_a, quote_a, file_b, quote_b (цитаты дословно из файлов, пути от корня проекта) и reason. Противоречий нет — пустой список.',
  ].join('\n');
}

function reviewAction(): ActionDef<ProcessContext> {
  return {
    events: ['ok', 'fail'],
    run: async (ctx) => {
      const s = ctx.session;
      const root = s.data.project;
      const deltaPath = path.join(root, DELTA_DIR, `${s.data.title}.yml`);
      const delta = existsSync(deltaPath) ? await readFile(deltaPath, 'utf8') : '(дельты нет)';
      let data: unknown;
      try {
        ({ data } = await askRole(root, 'judge', reviewTask(delta, changedFiles(root))));
      } catch (error) {
        await s.log({ review: 'error', error: errorMessage(error) });
        return {
          pause: `review: роль judge не ответила — ${errorMessage(error)}; исправь причину и запусти harness docs-delta open ${s.short}`,
        };
      }
      const { conflicts, rejected } = await quotedConflicts(root, data);
      await s.log({ review: conflicts.length === 0 ? 'clean' : 'conflicts', conflicts, rejected });
      if (conflicts.length === 0) {
        await rm(s.file(REVIEW_FILE), { force: true });
        return { event: 'ok' };
      }
      await writeFile(s.file(REVIEW_FILE), `${JSON.stringify(conflicts, null, 2)}\n`, 'utf8');
      return { event: 'fail' };
    },
  };
}

function lastConflicts(ctx: ProcessContext): string {
  const file = ctx.session.file(REVIEW_FILE);
  if (!existsSync(file)) return '';
  const list: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(list)) return '';
  const lines = list
    .filter(isConflict)
    .map((c) => `- ${c.file_a} «${c.quote_a}» ↔ ${c.file_b} «${c.quote_b}»: ${c.reason}`);
  return lines.length === 0
    ? ''
    : `; судья нашёл противоречия — разреши их (неочевидное — вопросом пользователю в отчёте):\n${lines.join('\n')}`;
}

function registry(): Registry<ProcessContext> {
  return {
    actions: new Map([
      [
        'delta-apply',
        roleOrHandoff<ProcessContext>(
          'docs-keeper',
          (ctx) =>
            `собери дельту context/.delta/${ctx.session.data.title}.yml из намерений и примени её пункты по skill docs-keeper; процесс docs-delta уже идёт — сам его не запускай, verify, review и close сделает harness${lastConflicts(ctx)}`,
        ),
      ],
      ['docs-verify', scriptAction<ProcessContext>(DOCS_VERIFY)],
      ['docs-review', reviewAction()],
      ['delta-close', commandAction<ProcessContext>(['delta', 'close'])],
      ['report-failure', failureAction<ProcessContext>()],
    ]),
    guards: new Map(),
  };
}

export const DOCS_DELTA = processModule('docs-delta', registry, {
  options: '[--name <дельта>] [--file <намерения | ->]',
  title: (args: CommandArgs) => args.name ?? 'delta',
  request: async (args: CommandArgs) =>
    args.file === undefined ? '' : readIntents(args.root, args.file),
});
