import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { errorCode, isRecord } from '#shared/guards';
import { compileSchema } from '#shared/schema';
import {
  acquireLease,
  contentHash,
  digestOf,
  localSnapshot,
  publishJson,
  publishProjectJson,
  readJson,
  safePath,
  topologyOf,
} from './local-store.ts';

const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
export const KNOWLEDGE_DELTA_SCHEMA = {
  type: 'array',
  maxItems: 32,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['subject', 'property', 'value', 'kind', 'evidence'],
    properties: {
      subject: text(200),
      property: text(200),
      value: {
        anyOf: [
          { type: 'null' },
          { type: 'boolean' },
          { type: 'number' },
          { type: 'string', maxLength: 8192 },
          { type: 'array', maxItems: 128 },
          { type: 'object', maxProperties: 128 },
        ],
      },
      kind: { enum: ['observation', 'decision', 'candidate'] },
      evidence: { type: 'array', minItems: 1, maxItems: 8, items: text(1000) },
    },
  },
};
export interface KnowledgeItem {
  subject: string;
  property: string;
  value: unknown;
  kind: 'observation' | 'decision' | 'candidate';
  evidence: string[];
}
const itemOf = (value: unknown): value is KnowledgeItem =>
  isRecord(value) &&
  typeof value['subject'] === 'string' &&
  typeof value['property'] === 'string' &&
  (value['kind'] === 'observation' ||
    value['kind'] === 'decision' ||
    value['kind'] === 'candidate') &&
  Array.isArray(value['evidence']) &&
  value['evidence'].every((v: unknown) => typeof v === 'string');
const validate = compileSchema(KNOWLEDGE_DELTA_SCHEMA);
const secret =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})|(?:password|api[_-]?key|access[_-]?token)["']?\s*[=:]\s*["']?[^\s" ,}]{8,})/i;
export function assertNoKnownSecret(value: unknown): void {
  if (secret.test(JSON.stringify(value) ?? '')) throw new Error('SECRET_INPUT');
}
export function knowledgeDeltaOf(value: unknown): KnowledgeItem[] {
  if (validate(value).length > 0 || !Array.isArray(value) || !value.every(itemOf))
    throw new Error('INVALID_DELTA');
  const boundedJson = (v: unknown, depth = 0): boolean => {
    if (depth > 8) return false;
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (Array.isArray(v))
      return (
        v.length <= 128 && Array.from(v).every((item: unknown) => boundedJson(item, depth + 1))
      );
    if (isRecord(v))
      return (
        (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) &&
        Object.keys(v).length <= 128 &&
        Object.entries(v).every(([key, item]) => key.length <= 200 && boundedJson(item, depth + 1))
      );
    return false;
  };
  if (!value.every((item) => boundedJson(item.value))) throw new Error('INVALID_JSON_VALUE');
  const encoded = JSON.stringify(value);
  if (
    Buffer.byteLength(encoded) > 65536 ||
    value.some((i) => Buffer.byteLength(JSON.stringify(i.value)) > 8192)
  )
    throw new Error('PAYLOAD_LIMIT');
  if (secret.test(encoded)) throw new Error('SECRET_INPUT');
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (isRecord(input))
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, normalize(input[key])]),
      );
    return input;
  };
  return value.map((item) => ({
    subject: item.subject,
    property: item.property,
    value: normalize(item.value),
    kind: item.kind,
    evidence: [...new Set(item.evidence)].sort(),
  }));
}

export interface IntakeContext {
  root: string;
  actor: string;
  channel: string;
  execution: string;
  task?: string;
  ticket?: string;
  start?: Awaited<ReturnType<typeof localSnapshot>>;
}
export interface KnowledgeReceipt {
  view_stale?: true;
  version: 1;
  project_id: string;
  submission_id: string;
  entry_ids: string[];
  digest: string;
  locator: string;
  critical: boolean;
}
interface Entry {
  id: string;
  hash: string;
  item: KnowledgeItem;
  scope: string;
  critical: boolean;
}
interface Submission {
  version: number;
  project_id: string;
  key: string;
  context: Record<string, unknown>;
  entries: Entry[];
  receipt: KnowledgeReceipt;
  digest: string;
}
const STORE = '.oc3/inbox/knowledge';
const ID = /^[a-f0-9]{64}$/;
function fail(): never {
  throw new Error('CORRUPT_RECORD');
}
async function publishRecord(project: string, file: string, value: unknown) {
  await publishJson(file, value, true, await safePath(project, '.oc3/locks/knowledge-tmp'));
}

