export const FSM_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'harness.yaml — автомат harness',
  type: 'object',
  additionalProperties: false,
  required: ['harness', 'initial', 'states'],
  $defs: {
    name: { type: 'string', pattern: '^[a-z][a-z0-9_-]*$' },
    transition: {
      oneOf: [
        { $ref: '#/$defs/name' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['to'],
          properties: {
            to: { $ref: '#/$defs/name' },
            count: { $ref: '#/$defs/name' },
            reset: { type: 'array', items: { $ref: '#/$defs/name' } },
            guard: { $ref: '#/$defs/name' },
          },
        },
      ],
    },
  },
  properties: {
    harness: {
      description: 'Имя harness: категория-вид через дефис, совпадает с каталогом',
      type: 'string',
      pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)+$',
    },
    description: { type: 'string' },
    initial: { $ref: '#/$defs/name' },
    limits: {
      type: 'object',
      propertyNames: { $ref: '#/$defs/name' },
      additionalProperties: { type: 'integer', minimum: 1 },
    },
    review: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { enum: ['collect', 'sequential'] },
        budget: {
          type: 'object',
          additionalProperties: false,
          required: ['crit', 'warn'],
          properties: {
            crit: { type: 'integer', minimum: 0 },
            warn: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    models: {
      type: 'object',
      additionalProperties: false,
      properties: {
        planner: { type: 'string', minLength: 1 },
        '1b': { type: 'string', minLength: 1 },
        '2': { type: 'string', minLength: 1 },
      },
    },
    states: {
      type: 'object',
      minProperties: 1,
      propertyNames: { $ref: '#/$defs/name' },
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: 'string' },
          actor: { enum: ['script', 'model', 'user'] },
          action: { $ref: '#/$defs/name' },
          final: { type: 'boolean' },
          on: {
            type: 'object',
            propertyNames: { $ref: '#/$defs/name' },
            additionalProperties: {
              oneOf: [
                { $ref: '#/$defs/transition' },
                { type: 'array', minItems: 1, items: { $ref: '#/$defs/transition' } },
              ],
            },
          },
        },
      },
    },
  },
} as const;
