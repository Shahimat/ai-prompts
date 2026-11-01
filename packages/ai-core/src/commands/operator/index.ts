import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type { CommandArgs } from '#shared/args';
import { UsageError, type Diagnostic } from '#shared/diagnostics';
import { errorCode, isRecord } from '#shared/guards';
import { report, warn } from '#shared/report';

const STATE = '.ops/operator/state.yml';
const LINES = 200;
const BYTES = 16 * 1024;
const FIELDS: readonly string[] = [
  'session',
  'goal',
  'priorities',
  'programs',
  'tickets',
  'results',
  'waits',
  'open_questions',
  'pointers',
  'updated_at',
] as const;

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

function isStringList(value: unknown): boolean {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && v !== '');
}

async function check(args: CommandArgs): Promise<number> {
  const text = await readOrNull(path.join(args.root, STATE));
  if (text === null) {
    console.log(`${STATE}: нет файла — ок`);
    return 0;
  }
  const diagnostics: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const lines = text.split('\n').length;
  const bytes = Buffer.byteLength(text, 'utf8');
  if (lines > LINES) diagnostics.push({ file: STATE, message: `строк ${lines} > ${LINES}` });
  else if (lines > LINES * 0.8)
    warnings.push({ file: STATE, message: `строк ${lines} > 80% от ${LINES}` });
  if (bytes > BYTES) diagnostics.push({ file: STATE, message: `байт ${bytes} > ${BYTES}` });
  else if (bytes > BYTES * 0.8)
    warnings.push({ file: STATE, message: `байт ${bytes} > 80% от ${BYTES}` });
  warn(warnings);

  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    diagnostics.push({ file: STATE, message: `невалидный YAML: ${String(error)}` });
    return report('operator state check', diagnostics);
  }
  if (!isRecord(data)) {
    diagnostics.push({ file: STATE, message: 'корень — объект' });
    return report('operator state check', diagnostics);
  }
  for (const key of Object.keys(data))
    if (!FIELDS.includes(key))
      diagnostics.push({ file: STATE, message: `неизвестное поле ${key}` });
  if (typeof data['updated_at'] !== 'string' || data['updated_at'] === '')
    diagnostics.push({ file: STATE, message: 'нет updated_at' });
  if (typeof data['session'] !== 'string' || data['session'] === '')
    diagnostics.push({ file: STATE, message: 'нет session' });
  if (typeof data['goal'] !== 'string' || data['goal'] === '')
    diagnostics.push({ file: STATE, message: 'нет goal' });
  for (const key of [
    'priorities',
    'programs',
    'tickets',
    'results',
    'waits',
    'open_questions',
    'pointers',
  ]) {
    if (data[key] !== undefined && !isStringList(data[key]))
      diagnostics.push({ file: STATE, message: `${key} — список строк` });
  }
  return report('operator state check', diagnostics);
}

export async function runOperator(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command === 'check') return check(args);
  throw new UsageError(`неизвестная команда: operator ${command ?? ''}`.trimEnd());
}
