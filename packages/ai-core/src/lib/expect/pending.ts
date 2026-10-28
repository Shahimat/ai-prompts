import { isRecord } from '#shared/guards';
import { shaOf } from './evidence.ts';

export const COLLECT_ENV = 'HARNESS_EXPECT_COLLECT';

export const SEEN_ENV = 'HARNESS_EXPECT_SEEN';

export interface PendingItem {
  id: string;
  question: string;
  evidence: { ref: string; sha: string; bytes: number }[];
}

export function isPendingItem(v: unknown): v is PendingItem {
  return (
    isRecord(v) &&
    typeof v['id'] === 'string' &&
    typeof v['question'] === 'string' &&
    Array.isArray(v['evidence']) &&
    v['evidence'].every(
      (e) =>
        isRecord(e) &&
        typeof e['ref'] === 'string' &&
        typeof e['sha'] === 'string' &&
        typeof e['bytes'] === 'number',
    )
  );
}

export const idOf = (question: string, refs: string[] = []): string =>
  shaOf([question, ...[...refs].sort()].join('\n')).slice(0, 12);
