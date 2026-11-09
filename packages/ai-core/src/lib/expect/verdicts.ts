// expect:verdict-prune
import { readFile } from 'node:fs/promises';
import { expectCacheFile, validateArtifactOutput } from '#lib/artifacts';
import { errorCode, isRecord } from '#shared/guards';
import { repoRoot } from './repo.ts';
import { isImplementationBinding, type ImplementationBinding } from './proof.ts';
import { publishProjectJson } from '#lib/local-store';
import { canonicalDigest } from './inventory.ts';
import { isTitleProof, type TitleProof } from './title-proof.ts';

export const ENTRY_ENV = 'HARNESS_EXPECT_ENTRY';

const DEFAULT_ENTRY = 'expectations/index.expect.ts';

export const entryOf = (): string => process.env[ENTRY_ENV] ?? DEFAULT_ENTRY;

export const verdictsPath = (entry: string = entryOf()): string => expectCacheFile(entry);

export interface Verdict {
  question: string;
  evidence: Record<string, string>;
  verdict: boolean;
  quote: string;
  ref: string;
  reason: string;
  at: string;
  binding?: ImplementationBinding;
  history?: Verdict[];
  integrity?: string;
  run?: string;
}

export interface LintVerdict {
  titles: string;
  contradictions: { a: string; b: string; reason: string }[];
  unmeasurable: { id: string; reason: string }[];
  at: string;
  binding?: ImplementationBinding;
  history?: LintVerdict[];
  integrity?: string;
}

export interface VerdictStore {
  verdicts: Record<string, Verdict>;
  lint: Record<string, LintVerdict>;
  titles?: Record<string, TitleProof>;
}

const isStringRecord = (v: unknown): v is Record<string, string> =>
  isRecord(v) && Object.values(v).every((x) => typeof x === 'string');

function isVerdict(v: unknown): v is Verdict {
  return (
    isRecord(v) &&
    typeof v['question'] === 'string' &&
    isStringRecord(v['evidence']) &&
    typeof v['verdict'] === 'boolean' &&
    typeof v['quote'] === 'string' &&
    typeof v['ref'] === 'string' &&
    typeof v['reason'] === 'string' &&
    typeof v['at'] === 'string' &&
    (v['binding'] === undefined || isImplementationBinding(v['binding'])) &&
    (v['integrity'] === undefined || v['integrity'] === recordIntegrity(v)) &&
    (v['history'] === undefined || (Array.isArray(v['history']) && v['history'].every(isVerdict)))
  );
}

export function isContradictions(v: unknown): v is LintVerdict['contradictions'] {
  return (
    Array.isArray(v) &&
    v.every(
      (c) =>
        isRecord(c) &&
        typeof c['a'] === 'string' &&
        typeof c['b'] === 'string' &&
        typeof c['reason'] === 'string',
    )
  );
}

export function isUnmeasurable(v: unknown): v is LintVerdict['unmeasurable'] {
  return (
    Array.isArray(v) &&
    v.every((u) => isRecord(u) && typeof u['id'] === 'string' && typeof u['reason'] === 'string')
  );
}

function isLintVerdict(v: unknown): v is LintVerdict {
  return (
    isRecord(v) &&
    typeof v['titles'] === 'string' &&
    isContradictions(v['contradictions']) &&
    isUnmeasurable(v['unmeasurable']) &&
    typeof v['at'] === 'string' &&
    (v['binding'] === undefined || isImplementationBinding(v['binding'])) &&
    (v['integrity'] === undefined || v['integrity'] === recordIntegrity(v)) &&
    (v['history'] === undefined ||
      (Array.isArray(v['history']) && v['history'].every(isLintVerdict)))
  );
}

function section<T>(value: unknown, name: string, is: (v: unknown) => v is T): Record<string, T> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`${verdictsPath()}: ${name} должно быть объектом`);
  const out: Record<string, T> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!is(item)) throw new Error(`${verdictsPath()}: ${name}.${key} — неверная форма записи`);
    out[key] = item;
  }
  return out;
}

export async function loadVerdicts(root = repoRoot(), entry = entryOf()): Promise<VerdictStore> {
  let data: unknown;
  try {
    data = JSON.parse(
      await readFile(validateArtifactOutput(root, verdictsPath(entry), 'expect-cache'), 'utf8'),
    );
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { verdicts: {}, lint: {} };
    throw error;
  }
  if (!isRecord(data)) throw new Error(`${verdictsPath()}: корень должен быть объектом`);
  return {
    verdicts: section(data['verdicts'], 'verdicts', isVerdict),
    lint: section(data['lint'], 'lint', isLintVerdict),
    titles: section(data['titles'], 'titles', isTitleProof),
  };
}

export function pruneStore(
  store: VerdictStore,
  liveIds: Set<string>,
  liveFiles: Set<string>,
): number {
  let removed = 0;
  for (const id of Object.keys(store.verdicts)) {
    if (!liveIds.has(id)) {
      delete store.verdicts[id];
      removed++;
    }
  }
  for (const file of Object.keys(store.lint)) {
    if (!liveFiles.has(file)) {
      delete store.lint[file];
      removed++;
    }
  }
  return removed;
}

const sortKeys = <T>(obj: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export async function saveVerdicts(
  store: VerdictStore,
  root = repoRoot(),
  entry = entryOf(),
): Promise<void> {
  validateArtifactOutput(root, verdictsPath(entry), 'expect-cache');
  const data = {
    verdicts: sortKeys(store.verdicts),
    lint: sortKeys(store.lint),
    titles: sortKeys(store.titles ?? {}),
  };
  await publishProjectJson(root, verdictsPath(entry), data, false);
}

export const verdictTrust = (verdict: Verdict): 'bound-v2' | 'legacy-unverified' =>
  verdict.binding?.complete === true && verdict.integrity === recordIntegrity(verdict)
    ? 'bound-v2'
    : 'legacy-unverified';

export const lintTrust = (verdict: LintVerdict): 'bound-v2' | 'legacy-unverified' =>
  verdict.binding?.complete === true && verdict.integrity === recordIntegrity(verdict)
    ? 'bound-v2'
    : 'legacy-unverified';

function recordIntegrity(value: unknown): string {
  if (!isRecord(value)) throw new Error('CORRUPT_EXPECT_VERDICT');
  const { integrity, history, ...body } = value;
  void integrity;
  void history;
  return canonicalDigest(body);
}

export const sealVerdict = (verdict: Verdict): Verdict => ({
  ...verdict,
  integrity: recordIntegrity(verdict),
});

export function findImplementationVerdict(
  store: VerdictStore,
  binding: ImplementationBinding,
): Verdict | undefined {
  if (!binding.complete) return undefined;
  const matches = Object.values(store.verdicts).filter(
    (verdict) =>
      verdictTrust(verdict) === 'bound-v2' &&
      verdict.binding !== undefined &&
      verdict.binding.input === binding.input &&
      verdict.binding.policy === binding.policy,
  );
  if (matches.length === 0 || matches.some((verdict) => verdict.verdict !== matches[0]?.verdict))
    return undefined;
  return matches[0];
}
