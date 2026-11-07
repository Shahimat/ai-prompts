import type { Plugin } from '@opencode/plugin';
import type { CommandArgs } from '@shahimat/ai-core';
import {
  isRecord,
  SUBMIT_TOOL,
  KNOWLEDGE_DELTA_SCHEMA,
  KNOWLEDGE_SELECTION_SCHEMA,
  knowledgeSelectionOf,
  enqueueKnowledge,
  pendingViewOf,
  queryPendingKnowledge,
  prepareKnowledgeBatch,
  loadTaskPacket,
  taskPreflight,
  taskReady,
  verifyTask,
  localSnapshot,
  digestOf,
} from '@shahimat/ai-core';
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
      'Сменить модель роли provider/model[#variant]: при manifest.json сохраняется только manifest и производные; без manifest — legacy roles.models и файлы ролей',
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
      'Применить manifest.json к производным без изменения канона; без manifest — восстановить legacy roles.models после source-sync',
    input: { type: 'object', properties: {}, additionalProperties: false },
    command: OC3_COMMANDS.modelsApply,
    args: (_input, root) => base(root),
  },
  {
    name: 'models_check',
    description: 'Проверить manifest.json и drift производных без записи и AI',
    input: { type: 'object', properties: {}, additionalProperties: false },
    command: OC3_COMMANDS.modelsCheck,
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

export async function nativeKnowledgeEnqueue(
  root: string,
  input: unknown,
  context: { agent: string; sessionID: string },
): Promise<{ content: string }> {
  if (!isRecord(input) || Object.keys(input).some((key) => key !== 'knowledge_delta'))
    throw new Error('INVALID_DELTA');
  const snapshot = await localSnapshot(root);
  const receipt = await enqueueKnowledge(
    {
      root,
      actor: `operator/native:${context.agent}`,
      channel: 'manual-native',
      execution: digestOf({ session: context.sessionID, snapshot: snapshot.scope }),
      start: snapshot,
    },
    input['knowledge_delta'],
  );
  return { content: JSON.stringify(receipt ?? { pending: 0 }) };
}

export async function registerTools(ctx: {
  location: { directory: string };
  tool: Pick<Plugin.Context['tool'], 'transform'>;
}): Promise<void> {
  const root = ctx.location.directory;
  await ctx.tool.transform((editor) => {
    editor.namespace({ name: 'oc3', description: 'Контракт v3: модели, цели, проверки' });
    editor.add({
      name: 'knowledge_enqueue',
      description: 'Durable pending evidence, не канон; без AI',
      input: {
        type: 'object',
        additionalProperties: false,
        required: ['knowledge_delta'],
        properties: { knowledge_delta: KNOWLEDGE_DELTA_SCHEMA },
      },
      options: { namespace: 'oc3', codemode: true },
      execute: (input: unknown, context: { agent: string; sessionID: string }) =>
        nativeKnowledgeEnqueue(root, input, context),
    });
    for (const command of ['pending', 'batch'] as const)
      editor.add({
        name: `knowledge_${command}`,
        description: 'Bounded pending knowledge; batch только explicit scope/topic',
        input:
          command === 'batch'
            ? KNOWLEDGE_SELECTION_SCHEMA
            : {
                anyOf: [
                  { type: 'object', properties: {}, additionalProperties: false },
                  KNOWLEDGE_SELECTION_SCHEMA,
                ],
              },
        options: { namespace: 'oc3', codemode: true },
        execute: async (input: unknown) => {
          if (!isRecord(input)) throw new Error('INVALID_SELECTION');
          if (command === 'pending' && Object.keys(input).length === 0)
            return { content: await pendingViewOf(root) };
          const selection = knowledgeSelectionOf(input);
          return {
            content: JSON.stringify(
              command === 'batch'
                ? await prepareKnowledgeBatch(root, selection)
                : await queryPendingKnowledge(root, selection),
            ),
          };
        },
      });
    for (const command of ['preflight', 'verify', 'ready'] as const)
      editor.add({
        name: `operator_${command}`,
        description: 'Task packet gate без AI; managed owner verification',
        input: {
          type: 'object',
          additionalProperties: false,
          required: command === 'verify' ? ['file', 'name'] : ['file'],
          properties: { file: str('task packet'), name: str('declared check') },
        },
        options: { namespace: 'oc3', codemode: true },
        execute: async (input: unknown, context: { agent: string; sessionID: string }) => {
          if (!isRecord(input) || typeof input['file'] !== 'string')
            throw new Error('INVALID_TASK_PACKET');
          const packet = await loadTaskPacket(root, input['file']);
          const result =
            command === 'preflight'
              ? await taskPreflight(root, packet)
              : command === 'ready'
                ? await taskReady(root, packet)
                : typeof input['name'] === 'string'
                  ? await verifyTask(
                      root,
                      packet,
                      input['name'],
                      context.agent,
                      `native:${context.agent}:${context.sessionID}`,
                    )
                  : undefined;
          if (result === undefined) throw new Error('UNKNOWN_CHECK');
          return { content: JSON.stringify(result) };
        },
      });
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
