import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { UsageError } from '#shared/diagnostics';
import { errorMessage } from '#shared/guards';
import { compileSchema, issueText } from '#shared/schema';
import { INTENTS_SCHEMA } from './protocol.ts';

const validate = compileSchema(INTENTS_SCHEMA);

export function parseIntents(text: string, where: string): string {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new UsageError(`${where}: не YAML и не JSON — ${errorMessage(error).split('\n')[0]}`);
  }
  const wrapped: unknown = Array.isArray(data) ? { intents: data } : data;
  const issues = validate(wrapped);
  if (issues.length > 0)
    throw new UsageError(
      `${where}: намерения не по схеме intents — ${issues.map((i) => `${i.path || '/'} ${issueText(i)}`).join('; ')}`,
    );
  return JSON.stringify(wrapped);
}

async function stdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

export async function readIntents(root: string, file: string): Promise<string> {
  const text = file === '-' ? await stdinText() : await readFile(path.resolve(root, file), 'utf8');
  return parseIntents(text, file === '-' ? 'stdin' : file);
}