async function storeOf(root: string, create = false) {
  const topology = await topologyOf(root);
  const dir = await safePath(topology.project, STORE);
  const file = await safePath(topology.project, `${STORE}/project.json`);
  let project = await readJson(file);
  if (project === undefined && create) {
    await mkdir(dir, { recursive: true });
    try {
      await publishRecord(topology.project, file, { version: 1, project_id: randomUUID() });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'IDEMPOTENCY_CONFLICT') throw error;
    }
    project = await readJson(file);
  }
  if (project === undefined) return undefined;
  if (!isRecord(project) || project['version'] !== 1 || typeof project['project_id'] !== 'string')
    fail();
  return { ...topology, dir, id: project['project_id'] };
}

const criticalOf = (item: KnowledgeItem): boolean =>
  /(?:critical|security|privacy|autonomy|permission|policy|safety)/i.test(
    `${item.subject} ${item.property} ${item.evidence.join(' ')}`,
  );

export async function enqueueKnowledge(
  context: IntakeContext,
  delta: unknown,
): Promise<KnowledgeReceipt | undefined> {
  const items = knowledgeDeltaOf(delta);
  if (items.length === 0) return undefined;
  const store = await storeOf(context.root, true);
  if (store === undefined) throw new Error('STORE_UNAVAILABLE');
  const finish = await localSnapshot(context.root);
  const unique = [...new Map(items.map((item) => [digestOf(item), item])).entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  );
  const key = digestOf({
    project: store.id,
    actor: context.actor,
    execution: context.execution,
    delta: unique,
  });
  const file = await safePath(store.project, `${STORE}/submissions/${key}.json`);
  const existing = await readJson(file);
  if (existing !== undefined) return submissionOf(existing, store.id, key).receipt;
  const entries = unique.map(([hash, item]) => ({
    id: digestOf({ key, hash }),
    hash,
    item,
    scope: finish.scope,
    critical: criticalOf(item),
  }));
  const origin = {
    actor: context.actor,
    channel: context.channel,
    execution: context.execution,
    task: context.task === undefined ? null : digestOf(context.task),
    ticket: context.ticket ?? null,
    start: context.start ?? null,
    finish,
    evidence: await Promise.all(
      items
        .flatMap((item) => item.evidence)
        .map(async (locator) => {
          try {
            const hash = await contentHash(context.root, locator.split('#')[0] ?? locator);
            return { locator, hash, status: hash === null ? 'unresolved' : 'local-content' };
          } catch {
            return { locator, hash: null, status: 'unresolved' };
          }
        }),
    ),
  };
  const receipt: KnowledgeReceipt = {
    version: 1,
    project_id: store.id,
    submission_id: key,
    entry_ids: entries.map((e) => e.id),
    digest: digestOf(entries),
    locator: `${STORE}/submissions/${key}.json`,
    critical: entries.some((e) => e.critical),
  };
  const body = { version: 1, project_id: store.id, key, context: origin, entries, receipt };
  try {
    await publishRecord(store.project, file, { ...body, digest: digestOf(body) });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'IDEMPOTENCY_CONFLICT') throw error;
    return submissionOf(await readJson(file), store.id, key).receipt;
  }
  try {
    await refreshPending(context.root);
    return receipt;
  } catch {
    return { ...receipt, view_stale: true };
  }
}

