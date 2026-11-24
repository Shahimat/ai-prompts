export const DATA_INDEX_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['key', 'title', 'summary', 'records'],
  properties: {
    key: { type: 'string' },
    title: { type: 'string', pattern: '\\S' },
    summary: { type: 'string', pattern: '\\S' },
    namespace: { type: 'string' },
    skill: { type: ['string', 'null'] },
    records: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'file', 'summary'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
          file: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*\\.yml$' },
          summary: { type: 'string', pattern: '\\S' },
        },
      },
    },
  },
};
