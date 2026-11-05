import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  compileSchema,
  errorMessage,
  findRole,
  isProtocolMessage,
  isRecord,
  PROTOCOL,
  PROTOCOL_MESSAGES,
  SUBMIT_TOOL,
  type ProtocolMessage,
  type SchemaIssue,
} from '@shahimat/ai-core';

const ENV_OUT = 'HARNESS_SUBMIT_OUT';
const SESSION_PATTERN = /^[A-Za-z0-9._-]+$/;

const fail = (message: string): Error => new Error(`${SUBMIT_TOOL}: ${message}`);

const text = (issue: SchemaIssue): string =>
  `${issue.path || '/'} ${issue.message}${issue.extra === undefined ? '' : `: ${issue.extra}`}`;

const branch = (message: ProtocolMessage): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  required: ['message', 'data'],
  properties: {
    message: { const: message },
    data: Object.fromEntries(
      Object.entries(PROTOCOL[message]).filter(([key]) => key !== '$schema'),
    ),
  },
});

export const SUBMIT_INPUT: Record<string, unknown> = {
  oneOf: PROTOCOL_MESSAGES.map(branch),
};

const ENVELOPE_CHECK: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'data'],
  properties: {
    message: { enum: [...PROTOCOL_MESSAGES] },
    data: { type: 'object' },
  },
};

const envelope = compileSchema(ENVELOPE_CHECK);

export interface SubmitCall {
  readonly root: string;
  readonly agent: string | undefined;
  readonly sessionID: string;
  readonly input: unknown;
}

const outOf = (root: string, sessionID: string): string => {
  const env = process.env[ENV_OUT];
  if (env !== undefined && env.trim() !== '') return path.resolve(env);
  if (!SESSION_PATTERN.test(sessionID)) throw fail(`sessionID некорректен: ${sessionID}`);
  return path.join(root, '.oc3', 'submit', `${sessionID}.json`);
};

export async function submitResult(call: SubmitCall): Promise<string> {
  const agent = call.agent;
  if (agent === undefined || agent === '')
    throw fail('агент сессии неизвестен — итог возвращают только роли контракта');
  const role = await findRole(call.root, agent).catch((error: unknown) => {
    throw fail(`${errorMessage(error)} — итог возвращают только роли, сессия без роли отклонена`);
  });
  const issues = envelope(call.input);
  if (issues.length > 0) throw fail(`конверт не по схеме: ${issues.map(text).join('; ')}`);
  if (!isRecord(call.input)) throw fail('конверт не объект');
  const message = call.input['message'];
  if (!isProtocolMessage(message))
    throw fail(`message — сообщение протокола: ${PROTOCOL_MESSAGES.join(' | ')}`);
  if (message !== role.output)
    throw fail(`роль ${role.name} возвращает ${String(role.output)}, а не ${message}`);
  const data = call.input['data'];
  const inner = compileSchema(PROTOCOL[message])(data);
  if (inner.length > 0) throw fail(`data не по схеме ${message}: ${inner.map(text).join('; ')}`);
  if (!isRecord(data)) throw fail(`data — объект схемы ${message}`);
  const out = outOf(call.root, call.sessionID);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return `принято (${message}) — итог в ${out}`;
}
