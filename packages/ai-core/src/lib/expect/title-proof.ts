import { canonicalDigest } from './inventory.ts';
import { checkerGeneration, type ProducerContext } from './proof.ts';
import { isRecord, isStringArray } from '#shared/guards';

export interface TitleIntent {
  file: string;
  path: string[];
  title: string;
}

export interface TitleNode {
  id: string;
  intent: TitleIntent;
}

export interface TitleCheck {
  id: string;
  kind: 'unary' | 'pair';
  nodes: string[];
  input: string;
}

export interface TitlePlan {
  version: 2;
  scope: string;
  policy: string;
  membership: string;
  complete: boolean;
  diagnostics: string[];
  nodes: TitleNode[];
  checks: TitleCheck[];
}

export interface TitleProof {
  check: TitleCheck;
  policy: string;
  problem: boolean;
  reason: string;
  at: string;
  integrity: string;
  run?: string;
}

export function isTitleCheck(value: unknown): value is TitleCheck {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    (value['kind'] === 'unary' || value['kind'] === 'pair') &&
    isStringArray(value['nodes']) &&
    typeof value['input'] === 'string' &&
    value['nodes'].length === (value['kind'] === 'unary' ? 1 : 2) &&
    new Set(value['nodes']).size === value['nodes'].length
  );
}

export function isTitlePlan(value: unknown): value is TitlePlan {
  return (
    isRecord(value) &&
    value['version'] === 2 &&
    ['scope', 'policy', 'membership'].every((key) => typeof value[key] === 'string') &&
    typeof value['complete'] === 'boolean' &&
    isStringArray(value['diagnostics']) &&
    Array.isArray(value['nodes']) &&
    value['nodes'].every(
      (node) =>
        isRecord(node) &&
        typeof node['id'] === 'string' &&
        isRecord(node['intent']) &&
        typeof node['intent']['file'] === 'string' &&
        isStringArray(node['intent']['path']) &&
        typeof node['intent']['title'] === 'string',
    ) &&
    Array.isArray(value['checks']) &&
    value['checks'].every(isTitleCheck)
  );
}

export function isTitleProof(value: unknown): value is TitleProof {
  if (
    !isRecord(value) ||
    !isTitleCheck(value['check']) ||
    typeof value['policy'] !== 'string' ||
    typeof value['problem'] !== 'boolean' ||
    typeof value['reason'] !== 'string' ||
    typeof value['at'] !== 'string' ||
    (value['run'] !== undefined && typeof value['run'] !== 'string')
  )
    return false;
  const { integrity, ...body } = value;
  return integrity === canonicalDigest(body);
}

export function titlePlan(
  scope: string,
  intents: TitleIntent[],
  producer: ProducerContext,
  scopeKnown = true,
): TitlePlan {
  const checker = checkerGeneration();
  const policy = canonicalDigest({
    schema: 'title-explicit-coverage-v2',
    contract: 'unary measurable; canonical unordered pair contradictory; no higher-order claim',
    checker,
    producer,
  });
  const nodes = intents
    .map((intent) => ({ id: canonicalDigest({ scope, intent }), intent }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const diagnostics = [...producer.diagnostics];
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length)
    diagnostics.push('ambiguous duplicate title scope: group review required');
  if (!scopeKnown || scope === '' || nodes.some((node) => node.intent.file !== scope))
    diagnostics.push('unknown relation scope: group review required');
  if (!checker.valid) diagnostics.push('loaded title checker generation mismatch');
  const checks: TitleCheck[] = [];
  const add = (kind: TitleCheck['kind'], peers: TitleNode[]) => {
    const ids = peers.map((peer) => peer.id).sort();
    checks.push({
      kind,
      nodes: ids,
      id: canonicalDigest({ scope, kind, nodes: ids }),
      input: canonicalDigest({ scope, kind, intents: peers.map((peer) => peer.intent), policy }),
    });
  };
  const unique = [...new Map(nodes.map((node) => [node.id, node])).values()];
  for (const [index, node] of unique.entries()) {
    add('unary', [node]);
    for (const peer of unique.slice(index + 1)) add('pair', [node, peer]);
  }
  return {
    version: 2,
    scope,
    policy,
    membership: canonicalDigest(nodes),
    complete: producer.complete && checker.valid && diagnostics.length === 0,
    diagnostics,
    nodes: unique,
    checks,
  };
}

export function titleDelta(
  plan: TitlePlan,
  proofs: Record<string, TitleProof>,
  force = false,
  run?: string,
) {
  const reused: TitleProof[] = [];
  const checks = plan.checks.filter((check) => {
    const proof = proofs[check.id];
    if (
      plan.complete &&
      proof !== undefined &&
      (!force || (run !== undefined && proof.run === run)) &&
      isTitleProof(proof) &&
      proof.policy === plan.policy &&
      canonicalDigest(proof.check) === canonicalDigest(check)
    ) {
      reused.push(proof);
      return false;
    }
    return true;
  });
  const ids = new Set(checks.flatMap((check) => check.nodes));
  return {
    plan: { ...plan, checks, nodes: plan.nodes.filter((node) => ids.has(node.id)) },
    reused,
  };
}

export function applyTitleAnswer(
  plan: TitlePlan,
  answer: unknown,
  now: Date,
  run?: string,
): TitleProof[] {
  if (!plan.complete) throw new Error('INCOMPLETE_TITLE_SCOPE: needs-review');
  if (!isRecord(answer) || !Array.isArray(answer['evaluated']))
    throw new Error('MISSING_TITLE_COVERAGE');
  const pending = new Map(plan.checks.map((check) => [check.id, check]));
  const proofs: TitleProof[] = [];
  for (const item of answer['evaluated']) {
    if (
      !isRecord(item) ||
      typeof item['id'] !== 'string' ||
      typeof item['problem'] !== 'boolean' ||
      typeof item['reason'] !== 'string'
    )
      throw new Error('INVALID_TITLE_ANSWER');
    const check = pending.get(item['id']);
    if (check === undefined) throw new Error('DUPLICATE_OR_FOREIGN_TITLE_ANSWER');
    if (item['reason'].trim() === '') throw new Error('MISSING_TITLE_REASON');
    pending.delete(check.id);
    const body = {
      check,
      policy: plan.policy,
      problem: item['problem'],
      reason: item['reason'],
      at: now.toISOString(),
      ...(run === undefined ? {} : { run }),
    };
    proofs.push({ ...body, integrity: canonicalDigest(body) });
  }
  if (pending.size !== 0) throw new Error('MISSING_TITLE_COVERAGE');
  return proofs;
}

export function renderTitlePlan(plan: TitlePlan): string {
  return `Проверь только перечисленные checks по неизменяемому контексту nodes. unary: problem=true, если заголовок неизмерим; pair: problem=true, если пара противоречива. Не проверяй тела и не читай репозиторий. Higher-order полнота не заявляется. Для КАЖДОГО check верни explicit положительный или отрицательный результат: {evaluated:[{id,problem:boolean,reason:string}]}. Пустые массивы не являются отрицательным покрытием.\n${JSON.stringify(plan, null, 2)}\n`;
}
