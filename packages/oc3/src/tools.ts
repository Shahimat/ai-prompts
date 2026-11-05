import type { Plugin } from '@opencode/plugin';
import type { CommandArgs } from '@shahimat/ai-core';
import { isRecord, SUBMIT_TOOL } from '@shahimat/ai-core';
import path from 'node:path';
import { markBriefingAcked } from '#briefing-gate';
import { submitResult, SUBMIT_INPUT } from '#submit';
import { OC3_COMMANDS } from '#tree';

async function captured(run: () => Promise<number>): Promise<{ content: string }> {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  const push = (...data: unknown[]): void => {
    lines.push(data.map((part) => String(part)).join(' '));
  };
  console.log = push;
  console.error = push;
  try {
    const code = await run();
    return { content: `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}exit ${code}` };
  } finally {
    console.log = log;
    console.error = error;
  }
}

const str = (description: string): Record<string, unknown> => ({ type: 'string', description });

interface Oc3Tool {
  readonly name: string;
  readonly description: string;
  readonly input: Record<string, unknown>;
  readonly command: (args: CommandArgs) => Promise<number>;
  readonly args: (input: Record<string, unknown>, root: string) => CommandArgs;
}

const base = (root: string): CommandArgs => ({ root, now: new Date() });

const withParams = (
  input: Record<string, unknown>,
  root: string,
  keys: readonly string[],
): CommandArgs => {
  const args = base(root);
  const params: Record<string, string> = {};
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string') params[key] = value;
  }
  if (Object.keys(params).length > 0) args.params = params;
  return args;
};

const withOptions = (
  input: Record<string, unknown>,
  root: string,
  keys: readonly string[],
): CommandArgs => {
  const args = base(root);
  for (const key of keys) {
    const value = input[key];
    if (key === 'file' && typeof value === 'string') args.file = value;
    if (key === 'ticket' && typeof value === 'string') args.ticket = value;
  }
  return args;
};

const TOOLS: readonly Oc3Tool[] = [
  {
    name: 'models_list',
    description: 'Роли проекта и их модели',
    input: { type: 'object', properties: {}, additionalProperties: false },
    command: OC3_COMMANDS.modelsList,
    args: (_input, root) => base(root),
  },
  {
    name: 'models_set',
    description:
      'Сменить модель роли: любая из каталога OpenCode вида provider/model[#variant]; сохраняется в .oc3/project.yml → roles.models',
    input: {
      type: 'object',
      properties: { role: str('имя роли'), model: str('модель вида provider/model#variant') },
      required: ['role', 'model'],
      additionalProperties: false,
    },
    command: OC3_COMMANDS.modelsSet,
    args: (input, root) => withParams(input, root, ['role', 'model']),
  },
  {
    name: 'models_apply',
    description:
      'Применить roles.models из .oc3/project.yml к .agents/agents и .opencode/agents — восстановление после source-sync',
    input: { type: 'object', properties: {}, additionalProperties: false },
    command: OC3_COMMANDS.modelsApply,
    args: (_input, root) => base(root),
  },
  {
    name: 'briefing_show',
    description: 'Режим работы сессии оператора из .oc3/project.yml → briefing',
    input: { type: 'object', properties: {}, additionalProperties: false },
    command: OC3_COMMANDS.briefingShow,
    args: (_input, root) => base(root),
  },
  {
    name: 'briefing_set',
    description: 'Задать режим сессии: cheap или roles — пресеты, custom — с четырьмя полями',
    input: {
      type: 'object',
      properties: {
        mode: str('cheap | roles | custom'),
        routing: str('custom: operator | executor'),
        research: str('custom: self | researcher'),
        judge: str('custom: on | off'),
        ticket_mode: str('custom: stop | all'),
      },
      required: ['mode'],
      additionalProperties: false,
    },
    command: OC3_COMMANDS.briefingSet,
    args: (input, root) =>
      withParams(input, root, ['mode', 'routing', 'research', 'judge', 'ticket_mode']),
  },
  {
    name: 'goals_check',
    description: 'AST-проверка правок файла цели по baseline тикета',
    input: {
      type: 'object',
      properties: { file: str('.oc3/goals/<goal>.expect.ts'), ticket: str('ключ тикета') },
      required: ['file', 'ticket'],
      additionalProperties: false,
    },
    command: OC3_COMMANDS.goalsCheck,
    args: (input, root) => withOptions(input, root, ['file', 'ticket']),
  },
  {
    name: 'goals_status',
    description: 'Стадии целей, программы и активный тикет',
    input: {
      type: 'object',
      properties: { file: str('файл цели или программы; без него — все программы') },
      additionalProperties: false,
    },
    command: OC3_COMMANDS.goalsStatus,
    args: (input, root) => withOptions(input, root, ['file']),
  },
  {
    name: 'operator_check',
    description: 'Лимиты scratchpad оператора (200 строк / 16 KB)',
    input: { type: 'object', properties: {}, additionalProperties: false },
    command: OC3_COMMANDS.operatorCheck,
    args: (_input, root) => base(root),
  },
  {
    name: 'roles_check',
    description: 'Проверка ролей и привязки skills',
    input: { type: 'object', properties: {}, additionalProperties: false },
    command: OC3_COMMANDS.rolesCheck,
    args: (_input, root) => base(root),
  },
  {
    name: 'skills_check',
    description: 'Проверка каталога skills',
    input: { type: 'object', properties: {}, additionalProperties: false },
    command: OC3_COMMANDS.skillsCheck,
    args: (_input, root) => base(root),
  },
  {
    name: 'adapters_check',
    description: 'Проверка производных файлов и memory guard',
    input: { type: 'object', properties: {}, additionalProperties: false },
    command: OC3_COMMANDS.adaptersCheck,
    args: (_input, root) => base(root),
  },
];

const toRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

export async function registerTools(ctx: Plugin.Context): Promise<void> {
  const root = ctx.location.directory;
  await ctx.tool.transform((editor) => {
    editor.namespace({ name: 'oc3', description: 'Контракт v3: модели, цели, проверки' });
    for (const tool of TOOLS)
      editor.add({
        name: tool.name,
        description: tool.description,
        input: tool.input,
        options: { namespace: 'oc3', codemode: true },
        execute: (input: unknown) => captured(() => tool.command(tool.args(toRecord(input), root))),
      });
    editor.add({
      name: SUBMIT_TOOL,
      description:
        'Итог работы роли по протоколу harness: message — result | verdict | question, data — строго по схеме сообщения; вызови один раз в конце, лишние поля запрещены; доступен только ролям контракта, сессии без роли получают отказ',
      input: SUBMIT_INPUT,
      options: { namespace: 'oc3', codemode: true },
      execute: (input: unknown, context: { agent: string; sessionID: string }) =>
        submitResult({
          root,
          agent: context.agent,
          sessionID: context.sessionID,
          input,
        }).then((content: string) => ({ content })),
    });
    editor.add({
      name: 'briefing_done',
      description:
        'Отметить брифинг сессии проведённым: вызови после ответа человека на вопрос «дефолт проекта или кастом на сессию»; до отметки гейт отказывает bash/edit/write/subagent, после — работа сессии разблокируется',
      input: { type: 'object', properties: {}, additionalProperties: false },
      options: { namespace: 'oc3', codemode: true },
      execute: (_input: unknown, context: { agent: string; sessionID: string }) =>
        markBriefingAcked(root, context.sessionID, new Date()).then((file: string) => ({
          content: `брифинг сессии отмечен (${path.relative(root, file)}) — bash/edit/write/subagent разблокированы`,
        })),
    });
  });
}
