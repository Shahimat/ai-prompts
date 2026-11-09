import { createHash } from 'node:crypto';
import { anchorEvidence } from './anchors.ts';
import { readRepo, extractSection, repoRoot } from './repo.ts';

export async function readEvidence(ref: string, root = repoRoot()): Promise<string> {
  if (ref.startsWith('@')) return anchorEvidence(ref.slice(1), root);
  const hash = ref.indexOf('#');
  const file = hash === -1 ? ref : ref.slice(0, hash);
  if (
    file
      .split(/[\\/]/)
      .some((part) => /^(?:\.env(?:\.|$)|credentials(?:\.|$)|secrets?(?:\.|$))/i.test(part))
  )
    throw new Error('PRIVATE_EXPECT_EVIDENCE');
  const text = await readRepo(file, root);
  if (hash === -1) return text;
  const section = extractSection(text, ref.slice(hash + 1));
  if (section === null) throw new Error(`${ref}: раздел не найден`);
  return section;
}

export const shaOf = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

export function containsQuote(text: string, quote: string): boolean {
  const norm = (s: string): string =>
    s
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/[`*_>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const q = norm(quote);
  return q.length >= 8 && norm(text).includes(q);
}
