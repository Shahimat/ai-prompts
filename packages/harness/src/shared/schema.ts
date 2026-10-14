import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';

export interface SchemaIssue {
  path: string;
  message: string;
  extra?: string;
}

export type Validate = (data: unknown) => SchemaIssue[];

function issue(e: ErrorObject): SchemaIssue {
  const extra: unknown = e.params['additionalProperty'];
  const found: SchemaIssue = { path: e.instancePath, message: e.message ?? '' };
  if (typeof extra === 'string') found.extra = extra;
  return found;
}

export const issueText = (i: SchemaIssue): string =>
  `${i.message}${i.extra === undefined ? '' : `: ${i.extra}`}`;

const toValidate =
  (validate: ReturnType<Ajv2020['compile']>): Validate =>
  (data) =>
    validate(data) === true ? [] : (validate.errors ?? []).map(issue);

const ajv = new Ajv2020({ allErrors: true, strict: false });

export const compileSchema = (schema: object): Validate => toValidate(ajv.compile(schema));

export function schemaSet(schemas: Record<string, object>): (name: string) => Validate | undefined {
  const instance = new Ajv2020({ allErrors: true, strict: false });
  for (const [name, schema] of Object.entries(schemas)) instance.addSchema(schema, name);
  return (name) => {
    const validate = instance.getSchema(name);
    return validate === undefined ? undefined : toValidate(validate);
  };
}

export function schemaErrors(schema: object, data: unknown, where: string): string[] {
  return compileSchema(schema)(data).map((i) => `${where}${i.path} ${issueText(i)}`.trim());
}
