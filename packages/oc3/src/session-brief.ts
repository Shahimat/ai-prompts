import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import {
  buildBundles,
  checkBundles,
  isRecord,
  startIndexText,
  writeGraph,
  type Diagnostic,
} from '@shahimat/ai-core';
import type { Plugin } from '@opencode/plugin';
import { describeBriefing, isBriefing } from '#briefing';

const PROJECT_FILE = path.join('.oc3', 'doc', 'project.yml');
const DEFAULT_LINE =
  'брифинг: режим не задан — дефолт cheap: тикеты сам, доку librarian, judge off; до старта спроси схему (дефолтная или кастомная; достаточно текстового ответа), затем вызови oc3.briefing_done';

export interface BriefingSystemPart {
  type: 'text';
  text: string;
}

export interface BriefingSystem {
  system: BriefingSystemPart[];
}

export async function briefingLine(root: string): Promise<string> {
  let text: string;
  try {
    text = await readFile(path.join(root, PROJECT_FILE), 'utf8');
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
  return `брифинг: режим ${mode} — до ролей и тикетов спроси схему работы (дефолтная или кастомная; достаточно текстового ответа), затем вызови oc3.briefing_done; детали — skill workflow`;
}

export async function appendBriefing(
  input: BriefingSystem,
  root: string,
  seen: Set<string>,
  sessionID: string,
): Promise<void> {
  if (seen.has(sessionID)) return;
  const line = await briefingLine(root);
  input.system.push({ type: 'text', text: line });
  const memory = await memoryStart(root);
  if (memory.text !== '') input.system.push({ type: 'text', text: memory.text });
  for (const d of memory.diagnostics) console.error(`oc3 memory: ${d.file}: ${d.message}`);
  seen.add(sessionID);
}

export interface MemoryStart {
  text: string;
  diagnostics: Diagnostic[];
}

const injectText = async (root: string): Promise<string> => {
  const text = await startIndexText(root);
  return text === null ? '' : `Оперативная память проекта (стартовый граф):\n\n${text.trimEnd()}`;
};

export async function memoryStart(root: string): Promise<MemoryStart> {
  const check = await checkBundles(root);
  if (check.graph === null) return { text: '', diagnostics: check.diagnostics };
  const collected = check.diagnostics.length > 0 || (await startIndexText(root)) === null;
  if (!collected) return { text: await injectText(root), diagnostics: [] };
  const build = await buildBundles(root);
  if (build.graph === null || build.diagnostics.length > 0)
    return {
      text: '',
      diagnostics: build.diagnostics.length > 0 ? build.diagnostics : check.diagnostics,
    };
  await writeGraph(root, build.graph);
  return { text: await injectText(root), diagnostics: [] };
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