function submissionOf(value: unknown, project: string, key: string): Submission {
  if (
    !isRecord(value) ||
    value['version'] !== 1 ||
    value['project_id'] !== project ||
    value['key'] !== key ||
    !isRecord(value['context']) ||
    !Array.isArray(value['entries']) ||
    !isRecord(value['receipt'])
  )
    fail();
  const { digest, ...body } = value;
  if (digest !== digestOf(body)) fail();
  const entries: Entry[] = value['entries'].map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry['hash'] !== 'string' ||
      typeof entry['scope'] !== 'string' ||
      typeof entry['id'] !== 'string' ||
      typeof entry['critical'] !== 'boolean' ||
      !itemOf(entry['item'])
    )
      return fail();
    knowledgeDeltaOf([entry['item']]);
    if (
      entry['hash'] !== digestOf(entry['item']) ||
      entry['id'] !== digestOf({ key, hash: entry['hash'] })
    )
      return fail();
    return {
      id: entry['id'],
      hash: entry['hash'],
      item: entry['item'],
      scope: entry['scope'],
      critical: entry['critical'],
    };
  });
  const receipt = value['receipt'];
  if (
    receipt['version'] !== 1 ||
    receipt['project_id'] !== project ||
    receipt['submission_id'] !== key ||
    receipt['digest'] !== digestOf(entries) ||
    receipt['locator'] !== `${STORE}/submissions/${key}.json` ||
    digestOf(receipt['entry_ids']) !== digestOf(entries.map((e) => e.id)) ||
    receipt['critical'] !== entries.some((e) => e.critical)
  )
    fail();
  return {
    version: 1,
    project_id: project,
    key,
    context: value['context'],
    entries,
    digest: digestOf(body),
    receipt: {
      version: 1,
      project_id: project,
      submission_id: key,
      entry_ids: entries.map((e) => e.id),
      digest: digestOf(entries),
      locator: `${STORE}/submissions/${key}.json`,
      critical: entries.some((e) => e.critical),
    },
  };
}

async function namesOf(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    if (names.some((n) => n.endsWith('.json') && !ID.test(n.replace(/\.json$/, '')))) fail();
    return names.filter((n) => ID.test(n.replace(/\.json$/, '')) && n.endsWith('.json')).sort();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
}

export async function pendingKnowledge(root: string): Promise<Entry[]> {
  const store = await storeOf(root);
  if (store === undefined) return [];
  const all: Entry[] = [];
  for (const name of await namesOf(path.join(store.dir, 'submissions'))) {
    const file = await safePath(store.project, `${STORE}/submissions/${name}`);
    all.push(...submissionOf(await readJson(file), store.id, name.replace(/\.json$/, '')).entries);
  }
  const resolved = new Set<string>();
  for (const name of await namesOf(path.join(store.dir, 'resolutions'))) {
    const record = await readJson(await safePath(store.project, `${STORE}/resolutions/${name}`));
    if (
      !isRecord(record) ||
      record['project_id'] !== store.id ||
      !Array.isArray(record['dispositions']) ||
      typeof record['batch'] !== 'string' ||
      typeof record['run'] !== 'string'
    )
      fail();
    const { digest, ...body } = record;
    if (digest !== digestOf(body)) fail();
    const batch = await knowledgeBatchOf(root, record['batch']);
    if (!Array.isArray(batch.value['entries'])) fail();
    const members = batch.value['entries'];
    const proof = await readJson(
      await safePath(
        store.project,
        artifactRelative({
          kind: 'knowledge-proof',
          key: record['batch'],
          name: `${digestOf(record['run'])}.json`,
        }),
      ),
    );
    if (
      !isRecord(proof) ||
      proof['digest'] !== record['proof'] ||
      proof['project_id'] !== store.id ||
      proof['batch'] !== record['batch'] ||
      proof['run'] !== record['run']
    )
      fail();
    const { digest: proofDigest, ...proofBody } = proof;
    if (proofDigest !== digestOf(proofBody)) fail();
    for (const disposition of record['dispositions']) {
      if (
        !isRecord(disposition) ||
        typeof disposition['id'] !== 'string' ||
        !['applied', 'rejected', 'superseded'].includes(String(disposition['status'])) ||
        !all.some((e) => e.id === disposition['id'] && e.hash === disposition['hash']) ||
        !members.some(
          (e: unknown) =>
            isRecord(e) && e['id'] === disposition['id'] && e['hash'] === disposition['hash'],
        )
      )
        fail();
      resolved.add(disposition['id']);
    }
  }
  return all.filter((entry) => !resolved.has(entry.id));
}

