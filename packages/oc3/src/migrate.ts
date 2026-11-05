import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AI_CORE_PATH, BUNDLES_DIR, OPS_PATH, SKILLS_PATH } from '@shahimat/ai-core';
import type { CommandArgs } from '@shahimat/ai-core';
import { ensureMemorySkeleton } from '#install';

const FILE_MAP: readonly (readonly [string, string])[] = [
  ['context/project.yml', '.oc3/doc/project.yml'],
  ['context/autonomy.yml', '.oc3/doc/autonomy.yml'],
  ['context/glossary.yml', '.oc3/doc/glossary/common.yml'],
  ['context/index.yml', '.oc3/doc/index.yml'],
  ['context/ops.yml', '.oc3/ops.yml'],
  ['context/skills.yml', '.oc3/skills.yml'],
  ['context/ai-core.yml', '.oc3/ai-core.yml'],
];

const DIR_MAP: readonly (readonly [string, string])[] = [
  ['context/conventions', '.oc3/doc/conventions'],
  ['context/.delta', '.oc3/.delta'],
  ['context/modules', '.oc3/modules'],
  ['docs/entities', '.oc3/doc/data/entities'],
  ['docs/behavior', '.oc3/doc/data/behavior'],
  ['docs/manuals', '.oc3/doc/manuals'],
  ['docs/knowledge', '.oc3/doc/knowledge'],
  ['goals', '.oc3/goals'],
  ['.ops/feedback', '.oc3/feedback'],
  ['.ops/operator', '.oc3/operator'],
  ['.ops/locks', '.oc3/locks'],
  ['.ops/submit', '.oc3/submit'],
  ['.ops/sessions', '.oc3/sessions'],
  ['.ops/watches', '.oc3/watches'],
  ['.ops/jobs', '.oc3/jobs'],
  ['.ops/suggest', '.oc3/suggest'],
];

const OPS_FLAT: readonly (readonly [string, string])[] = [
  ['research', '.oc3/research'],
  ['reports', '.oc3/reports'],
  ['verdicts', '.oc3/verdicts'],
  ['baseline', '.oc3/baseline'],
];

const OLD_GITIGNORE: readonly (readonly [string, string])[] = [
  ['.ops/operator/', '.oc3/operator/'],
  ['.ops/locks/', '.oc3/locks/'],
  ['.ops/submit/', '.oc3/submit/'],
  ['.ops/sessions/', '.oc3/sessions/'],
];

const NEW_GITIGNORE: readonly string[] = [
  '.oc3/operator/',
  '.oc3/locks/',
  '.oc3/submit/',
  '.oc3/sessions/',
  '.oc3/bundles/',
];

const CONFIG_FILES: readonly string[] = [AI_CORE_PATH, SKILLS_PATH, OPS_PATH];

const PREFIX_MAP: readonly (readonly [string, string])[] = [
  ...FILE_MAP,
  ...DIR_MAP.map(([from, to]) => [`${from}/`, `${to}/`] as const),
];

const OLD_LAYOUT_SIGNATURES: readonly string[] = [
  'context/project.yml',
  'context/ai-core.yml',
  'context/skills.yml',
  '.ops/operator/state.yml',
  '.ops/locks/install',
];

const KNOWN_OPS_ENTRIES = new Set(
  DIR_MAP.filter(([from]) => from.startsWith('.ops/')).map(([from]) => from.slice(5)),
);

export const detectOldLayout = (root: string): boolean =>
  OLD_LAYOUT_SIGNATURES.some((rel) => existsSync(path.join(root, rel)));

interface Report {
  readonly moved: string[];
  readonly legacy: string[];
  readonly configs: string[];
}

const applyPrefixes = (text: string): string => {
  let out = text;
  for (const [from, to] of PREFIX_MAP) out = out.split(from).join(to);
  return out;
};

const walkFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'));
};

const moveFile = async (root: string, from: string, to: string, report: Report): Promise<void> => {
  const absFrom = path.join(root, from);
  const absTo = path.join(root, to);
  if (!existsSync(absFrom)) return;
  if (existsSync(absTo)) {
    report.legacy.push(`${from} → ${to}: цель уже существует — сверь и перенеси вручную`);
    return;
  }
  await mkdir(path.dirname(absTo), { recursive: true });
  await rename(absFrom, absTo);
  report.moved.push(`${from} → ${to}`);
};

const moveTree = async (root: string, from: string, to: string, report: Report): Promise<void> => {
  const absFrom = path.join(root, from);
  if (!existsSync(absFrom)) return;
  const files = await walkFiles(absFrom);
  if (files.length === 0 && !existsSync(path.join(root, to))) {
    await mkdir(path.dirname(path.join(root, to)), { recursive: true });
    await rename(absFrom, path.join(root, to));
    report.moved.push(`${from} → ${to}`);
    return;
  }
  for (const rel of files) await moveFile(root, `${from}/${rel}`, `${to}/${rel}`, report);
};

