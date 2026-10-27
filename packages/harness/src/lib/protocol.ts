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

const VERDICT = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'verdict — ответ судьи: вердикты пакета или проверка заголовков',
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
  },
  oneOf: [{ required: ['answers'] }, { required: ['contradictions', 'unmeasurable'] }],
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

export const PROTOCOL: Readonly<Record<ProtocolMessage, object>> = {
  result: RESULT,
  verdict: VERDICT,
  question: QUESTION,
};
