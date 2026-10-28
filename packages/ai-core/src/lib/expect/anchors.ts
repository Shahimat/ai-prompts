import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeEol } from '#shared/frontmatter';
import { repoRoot } from './repo.ts';

export interface AnchorRegion {
  key: string;
  path: string;
  text: string;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'expectations', '.claude', '.codex']);
const MD = /\.md$/;
const CONF = /\.(ya?ml|toml)$/;
const CODE = /\.ts$/;

async function walk(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name))
        out.push(...(await walk(path.join(dir, entry.name), `${rel}${entry.name}/`)));
    } else if (MD.test(entry.name) || CONF.test(entry.name) || CODE.test(entry.name)) {
      out.push(`${rel}${entry.name}`);
    }
  }
  return out;
}

export function markdownRegions(text: string, file: string): AnchorRegion[] {
  const regions: AnchorRegion[] = [];
  const open = new Map<string, number>();
  const lines = normalizeEol(text).split('\n');
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) return;
    const start = /^\s*<!-- expect:([\w:.-]+) -->\s*$/.exec(line);
    const end = /^\s*<!-- \/expect:([\w:.-]+) -->\s*$/.exec(line);
    if (start?.[1] !== undefined) open.set(start[1], i);
    if (end?.[1] !== undefined && open.has(end[1])) {
      const from = open.get(end[1]) ?? i;
      regions.push({
        key: end[1],
        path: file,
        text: lines
          .slice(from + 1, i)
          .join('\n')
          .trim(),
      });
      open.delete(end[1]);
    }
  });
  for (const key of open.keys()) throw new Error(`${file}: якорь expect:${key} не закрыт`);
  return regions;
}

export function fileAnchorKeys(text: string, comment: '#' | '//' = '#'): string[] {
  const re = comment === '#' ? /^#\s*expect:([\w:.-]+)\s*$/gm : /^\/\/\s*expect:([\w:.-]+)\s*$/gm;
  return [...normalizeEol(text).matchAll(re)].map((m) => m[1] ?? '');
}

let cache: Promise<AnchorRegion[]> | null = null;

export function allAnchors(): Promise<AnchorRegion[]> {
  cache ??= (async () => {
    const root = repoRoot();
    const regions: AnchorRegion[] = [];
    for (const file of (await walk(root)).sort()) {
      const text = normalizeEol(await readFile(path.join(root, file), 'utf8'));
      if (MD.test(file)) regions.push(...markdownRegions(text, file));
      else
        for (const key of fileAnchorKeys(text, CODE.test(file) ? '//' : '#'))
          regions.push({ key, path: file, text: text.trim() });
    }
    return regions;
  })();
  return cache;
}

export async function anchorEvidence(key: string): Promise<string> {
  const regions = (await allAnchors()).filter((r) => r.key === key);
  if (regions.length === 0) throw new Error(`@${key}: в репозитории нет якоря expect:${key}`);
  return regions.map((r) => `--- ${r.path} ---\n${r.text}`).join('\n\n');
}
