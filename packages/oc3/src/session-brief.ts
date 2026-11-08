import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import {
  ensureMemory,
  memoryInstalled,
  pendingViewOf,
  PENDING_KNOWLEDGE_MARKER,
  isRecord,
  PROJECT_PATH,
  type Diagnostic,
} from '@shahimat/ai-core';
import type { Plugin } from '@opencode/plugin';
import { describeBriefing, isBriefing } from '#briefing';

const DEFAULT_LINE =
  'брифинг: режим не задан — дефолт проекта — cheap: тикеты сам, доку librarian, judge off; до старта спроси: работаем в дефолте проекта или собираешь кастом на сессию (роли и модели можно добавить или убрать); достаточно текстового ответа, затем вызови oc3.briefing_done';

export interface BriefingSystemPart {
  type: 'text';
  text: string;
}

export interface BriefingSystem {
  system: BriefingSystemPart[];
}

const MEMORY_PREFIX = 'Оперативная память проекта (стартовый граф):';
const injectedMemory = new WeakMap<Set<string>, Map<string, string>>();

export async function briefingLine(root: string): Promise<string> {
  let text: string;
  try {
    text = await readFile(path.join(root, PROJECT_PATH), 'utf8');
  } catch {
    return DEFAULT_LINE;
  }
  let data: unknown;
  try {
    data = parse(text);
  } catch {
    return DEFAULT_LINE;
  }
  const briefing = isRecord(data) ? data['briefing'] : undefined;
  if (!isBriefing(briefing)) return DEFAULT_LINE;
  const extras = describeBriefing(briefing).slice(1).join(', ');
  const mode = extras === '' ? briefing.mode : `${briefing.mode} (${extras})`;
  return `брифинг: дефолт проекта — режим ${mode}; до ролей и тикетов спроси: работаем в дефолте проекта или собираешь кастом на сессию (роли и модели можно добавить или убрать); достаточно текстового ответа, затем вызови oc3.briefing_done; детали — skill workflow`;
}

export async function appendBriefing(
  input: BriefingSystem,
  root: string,
  seen: Set<string>,
  sessionID: string,
): Promise<void> {
  const pending = await pendingViewOf(root);
  for (let index = input.system.length - 1; index >= 0; index--)
    if (input.system[index]?.text.startsWith(PENDING_KNOWLEDGE_MARKER) === true)
      input.system.splice(index, 1);
  if (pending !== '') input.system.push({ type: 'text', text: pending });
  const memory = await memoryStart(root);
  if (memory.diagnostics.length > 0 && memoryInstalled(root)) {
    seen.delete(sessionID);
    injectedMemory.get(seen)?.delete(sessionID);
    throw new Error(
      `oc3 memory: ${memory.diagnostics.map((d) => `${d.file}: ${d.message}`).join('; ')}`,
    );
  }
  const loaded = injectedMemory.get(seen) ?? new Map<string, string>();
  if (seen.has(sessionID) && (memory.text === '' || loaded.get(sessionID) === memory.text)) return;
  if (!seen.has(sessionID)) input.system.push({ type: 'text', text: await briefingLine(root) });
  for (let index = input.system.length - 1; index >= 0; index--)
    if (input.system[index]?.text.startsWith(MEMORY_PREFIX) === true) input.system.splice(index, 1);
  if (memory.text !== '') input.system.push({ type: 'text', text: memory.text });
  for (const d of memory.diagnostics) console.error(`oc3 memory: ${d.file}: ${d.message}`);
  seen.add(sessionID);
  loaded.set(sessionID, memory.text);
  injectedMemory.set(seen, loaded);
}

export interface MemoryStart {
  text: string;
  diagnostics: Diagnostic[];
}

export async function memoryStart(root: string): Promise<MemoryStart> {
  const report = await ensureMemory(root);
  if (report.graph === null || report.diagnostics.length > 0)
    return { text: '', diagnostics: report.diagnostics };
  return {
    text: `${MEMORY_PREFIX}\n\n${report.graph.start.trimEnd()}`,
    diagnostics: [],
  };
}

export async function registerSessionBrief(ctx: Plugin.Context): Promise<Plugin.Cleanup> {
  const root = ctx.location.directory;
  const seen = new Set<string>();
  const registration = await ctx.session.hook('context', (input) =>
    appendBriefing(input, root, seen, input.sessionID),
  );
  return async () => {
    await registration.dispose();
  };
}
