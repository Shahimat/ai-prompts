import { readFile, readdir } from 'node:fs/promises';
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

export function docsGuard(agent: string | undefined, paths: readonly string[]): string | undefined {
  for (const p of paths) {
    const rel = p.replace(/^\.\//, '');
    const hit =
      DOCS_AREAS.some((a) => rel.startsWith(a) || rel.includes(`/${a}`)) ||
      rel === 'CHANGELOG.md' ||
      rel.endsWith('/CHANGELOG.md');
    if (hit && agent !== 'librarian')
      return `docs guard: документацию пишет только librarian; правка ${p} агентом ${agent ?? 'main'} отклонена`;
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
      const docs = docsGuard(event.agent, event.resources);
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
