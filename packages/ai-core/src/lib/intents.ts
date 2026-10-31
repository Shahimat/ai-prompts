import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { InputError } from '#shared/diagnostics';
import { errorCode, errorMessage } from '#shared/guards';
import { compileSchema, issueText } from '#shared/schema';
import { INTENTS_SCHEMA, INTENTS_SHAPE } from './protocol.ts';

const validate = compileSchema(INTENTS_SCHEMA);

const expected = `ожидается: ${INTENTS_SHAPE}`;

export function parseIntents(text: string, where: string): string {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new InputError(
      `${where}: не YAML и не JSON — ${errorMessage(error).split('\n')[0]}\n${expected}`,
    );
  }
  const wrapped: unknown = Array.isArray(data) ? { intents: data } : data;
  const issues = validate(wrapped);
  if (issues.length > 0)
    throw new InputError(
      `${where}: намерения не по схеме intents — ${issues.map((i) => `${i.path || '/'} ${issueText(i)}`).join('; ')}\n${expected}`,
    );
  return JSON.stringify(wrapped);
}

async function stdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

async function fileText(root: string, file: string): Promise<string> {
  try {
    return await readFile(path.resolve(root, file), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') throw new InputError(`${file}: файла нет\n${expected}`);
    throw error;
  }
}

export async function readIntents(root: string, file: string): Promise<string> {
  const text = file === '-' ? await stdinText() : await fileText(root, file);
  return parseIntents(text, file === '-' ? 'stdin' : file);
}
