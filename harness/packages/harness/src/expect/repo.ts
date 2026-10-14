import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { normalizeEol, parseFrontmatter, type Frontmatter } from '../frontmatter.ts';
import { isRecord } from '../guards.ts';
import { collectEntries, type IndexEntry } from '../prompt-index.ts';

/** Корень репозитория для зондов: HARNESS_EXPECT_ROOT или cwd. */
export function repoRoot(): string {
  return path.resolve(process.env['HARNESS_EXPECT_ROOT'] ?? process.cwd());
}

export async function readRepo(rel: string): Promise<string> {
  return normalizeEol(await readFile(path.join(repoRoot(), rel), 'utf8'));
}

/** Markdown-документ репозитория с удобными зондами. */
export interface Doc {
  path: string;
  text: string;
  frontmatter: Frontmatter | null;
  lines: number;
  bytes: number;
  headings: string[];
  /** Текст раздела с заголовком `heading` (любого уровня) до следующего заголовка того же или более высокого уровня. */
  section(heading: string): string | null;
}

const HEADING = /^(#{1,6}) (.+)$/;

/** Раздел markdown по тексту заголовка; заголовки внутри ``` не считаются. */
export function extractSection(text: string, heading: string): string | null {
  const lines = text.split('\n');
  let inFence = false;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) inFence = !inFence;
    if (inFence) continue;
    const m = HEADING.exec(line);
    if (m === null) continue;
    const depth = (m[1] ?? '').length;
    if (start === -1) {
      if ((m[2] ?? '').trim() === heading) {
        start = i;
        level = depth;
      }
    } else if (depth <= level) {
      return lines.slice(start, i).join('\n').trimEnd();
    }
  }
  return start === -1 ? null : lines.slice(start).join('\n').trimEnd();
}

function headingsOf(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const m = inFence ? null : HEADING.exec(line);
    if (m !== null) out.push((m[2] ?? '').trim());
  }
  return out;
}

export async function doc(rel: string): Promise<Doc> {
  const text = await readRepo(rel);
  return {
    path: rel,
    text,
    frontmatter: text.startsWith('---\n') ? parseFrontmatter(text) : null,
    lines: text.replace(/\n$/, '').split('\n').length,
    bytes: Buffer.byteLength(text, 'utf8'),
    headings: headingsOf(text),
    section: (heading) => extractSection(text, heading),
  };
}

let entriesCache: Promise<IndexEntry[]> | null = null;

/** Записи индекса источника (собираются из файлов, не из prompts/index.yml). */
export function indexEntries(): Promise<IndexEntry[]> {
  entriesCache ??= collectEntries(repoRoot()).then((r) => r.entries);
  return entriesCache;
}

async function entry(kind: string, key: string): Promise<IndexEntry> {
  const found = (await indexEntries()).find((e) => e.kind === kind && e.key === key);
  if (found === undefined) throw new Error(`${kind} «${key}» нет в индексе`);
  return found;
}

/** Все ```-блоки языка `lang` (в том числе с отступом — в списке), текст которых начинается с `prefix`; отступ снимается. */
export function codeBlocks(text: string, lang: string, prefix = ''): string[] {
  const re = new RegExp('^([ \\t]*)(`{3,4})' + lang + '\\n([\\s\\S]*?)\\n\\1\\2$', 'gm');
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const indent = (m[1] ?? '').length;
    const body = (m[3] ?? '')
      .split('\n')
      .map((l) => l.slice(Math.min(indent, l.length - l.trimStart().length)))
      .join('\n');
    if (body.startsWith(prefix)) out.push(body);
  }
  return out;
}

/** Первый ```-блок языка `lang` (в том числе с отступом — в списке), текст которого начинается с `prefix`; отступ снимается. */
export function codeBlock(text: string, lang: string, prefix = ''): string | null {
  const re = new RegExp('^([ \\t]*)(`{3,4})' + lang + '\\n([\\s\\S]*?)\\n\\1\\2$', 'gm');
  for (const m of text.matchAll(re)) {
    const indent = (m[1] ?? '').length;
    const body = (m[3] ?? '')
      .split('\n')
      .map((l) => l.slice(Math.min(indent, l.length - l.trimStart().length)))
      .join('\n');
    if (body.startsWith(prefix)) return body;
  }
  return null;
}

export interface ContractDoc extends Doc {
  key: string;
  /** Шаблон AGENTS.md из раздела «Шаблон `AGENTS.md`». */
  agentsMdTemplate: string | null;
}