export const PENDING_KNOWLEDGE_MARKER = 'Pending knowledge — НЕ канон; кольцо 1.';
export async function pendingViewOf(root: string): Promise<string> {
  const entries = await pendingKnowledge(root);
  if (entries.length === 0) return '';
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = `${e.scope.slice(0, 12)} ${e.item.subject} / ${e.item.property}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const ordered = [...groups].sort(
    ([, a], [, b]) => Number(b.some((e) => e.critical)) - Number(a.some((e) => e.critical)),
  );
  const lines = [
    PENDING_KNOWLEDGE_MARKER,
    `items=${entries.length}; critical=${entries.filter((e) => e.critical).length}; snapshot=${digestOf(entries.map((e) => [e.id, e.hash]))}`,
    'memory inbox pending — bounded retrieval; memory inbox batch — explicit consolidation.',
  ];
  let shown = 0;
  for (const [topic, group] of ordered.slice(0, 12)) {
    const conflict = new Set(group.map((e) => digestOf(e.item.value))).size > 1;
    const line = `- ${topic.replace(/[\r\n]/g, ' ')}: ${group.length}; ${[...new Set(group.map((e) => e.item.kind))].join(',')}${conflict ? '; CONFLICT' : ''}${group.some((e) => e.critical) ? '; CRITICAL' : ''}; id=${group[0]?.id}`;
    if (Buffer.byteLength([...lines, line].join('\n')) > 3600) break;
    lines.push(line);
    shown++;
  }
  if (shown < groups.size)
    lines.push(`overflow=${groups.size - shown} topics; query explicit scope/topic`);
  return lines.join('\n');
}

export async function refreshPending(root: string): Promise<void> {
  const lease = await acquireLease(root, 'knowledge-view', 'runtime');
  try {
    const file = await safePath(root, '.oc3/bundles/pending/index.md');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      (await pendingViewOf(root)) ||
        'Pending knowledge — НЕ канон; кольцо 1. items=0; memory inbox pending.\n',
    );
  } finally {
    await lease.release();
  }
}

export interface BatchSelection {
  subject: string;
  scope: string;
  limit: number;
}
export const KNOWLEDGE_SELECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'scope', 'limit'],
  properties: {
    subject: text(200),
    scope: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    limit: { type: 'integer', minimum: 1, maximum: 32 },
  },
};
const validateSelection = compileSchema(KNOWLEDGE_SELECTION_SCHEMA);
export function knowledgeSelectionOf(value: unknown): BatchSelection {
  if (
    validateSelection(value).length > 0 ||
    !isRecord(value) ||
    typeof value['subject'] !== 'string' ||
    typeof value['scope'] !== 'string' ||
    typeof value['limit'] !== 'number'
  )
    throw new Error('INVALID_BATCH_SELECTION');
  return { subject: value['subject'], scope: value['scope'], limit: value['limit'] };
}
export async function queryPendingKnowledge(root: string, value: unknown) {
  const selection = knowledgeSelectionOf(value);
  const matches = (await pendingKnowledge(root))
    .filter((entry) => entry.item.subject === selection.subject && entry.scope === selection.scope)
    .sort((a, b) => a.id.localeCompare(b.id));
  const entries: Entry[] = [];
  const snapshot = digestOf(matches.map((entry) => [entry.id, entry.hash]));
  for (const entry of matches.slice(0, selection.limit)) {
    if (
      Buffer.byteLength(
        JSON.stringify({
          entries: [...entries, entry],
          overflow: matches.length - entries.length - 1,
          snapshot,
        }),
      ) > 65536
    )
      break;
    entries.push(entry);
  }
  return { entries, overflow: matches.length - entries.length, snapshot };
}
export async function prepareKnowledgeBatch(root: string, selection: BatchSelection) {
  const normalized = knowledgeSelectionOf(selection);
  const store = await storeOf(root);
  if (store === undefined) throw new Error('EMPTY_BATCH');
  const entries = (await queryPendingKnowledge(root, normalized)).entries;
  if (entries.length === 0) throw new Error('EMPTY_BATCH');
  if (Buffer.byteLength(JSON.stringify(entries)) > 65536) throw new Error('PAYLOAD_LIMIT');
  const base = await localSnapshot(root);
  while (
    Buffer.byteLength(
      JSON.stringify({ version: 1, project_id: store.id, selection: normalized, entries, base }),
    ) > 65000
  )
    entries.pop();
  if (entries.length === 0) throw new Error('PAYLOAD_LIMIT');
  const body = {
    version: 1,
    project_id: store.id,
    selection: normalized,
    entries,
    base,
  };
  const id = digestOf(body);
  await publishRecord(store.project, await safePath(store.project, `${STORE}/batches/${id}.json`), {
    ...body,
    id,
  });
  return { ...body, id, command: `docs-delta start --batch ${id}` };
}

export async function knowledgeBatchOf(root: string, id: string) {
  if (!ID.test(id)) throw new Error('INVALID_BATCH');
  const store = await storeOf(root);
  if (store === undefined) throw new Error('STALE_BATCH');
  const value = await readJson(await safePath(store.project, `${STORE}/batches/${id}.json`));
  if (
    !isRecord(value) ||
    value['project_id'] !== store.id ||
    value['id'] !== id ||
    !Array.isArray(value['entries'])
  )
    fail();
  const { id: ignored, ...body } = value;
  if (digestOf(body) !== ignored) fail();
  return { store, value };
}

export async function intakeSuccessfulResult(context: IntakeContext, data: unknown) {
  if (
    !isRecord(data) ||
    data['status'] !== 'done' ||
    !Array.isArray(data['failed']) ||
    data['failed'].length > 0 ||
    !Array.isArray(data['questions']) ||
    data['questions'].length > 0 ||
    data['knowledge_delta'] === undefined
  )
    return undefined;
  return enqueueKnowledge(context, data['knowledge_delta']);
}

export async function runKnowledgeBatchStage(
  root: string,
  batch: string,
  run: string,
  stage: 'apply' | 'verify' | 'review' | 'close',
  operation: () => Promise<boolean>,
  binding: { targets?: string[]; delta?: string } = {},
): Promise<boolean> {
  const { store, value } = await knowledgeBatchOf(root, batch);
  const lease = await acquireLease(store.project, 'knowledge-consolidation', run);
  const file = await safePath(store.project, '.oc3/locks/knowledge-batch-run.json');
  try {
    const previous = await readJson(file);
    if (
      previous !== undefined &&
      (!isRecord(previous) || previous['batch'] !== batch || previous['run'] !== run)
    )
      throw new Error('LOCK_BUSY: consolidation run');
    const state = isRecord(previous) ? previous : { batch, run, stage: 'new' };
    const snapshot = await localSnapshot(root);
    const targetHashes =
      stage === 'verify'
        ? await Promise.all(
            (binding.targets ?? []).map(async (target) => ({
              target,
              hash: await contentHash(root, target.split('#')[0] ?? target),
            })),
          )
        : (state['targets'] ?? []);
    if (!Array.isArray(targetHashes)) throw new Error('CORRUPT_BATCH_RUN');
    for (const target of targetHashes)
      if (
        !isRecord(target) ||
        typeof target['target'] !== 'string' ||
        (await contentHash(root, target['target'].split('#')[0] ?? target['target'])) !==
          target['hash']
      )
        throw new Error('STALE_CANONICAL_TARGET');
    if (stage === 'apply') {
      const pendingIds = new Set((await pendingKnowledge(root)).map((entry) => entry.id));
      if (
        !Array.isArray(value['entries']) ||
        value['entries'].some(
          (entry: unknown) =>
            !isRecord(entry) || typeof entry['id'] !== 'string' || !pendingIds.has(entry['id']),
        )
      )
        throw new Error('STALE_BATCH');
      if (state['stage'] === 'new' && digestOf(value['base']) !== digestOf(snapshot))
        throw new Error('STALE_BATCH');
    } else {
      const expected = stage === 'verify' ? 'apply' : stage === 'review' ? 'verify' : 'review';
      if (state['stage'] !== expected && !(stage === 'close' && state['stage'] === 'close'))
        throw new Error('BATCH_PHASE_ORDER');
      if (state['snapshot'] !== snapshot.scope) throw new Error('STALE_BATCH');
    }
    if (stage === 'close' && state['stage'] === 'close') return true;
    const deltaHash =
      binding.delta === undefined
        ? (state['delta_hash'] ?? null)
        : await contentHash(root, binding.delta);
    await publishProjectJson(
      store.project,
      '.oc3/locks/knowledge-batch-run.json',
      { ...state, running: stage },
      false,
    );
    const ok = await operation();
    const after = await localSnapshot(root);
    for (const target of targetHashes)
      if (
        !isRecord(target) ||
        typeof target['target'] !== 'string' ||
        (await contentHash(root, target['target'].split('#')[0] ?? target['target'])) !==
          target['hash']
      )
        throw new Error('STALE_CANONICAL_TARGET');
    if (!ok || (stage !== 'apply' && snapshot.scope !== after.scope)) {
      await publishProjectJson(
        store.project,
        '.oc3/locks/knowledge-batch-run.json',
        { batch, run, stage: 'failed', snapshot: after.scope },
        false,
      );
      return false;
    }
    await publishProjectJson(
      store.project,
      '.oc3/locks/knowledge-batch-run.json',
      {
        batch,
        run,
        stage,
        snapshot: after.scope,
        project_id: store.id,
        base: value['base'],
        targets: targetHashes,
        delta_hash: deltaHash,
      },
      false,
    );
    if (stage === 'close') {
      const proof = {
        version: 1,
        batch,
        run,
        project_id: store.id,
        snapshot: after,
        stages: ['apply', 'verify', 'review', 'close'],
        targets: targetHashes,
        delta_hash: deltaHash,
      };
      await publishProjectJson(
        store.project,
        artifactRelative({ kind: 'knowledge-proof', key: batch, name: `${digestOf(run)}.json` }),
        { ...proof, digest: digestOf(proof) },
      );
    }
    return true;
  } finally {
    await lease.release();
  }
}

export async function resolveKnowledgeBatch(
  root: string,
  batch: string,
  run: string,
  proposed: unknown,
) {
  const { store, value } = await knowledgeBatchOf(root, batch);
  const lease = await acquireLease(store.project, 'knowledge-consolidation', run);
  try {
    assertNoKnownSecret(proposed);
    const committed = await readJson(
      await safePath(store.project, `${STORE}/resolutions/${batch}.json`),
    );
    if (committed !== undefined) {
      if (!isRecord(committed)) fail();
      const { digest, ...body } = committed;
      if (
        digest !== digestOf(body) ||
        committed['project_id'] !== store.id ||
        committed['batch'] !== batch
      )
        fail();
      if (committed['run'] !== run || digestOf(committed['dispositions']) !== digestOf(proposed))
        throw new Error('IDEMPOTENCY_CONFLICT');
      await pendingKnowledge(root);
      return { batch, resolved: Array.isArray(proposed) ? proposed.length : 0 };
    }
    const proof = await readJson(
      await safePath(
        store.project,
        artifactRelative({ kind: 'knowledge-proof', key: batch, name: `${digestOf(run)}.json` }),
      ),
    );
    if (
      !isRecord(proof) ||
      proof['batch'] !== batch ||
      proof['run'] !== run ||
      proof['project_id'] !== store.id
    )
      throw new Error('MISSING_CLOSE_PROOF');
    const { digest, ...body } = proof;
    if (
      digest !== digestOf(body) ||
      digestOf(proof['snapshot']) !== digestOf(await localSnapshot(root))
    )
      throw new Error('STALE_BATCH');
    if (
      !Array.isArray(proposed) ||
      proposed.length > 32 ||
      Buffer.byteLength(JSON.stringify(proposed)) > 65536
    )
      throw new Error('INVALID_DISPOSITIONS');
    const entries = value['entries'];
    if (!Array.isArray(entries)) fail();
    const seen = new Set<string>();
    const pendingIds = new Set((await pendingKnowledge(root)).map((entry) => entry.id));
    for (const disposition of proposed) {
      if (
        !isRecord(disposition) ||
        typeof disposition['id'] !== 'string' ||
        typeof disposition['hash'] !== 'string' ||
        typeof disposition['reason'] !== 'string' ||
        disposition['reason'].trim() === '' ||
        !['applied', 'rejected', 'superseded'].includes(String(disposition['status'])) ||
        !Array.isArray(disposition['evidence']) ||
        disposition['evidence'].length === 0 ||
        !disposition['evidence'].every((e: unknown) => typeof e === 'string' && e !== '') ||
        Object.keys(disposition).some(
          (key) =>
            ![
              'id',
              'hash',
              'status',
              'reason',
              'evidence',
              'target',
              'content_hash',
              'replacement',
            ].includes(key),
        )
      )
        throw new Error('INVALID_DISPOSITION');
      if (
        seen.has(disposition['id']) ||
        !pendingIds.has(disposition['id']) ||
        !entries.some(
          (entry: unknown) =>
            isRecord(entry) &&
            entry['id'] === disposition['id'] &&
            entry['hash'] === disposition['hash'],
        )
      )
        throw new Error('FOREIGN_OR_DUPLICATE_ID');
      seen.add(disposition['id']);
      if (disposition['status'] === 'applied') {
        if (
          typeof disposition['target'] !== 'string' ||
          typeof disposition['content_hash'] !== 'string'
        )
          throw new Error('APPLIED_LOCATOR_REQUIRED');
        const target = disposition['target'].split('#')[0] ?? '';
        if (
          Object.values(ARTIFACT_ROOTS).some((root) => target.startsWith(`${root}/`)) ||
          target.startsWith('.ops/') ||
          target.startsWith('.oc3/locks/') ||
          target.startsWith('.oc3/inbox/') ||
          target.startsWith('.oc3/bundles/')
        )
          throw new Error('NON_CANONICAL_TARGET');
        if ((await contentHash(root, target)) !== disposition['content_hash'])
          throw new Error('STALE_CANONICAL_TARGET');
        const anchor = disposition['target'].split('#')[1];
        if (
          anchor !== undefined &&
          (anchor === '' ||
            !(await readFile(await safePath(root, target), 'utf8')).includes(anchor))
        )
          throw new Error('MISSING_CANONICAL_LOCATOR');
        if (
          !Array.isArray(proof['targets']) ||
          !proof['targets'].some(
            (entry: unknown) =>
              isRecord(entry) &&
              entry['target'] === disposition['target'] &&
              entry['hash'] === disposition['content_hash'],
          )
        )
          throw new Error('UNVERIFIED_CANONICAL_TARGET');
      }
      if (
        disposition['status'] === 'superseded' &&
        !(await pendingKnowledge(root)).some(
          (entry) => entry.id === disposition['replacement'] && entry.id !== disposition['id'],
        )
      )
        throw new Error('INVALID_REPLACEMENT');
    }
    const remainingCritical = entries.some(
      (entry: unknown) =>
        isRecord(entry) &&
        entry['critical'] === true &&
        typeof entry['id'] === 'string' &&
        !seen.has(entry['id']),
    );
    if (remainingCritical) throw new Error('CRITICAL_UNRESOLVED');
    const resolution = {
      version: 1,
      project_id: store.id,
      batch,
      run,
      proof: digest,
      dispositions: proposed,
    };
    await publishRecord(
      store.project,
      await safePath(store.project, `${STORE}/resolutions/${batch}.json`),
      { ...resolution, digest: digestOf(resolution) },
    );
    await rm(await safePath(store.project, '.oc3/locks/knowledge-batch-run.json'), { force: true });
    await refreshPending(root).catch(() => undefined);
    return { batch, resolved: seen.size };
  } finally {
    await lease.release();
  }
}
import { artifactRelative, ARTIFACT_ROOTS } from './artifacts.ts';
