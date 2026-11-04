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

const DEFAULT_STDIN_TIMEOUT_S = 10;

export function stdinTimeoutMs(): number {
  const raw = process.env['HARNESS_STDIN_TIMEOUT_S'];
  const n = raw === undefined ? Number.NaN : Number.parseFloat(raw);
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_STDIN_TIMEOUT_S) * 1000;
}

async function stdinText(): Promise<string> {
  if (process.stdin.isTTY === true)
    throw new InputError(
      `stdin — терминал: подай намерения файлом (--file <путь>) или перенаправлением (--file - < intents.yml)`,
    );
  const limit = stdinTimeoutMs();
  const iterator = process.stdin[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let timer: NodeJS.Timeout | undefined;
  try {
    for (;;) {
      const wait = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new InputError(
                `stdin молчит ${Math.round(limit / 1000)} с — данные не поданы и поток не закрыт; подай файл: --file - < intents.yml (таймаут — HARNESS_STDIN_TIMEOUT_S)`,
              ),
            ),
          limit,
        );
      });
      let next: IteratorResult<Buffer>;
      try {
        next = await Promise.race([iterator.next(), wait]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      if (next.done === true) break;
      const chunk = next.value;
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
  } catch (error) {
    process.stdin.destroy();
    throw error;
  }
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
