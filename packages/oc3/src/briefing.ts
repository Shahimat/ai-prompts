import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { isOneOf, isRecord, UsageError, type CommandArgs } from '@shahimat/ai-core';

const MODES = ['cheap', 'roles', 'custom'] as const;
const ROUTINGS = ['operator', 'executor'] as const;
const RESEARCH = ['self', 'researcher'] as const;
const JUDGES = ['on', 'off'] as const;
const TICKET_MODES = ['stop', 'all'] as const;
const CUSTOM_KEYS = ['routing', 'research', 'judge', 'ticket_mode'] as const;

export interface Briefing {
  mode: string;
  routing?: string;
  research?: string;
  judge?: string;
  ticket_mode?: string;
}

const FILE_LABEL = 'context/project.yml';

export async function runBriefing(command: string | undefined, args: CommandArgs): Promise<number> {
  const file = path.join(args.root, 'context', 'project.yml');
  if (command === 'set') return briefingSet(file, args.params ?? {});
  return briefingShow(file);
}

async function briefingShow(file: string): Promise<number> {
  const data: unknown = parse(await readProject(file));
  const briefing = isRecord(data) ? data['briefing'] : undefined;
  if (!isBriefing(briefing)) {
    console.log(
      'briefing не задан — дефолт cheap: тикеты делает оператор, доку — librarian, judge — off',
    );
    return 0;
  }
  console.log(describeBriefing(briefing).join('\n'));
  return 0;
}

async function briefingSet(file: string, params: Record<string, string>): Promise<number> {
  const mode = params['mode'];
  if (mode === undefined) throw new UsageError('briefing set <cheap|roles|custom>');
  if (!isOneOf(MODES, mode))
    throw new UsageError(`режим вне списка: ${mode} (cheap | roles | custom)`);
  const extras = CUSTOM_KEYS.filter((key) => params[key] !== undefined);
  if (mode !== 'custom' && extras.length > 0)
    throw new UsageError(`поля (${extras.join(', ')}) — только у custom; cheap и roles — пресеты`);
  const lines =
    mode === 'custom'
      ? [
          'briefing:',
          '  mode: custom',
          `  routing: ${requireParam(params, 'routing', ROUTINGS)}`,
          `  research: ${requireParam(params, 'research', RESEARCH)}`,
          `  judge: ${requireParam(params, 'judge', JUDGES)}`,
          `  ticket_mode: ${requireParam(params, 'ticket_mode', TICKET_MODES)}`,
        ]
      : ['briefing:', `  mode: ${mode}`];
  await writeBlock(file, lines);
  console.log(`briefing → ${mode} (${FILE_LABEL})`);
  return 0;
}

function requireParam(
  params: Record<string, string>,
  key: (typeof CUSTOM_KEYS)[number],
  allowed: readonly string[],
): string {
  const value = params[key];
  if (value === undefined || !isOneOf(allowed, value))
    throw new UsageError(`${key} — ${allowed.join(' | ')}`);
  return value;
}

export function isBriefing(value: unknown): value is Briefing {
  return isRecord(value) && typeof value['mode'] === 'string';
}

export function describeBriefing(briefing: Briefing): string[] {
  const lines = [`mode: ${briefing.mode}`];
  if (briefing.routing !== undefined) lines.push(`routing: ${briefing.routing}`);
  if (briefing.research !== undefined) lines.push(`research: ${briefing.research}`);
  if (briefing.judge !== undefined) lines.push(`judge: ${briefing.judge}`);
  if (briefing.ticket_mode !== undefined) lines.push(`ticket_mode: ${briefing.ticket_mode}`);
  return lines;
}

async function readProject(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    throw new UsageError(`нет ${FILE_LABEL} — контракт не установлен`);
  }
}

async function writeBlock(file: string, block: readonly string[]): Promise<void> {
  const text = await readProject(file);
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith('briefing:'));
  if (start >= 0) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^[A-Za-z][A-Za-z-]*:/.test(lines[i] ?? '')) {
        end = i;
        break;
      }
    }
    lines.splice(start, end - start, ...block);
  } else {
    const sync = lines.findIndex((line) => line.startsWith('sync:'));
    if (sync >= 0) lines.splice(sync, 0, ...block, '');
    else {
      while (lines.at(-1) === '') lines.pop();
      lines.push('', ...block);
    }
  }
  await writeFile(file, `${lines.join('\n').replace(/\n*$/, '\n')}`, 'utf8');
}
