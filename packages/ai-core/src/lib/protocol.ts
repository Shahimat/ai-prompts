export const PROTOCOL_MESSAGES = ['result', 'verdict', 'question'] as const;
export type ProtocolMessage = (typeof PROTOCOL_MESSAGES)[number];

export const isProtocolMessage = (v: unknown): v is ProtocolMessage =>
  PROTOCOL_MESSAGES.some((m) => m === v);

export const SUBMIT_TOOL = 'submit_result';
export const CHANNEL_SERVER = 'harness';
export const SUBMIT_TOOL_ID = `mcp__${CHANNEL_SERVER}__${SUBMIT_TOOL}`;

const strings = { type: 'array', items: { type: 'string' } };

const RESULT = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'result — итог работы роли',
  type: 'object',
  additionalProperties: false,
  required: ['status', 'changed', 'failed', 'questions', 'report'],
  properties: {
    status: { enum: ['done', 'failed'] },
    changed: strings,
    failed: strings,
    questions: strings,
    report: { type: 'string', maxLength: 1500 },
  },
};

const ANSWER = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'verdict', 'ref', 'quote', 'reason'],
  properties: {
    id: { type: 'string' },
    verdict: { type: 'boolean' },
    ref: { type: 'string' },
    quote: { type: 'string' },
    reason: { type: 'string' },
  },
};

const CONFLICT = {
  type: 'object',
  additionalProperties: false,
  required: ['file_a', 'quote_a', 'file_b', 'quote_b', 'reason'],
  properties: {
    file_a: { type: 'string', minLength: 1 },
    quote_a: { type: 'string', minLength: 1 },
    file_b: { type: 'string', minLength: 1 },
    quote_b: { type: 'string', minLength: 1 },
    reason: { type: 'string', minLength: 1 },
  },
};

const VERDICT = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title:
    'verdict — ответ судьи: вердикты пакета, проверка заголовков или противоречия в документации',
  type: 'object',
  additionalProperties: false,
  properties: {
    answers: { type: 'array', items: ANSWER },
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['a', 'b', 'reason'],
        properties: { a: { type: 'string' }, b: { type: 'string' }, reason: { type: 'string' } },
      },
    },
    unmeasurable: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'reason'],
        properties: { id: { type: 'string' }, reason: { type: 'string' } },
      },
    },
    conflicts: { type: 'array', items: CONFLICT },
  },
  oneOf: [
    { required: ['answers'] },
    { required: ['contradictions', 'unmeasurable'] },
    { required: ['conflicts'] },
  ],
};

const QUESTION = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'question — блокирующий вопрос человеку',
  type: 'object',
  additionalProperties: false,
  required: ['question', 'options', 'default', 'reason'],
  properties: {
    question: { type: 'string', minLength: 1 },
    options: {
      type: 'array',
      minItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label'],
        properties: { label: { type: 'string', minLength: 1 }, description: { type: 'string' } },
      },
    },
    default: { type: 'string', minLength: 1 },
    reason: { type: 'string', minLength: 1 },
  },
};

export const INTENT_KINDS = [
  'decision',
  'fact',
  'rule',
  'behavior-change',
  'task',
  'manual',
] as const;

export const INTENTS_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'intents — вход роли docs-keeper: намерения записи в документацию',
  type: 'object',
  additionalProperties: false,
  required: ['intents'],
  properties: {
    intents: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'summary'],
        properties: {
          kind: { enum: INTENT_KINDS },
          summary: { type: 'string', minLength: 1, pattern: '^[^\\n]+$' },
          evidence: { type: 'string' },
        },
      },
    },
  },
};

export const PROTOCOL: Readonly<Record<ProtocolMessage, object>> = {
  result: RESULT,
  verdict: VERDICT,
  question: QUESTION,
};
