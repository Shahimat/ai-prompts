import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import type { Plugin } from '@opencode/plugin';
import { isRecord } from '@shahimat/ai-core';

export interface GoalRuns {
  file: string;
  runs: number;
  retry: boolean;
}

const DOCS_AREAS = ['docs/', 'context/'];

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

export async function isOperatorCentric(root: string): Promise<boolean> {
  const text = await readOrNull(path.join(root, 'context/project.yml'));
  if (text === null) return false;
  let data: unknown;
  try {
    data = parse(text);
  } catch {
    return false;
  }
  if (!isRecord(data) || !isRecord(data['sync']) || !isRecord(data['sync']['contract']))
    return false;
  return data['sync']['contract']['edition'] === 'operator-centric';
}

export async function docsGuard(
  agent: string | undefined,
  paths: readonly string[],
  root: string,
): Promise<string | undefined> {
  if (existsSync(path.join(root, '.ops/locks/install'))) return undefined;
  for (const p of paths) {
    const rel = p.replace(/^\.\//, '');
    const hit = DOCS_AREAS.some((a) => rel.startsWith(a)) || rel === 'CHANGELOG.md';
    if (hit && agent !== 'librarian')
      return `docs guard: документацию пишет только librarian; правка ${p} агентом ${agent ?? 'main'} отклонена`;
  }
  return undefined;
}

const GENERATED_FILES = new Set(['context/index.yml']);
const GENERATED_AREA = '.opencode/agents/';
const GENERATED_MARKER = /^\s*(?:[#>]|<!--)?\s*generated\b[\s\S]*do not edit/i;
const GENERATED_PROBE = 400;

async function isGenerated(p: string, root: string): Promise<boolean> {
  const rel = path.relative(root, path.resolve(root, p)).split(path.sep).join('/');
  if (!GENERATED_FILES.has(rel) && !rel.startsWith(GENERATED_AREA)) return false;
  const text = await readOrNull(path.resolve(root, rel));
  if (text === null) return false;
  return GENERATED_MARKER.test(text.slice(0, GENERATED_PROBE));
}

export async function generatedGuard(
  agent: string | undefined,
  paths: readonly string[],
  root: string,
): Promise<string | undefined> {
  if (agent === 'librarian') return undefined;
  for (const p of paths) {
    if (!(await isGenerated(p, root))) continue;
    return `generated guard: ${p} сгенерирован harness-ом (метка «generated … do not edit»); правка агентом ${agent ?? 'main'} отклонена — правь источник и запусти пересборку (npm run index:build / ai adapters sync)`;
  }
  return undefined;
}

export function memoryGuard(paths: readonly string[], root: string): string | undefined {
  for (const p of paths) {
    if (!p.includes('/memory/')) continue;
    const abs = p.startsWith('~/') ? path.join(homedir(), p.slice(2)) : path.resolve(root, p);
    const inside = abs === root || abs.startsWith(`${root}${path.sep}`);
    if (!inside)
      return `memory guard: запись в память инструмента (${p}) запрещена; устойчивое — в репозиторий через librarian`;
  }
  return undefined;
}

export function runGate(goals: readonly GoalRuns[]): string | undefined {
  for (const goal of goals) {
    if (goal.runs >= 3)
      return `гейт прогонов: ${goal.file} — три run'а исчерпаны, следующий шаг — человек`;
    if (goal.runs >= 2 && !goal.retry)
      return `гейт прогонов: ${goal.file} — попытка завершена (2 run'а); повторный цикл — только retry: true от оператора`;
  }
  return undefined;
}

export async function goalRuns(root: string): Promise<GoalRuns[]> {
  let names: string[] = [];
  try {
    names = (await readdir(path.join(root, 'goals'))).sort();
  } catch {
    return [];
  }
  const out: GoalRuns[] = [];
  for (const name of names.filter((n) => n.endsWith('.expect.json'))) {
    const text = await readOrNull(path.join(root, 'goals', name));
    if (text === null) continue;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      continue;
    }
    if (!isRecord(data)) continue;
    const results = Array.isArray(data['results']) ? data['results'] : [];
    out.push({ file: `goals/${name}`, runs: results.length, retry: data['retry'] === true });
  }
  return out;
}

const targetIsJudge = (agent: string | undefined, hints: readonly string[]): boolean => {
  const all = [...hints, agent ?? ''];
  return all.some((hint) => hint.includes('judge'));
};

export async function registerGuards(ctx: Plugin.Context): Promise<void> {
  const root = ctx.location.directory;
  await ctx.permission.hook('evaluate', async (event) => {
    if (event.action === 'edit' || event.action === 'write') {
      const generated = await generatedGuard(event.agent, event.resources, root);
      if (generated !== undefined) {
        event.effect = 'deny';
        event.message = generated;
        return;
      }
      const docs = await docsGuard(event.agent, event.resources, root);
      if (docs !== undefined) {
        event.effect = 'deny';
        event.message = docs;
        return;
      }
      const memory = memoryGuard(event.resources, root);
      if (memory !== undefined) {
        event.effect = 'deny';
        event.message = memory;
      }
      return;
    }
    if (event.action === 'subagent' && targetIsJudge(event.agent, event.resources)) {
      const gate = runGate(await goalRuns(root));
      if (gate !== undefined) {
        event.effect = 'deny';
        event.message = gate;
      }
    }
  });
}