const pruneEmpty = async (dir: string): Promise<void> => {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries)
    if (entry.isDirectory()) await pruneEmpty(path.join(dir, entry.name));
  const rest = await readdir(dir).catch(() => ['x']);
  if (rest.length === 0) await rm(dir, { recursive: true }).catch(() => undefined);
};

const migrateTicketDirs = async (root: string, report: Report): Promise<void> => {
  const ops = path.join(root, '.ops');
  if (!existsSync(ops)) return;
  const names = (await readdir(ops, { withFileTypes: true })).filter((e) => e.isDirectory());
  for (const entry of names) {
    if (KNOWN_OPS_ENTRIES.has(entry.name)) continue;
    for (const [kind, target] of OPS_FLAT) {
      const from = `.ops/${entry.name}/${kind}`;
      if (!existsSync(path.join(root, from))) continue;
      await moveTree(root, from, `${target}/${entry.name}`, report);
    }
    for (const rel of await walkFiles(path.join(ops, entry.name)))
      report.legacy.push(`.ops/${entry.name}/${rel}: не на карте миграции — перенеси вручную`);
  }
};

const scanLegacy = async (root: string, report: Report): Promise<void> => {
  for (const top of ['context', 'docs', '.ops']) {
    const abs = path.join(root, top);
    if (!existsSync(abs)) continue;
    for (const rel of await walkFiles(abs))
      report.legacy.push(`${top}/${rel}: не на карте миграции — перенеси вручную`);
    for (const rel of (await readdir(abs, { withFileTypes: true })).filter((e) => e.isDirectory()))
      report.legacy.push(`${top}/${rel.name}/: остался после переезда — проверь и удали вручную`);
  }
};

const rewriteConfigs = async (root: string, report: Report): Promise<void> => {
  for (const rel of CONFIG_FILES) {
    const abs = path.join(root, rel);
    const text = await readFile(abs, 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    const next = applyPrefixes(text);
    if (next === text) continue;
    await writeFile(abs, next, 'utf8');
    report.configs.push(`${rel}: префиксы путей заменены на .oc3/`);
  }
};

const rewriteGitignore = async (root: string, report: Report): Promise<void> => {
  const abs = path.join(root, '.gitignore');
  const text = await readFile(abs, 'utf8').catch(() => undefined);
  if (text === undefined) return;
  let lines = text.replace(/\n*$/, '\n').split('\n');
  for (const [from, to] of OLD_GITIGNORE) lines = lines.map((l) => (l === from ? to : l));
  const have = new Set(lines.map((l) => l.trim()));
  const missing = NEW_GITIGNORE.filter((l) => !have.has(l));
  if (missing.length > 0) lines = [...lines, ...missing];
  const next = lines.join('\n');
  if (next === text) return;
  await writeFile(abs, next, 'utf8');
  report.configs.push(`.gitignore: строки .ops/ заменены на .oc3/, добавлен ${BUNDLES_DIR}/`);
};

export async function migrateLayout(root: string): Promise<string[]> {
  const report: Report = { moved: [], legacy: [], configs: [] };
  await mkdir(path.join(root, BUNDLES_DIR), { recursive: true });
  for (const [from, to] of FILE_MAP) await moveFile(root, from, to, report);
  for (const [from, to] of DIR_MAP) await moveTree(root, from, to, report);
  await migrateTicketDirs(root, report);
  await rewriteConfigs(root, report);
  await rewriteGitignore(root, report);
  for (const top of ['context', 'docs', 'goals', '.ops']) await pruneEmpty(path.join(root, top));
  await scanLegacy(root, report);
  const lines: string[] = [];
  for (const m of report.moved) lines.push(`layout: ${m}`);
  for (const c of report.configs) lines.push(`layout: ${c}`);
  for (const l of new Set(report.legacy)) lines.push(`layout: legacy — ${l}`);
  if (lines.length === 0) lines.push(`layout: переносить нечего, ${BUNDLES_DIR}/ на месте`);
  for (const line of await ensureMemorySkeleton(root)) lines.push(`layout: ${line}`);
  return lines;
}

export async function runMigrate(args: CommandArgs): Promise<number> {
  if (!detectOldLayout(args.root)) {
    console.log('oc3 migrate: старая раскладка (context/, docs/, goals/, .ops/) не обнаружена');
    return 0;
  }
  const lines = await migrateLayout(args.root);
  for (const line of lines) console.log(line);
  console.log('oc3 migrate: готово — проверь legacy-хвосты и закоммить переезд');
  return 0;
}
