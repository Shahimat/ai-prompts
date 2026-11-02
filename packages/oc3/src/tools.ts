import type { Plugin } from '@opencode/plugin';
import type { CommandArgs } from '@shahimat/ai-core';
import { isRecord } from '@shahimat/ai-core';
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
    description: 'Сменить модель роли; допустимо платное семейство zai/glm-5.3',
    input: {
      type: 'object',
      properties: { role: str('имя роли'), model: str('модель вида zai/glm-5.3#max') },
      required: ['role', 'model'],
      additionalProperties: false,
    },
    command: OC3_COMMANDS.modelsSet,
    args: (input, root) => withParams(input, root, ['role', 'model']),
  },
  {
    name: 'goals_check',
    description: 'AST-проверка правок файла цели по baseline тикета',
    input: {
      type: 'object',
      properties: { file: str('goals/<goal>.expect.ts'), ticket: str('ключ тикета') },
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
  });
}