export async function contract(key: string): Promise<ContractDoc> {
  const e = await entry('contract', key);
  const d = await doc(e.path);
  return { ...d, key, agentsMdTemplate: codeBlock(d.text, 'markdown', '# ') };
}

export interface ModuleDoc extends Doc {
  key: string;
  /** Блок модуля для AGENTS.md между маркерами, с маркерами. */
  agentsMdBlock: string | null;
  /** Первый yaml-блок `provides:` модуля. */
  provides: Record<string, unknown> | null;
  /** Все блоки `provides:` модуля — у модулей для v2 и v3 их несколько. */
  providesAll: Record<string, unknown>[];
}

export async function module(key: string): Promise<ModuleDoc> {
  const e = await entry('module', key);
  const d = await doc(e.path);
  const block = new RegExp(`<!-- module:${key} -->[\\s\\S]*?<!-- /module:${key} -->`).exec(d.text);
  const all = codeBlocks(d.text, 'yaml', 'provides:').map((b): Record<string, unknown> => {
    const data: unknown = parse(b);
    const provides = isRecord(data) ? data['provides'] : undefined;
    return isRecord(provides) ? provides : {};
  });
  return {
    ...d,
    key,
    agentsMdBlock: block === null ? null : block[0],
    provides: all[0] ?? null,
    providesAll: all,
  };
}

export async function modules(): Promise<ModuleDoc[]> {
  const keys = (await indexEntries()).filter((e) => e.kind === 'module').map((e) => e.key);
  return Promise.all(keys.map((k) => module(k)));
}

export interface SkillDoc extends Doc {
  name: string;
  description: string;
}

export async function skill(name: string): Promise<SkillDoc> {
  await entry('skill', name);
  const d = await doc(`skills/${name}/SKILL.md`);
  const description = d.frontmatter?.['description'];
  return { ...d, name, description: typeof description === 'string' ? description : '' };
}

export async function skills(): Promise<SkillDoc[]> {
  const names = (await indexEntries()).filter((e) => e.kind === 'skill').map((e) => e.key);
  return Promise.all(names.map((n) => skill(n)));
}

export interface PresetDoc {
  key: string;
  title: string;
  contract: string;
  modules: { key: string; answers: Record<string, unknown> }[];
  /** AGENTS.md, собранный как при установке: шаблон ядра + блоки модулей. */
  agentsMd(): Promise<{ text: string; lines: number; bytes: number }>;
}

interface PresetData {
  key: string;
  title: string;
  contract: string;
  modules: { key: string; answers?: Record<string, unknown> }[];
}

/** Форма пресета; индекс уже проверил key, title, contract и ключи модулей. */
function presetData(data: unknown, file: string): PresetData {
  const fail = (message: string): never => {
    throw new Error(`${file}: ${message}`);
  };
  if (!isRecord(data)) return fail('корень должен быть объектом');
  const { key, title, contract } = data;
  if (typeof key !== 'string' || typeof title !== 'string' || typeof contract !== 'string')
    return fail('key, title и contract должны быть строками');
  if (!Array.isArray(data['modules'])) return fail('modules должно быть списком');
  const modules = data['modules'].map((m: unknown) => {
    if (!isRecord(m) || typeof m['key'] !== 'string') return fail('у модуля нет key');
    const answers = m['answers'];
    if (answers === undefined) return { key: m['key'] };
    if (!isRecord(answers)) return fail(`answers модуля «${m['key']}» должно быть объектом`);
    return { key: m['key'], answers };
  });
  return { key, title, contract, modules };
}

export async function presets(): Promise<PresetDoc[]> {
  const list = (await indexEntries()).filter((e) => e.kind === 'preset');
  return Promise.all(
    list.map(async (e) => {
      const data = presetData(parse(await readRepo(e.path)), e.path);
      return {
        key: data.key,
        title: data.title,
        contract: data.contract,
        modules: data.modules.map((m) => ({ key: m.key, answers: m.answers ?? {} })),
        agentsMd: async () => {
          const template = (await contract(data.contract)).agentsMdTemplate ?? '';
          const blocks = await Promise.all(
            data.modules.map(async (m) => (await module(m.key)).agentsMdBlock ?? ''),
          );
          const text = `${[template.trimEnd(), ...blocks].join('\n\n')}\n`;
          return {
            text,
            lines: text.replace(/\n$/, '').split('\n').length,
            bytes: Buffer.byteLength(text, 'utf8'),
          };
        },
      };
    }),
  );
}
