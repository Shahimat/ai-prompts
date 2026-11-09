import { setTimeout } from 'node:timers/promises';
import { acquireLease } from '#lib/local-store';
import { isRecord, isStringArray } from '#shared/guards';
import { proofDigest, resolveProofInputs } from '#lib/proof/inputs';
import { readProofRecord, saveProofRecord } from '#lib/proof/store';
import { joinProofRun } from '#lib/proof/transport';
import type { ProofInputs, ProofNode, ProofReceipt, ProofRecord, ProofRun } from '#lib/proof/model';

function compatibleBaseline(value: unknown, node: string, inputs: ProofInputs): boolean {
  return (
    isRecord(value) &&
    value['version'] === 1 &&
    value['node'] === node &&
    value['input'] === inputs.key &&
    value['status'] === 'pass' &&
    value['code'] === 0 &&
    proofDigest(value['manifest']) === proofDigest(inputs.manifest)
  );
}

export async function inspectProof(root: string, node: Omit<ProofNode, 'execute'>) {
  const inputs = await resolveProofInputs(root, node.declaration);
  if (!inputs.cacheable) return { status: 'pending', inputs, diagnostics: inputs.diagnostics };
  try {
    const baseline = await readProofRecord(
      root,
      `proofs/${proofDigest({ node: node.id, input: inputs.key })}.json`,
    );
    return {
      status: compatibleBaseline(baseline, node.id, inputs) ? 'pass' : 'pending',
      inputs,
      diagnostics: [],
    };
  } catch {
    return { status: 'pending', inputs, diagnostics: ['corrupt baseline: no reusable proof'] };
  }
}

function receiptOf(value: unknown, run: ProofRun, node: string): ProofReceipt | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    value['version'] !== 1 ||
    value['run'] !== run.id ||
    value['node'] !== node ||
    typeof value['input'] !== 'string' ||
    typeof value['after'] !== 'string' ||
    ('currentReusable' in value && typeof value['currentReusable'] !== 'boolean') ||
    (value['status'] !== 'pass' &&
      value['status'] !== 'fail' &&
      value['status'] !== 'pending' &&
      value['status'] !== 'error' &&
      value['status'] !== 'stale') ||
    typeof value['code'] !== 'number' ||
    !Number.isInteger(value['code']) ||
    (value['status'] === 'pass' && value['code'] !== 0) ||
    !isStringArray(value['diagnostics']) ||
    (value['origin'] !== 'executed' && value['origin'] !== 'baseline')
  )
    throw new Error('CORRUPT_PROOF_RECEIPT');
  return {
    version: 1,
    run: run.id,
    node,
    input: value['input'],
    after: value['after'],
    currentReusable: value['currentReusable'] === true,
    status: value['status'],
    code: value['code'],
    diagnostics: value['diagnostics'],
    origin: value['origin'],
  };
}

const flights = new Map<string, Promise<ProofReceipt>>();

export async function ensureProof(run: ProofRun, node: ProofNode): Promise<ProofReceipt> {
  await joinProofRun(run.root, JSON.stringify(run));
  if (!run.scope.includes('*') && !run.scope.includes(node.id))
    throw new Error('PROOF_SCOPE_REJECTED');
  const identity = proofDigest({ root: run.root, run: run.id, node: node.id });
  const existing = flights.get(identity);
  if (existing !== undefined) {
    await existing;
    return ensureStored(run, node);
  }
  const flight = execute(run, node, identity);
  flights.set(identity, flight);
  try {
    return await flight;
  } finally {
    flights.delete(identity);
  }
}

async function ensureStored(run: ProofRun, node: ProofNode): Promise<ProofReceipt> {
  const receipt = receiptOf(
    await readProofRecord(run.root, `runs/${run.id}/nodes/${proofDigest(node.id)}.json`),
    run,
    node.id,
  );
  if (receipt === undefined) throw new Error('PROOF_RECEIPT_MISSING');
  const current = await resolveProofInputs(run.root, node.declaration);
  return receipt.currentReusable &&
    current.currentReusable &&
    receipt.input === current.key &&
    receipt.after === current.key
    ? { ...receipt, origin: 'current-run' }
    : {
        ...receipt,
        currentReusable: false,
        status: 'stale',
        code: 1,
        diagnostics: [
          ...new Set([
            ...receipt.diagnostics,
            ...current.diagnostics,
            !receipt.currentReusable || !current.currentReusable
              ? 'current compatibility unproven: new run required'
              : 'input mutation: new run required',
          ]),
        ],
      };
}

async function execute(run: ProofRun, node: ProofNode, identity: string): Promise<ProofReceipt> {
  const locator = `runs/${run.id}/nodes/${proofDigest(node.id)}.json`;
  if ((await readProofRecord(run.root, locator)) !== undefined) return ensureStored(run, node);
  let lease;
  try {
    lease = await acquireLease(run.root, `proof-${identity}`, run.owner, {
      caller: node.id,
      run: run.id,
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('LOCK_BUSY')) throw error;
    for (let attempt = 0; attempt < 600; attempt++) {
      if ((await readProofRecord(run.root, locator)) !== undefined) return ensureStored(run, node);
      await setTimeout(50);
    }
    throw new Error('PROOF_IN_FLIGHT: explicit owner recovery required; no timeout takeover');
  }
  try {
    if ((await readProofRecord(run.root, locator)) !== undefined) return ensureStored(run, node);
    const inputs = await resolveProofInputs(run.root, node.declaration);
    const diagnostics = [...inputs.diagnostics];
    const baselineName = `proofs/${proofDigest({ node: node.id, input: inputs.key })}.json`;
    let baseline: unknown;
    if (inputs.cacheable) {
      try {
        baseline = await readProofRecord(run.root, baselineName);
      } catch {
        diagnostics.push('corrupt baseline: executed without reuse');
      }
    }
    let compatible = false;
    try {
      compatible = compatibleBaseline(baseline, node.id, inputs);
    } catch {
      diagnostics.push('invalid baseline schema: executed without reuse');
    }
    const reused = compatible && !run.force;
    if (baseline !== undefined && !compatible)
      diagnostics.push('invalid baseline schema: executed without reuse');
    let outcome;
    try {
      outcome = !inputs.generationValid
        ? {
            status: 'error',
            code: 1,
            diagnostics: ['checker generation unavailable: fresh process required'],
          }
        : reused
          ? { status: 'pass', code: 0, diagnostics: [] }
          : await node.execute();
    } catch {
      outcome = { status: 'error', code: 1, diagnostics: ['checker execution error'] };
    }
    if (
      !Number.isInteger(outcome.code) ||
      !isStringArray(outcome.diagnostics) ||
      (outcome.status === 'pass' && outcome.code !== 0)
    )
      outcome = { status: 'error', code: 1, diagnostics: ['invalid checker outcome'] };
    const after = await resolveProofInputs(run.root, node.declaration);
    const status =
      !inputs.generationValid ||
      !after.generationValid ||
      after.key !== inputs.key ||
      after.cacheable !== inputs.cacheable
        ? 'stale'
        : outcome.status;
    if (
      status !== 'pass' &&
      status !== 'fail' &&
      status !== 'pending' &&
      status !== 'error' &&
      status !== 'stale'
    )
      throw new Error('INVALID_PROOF_OUTCOME');
    const receipt: ProofReceipt = {
      version: 1,
      run: run.id,
      node: node.id,
      input: inputs.key,
      after: after.key,
      currentReusable: inputs.currentReusable && after.currentReusable,
      status,
      code: status === 'pass' ? 0 : outcome.code || 1,
      diagnostics: [
        ...diagnostics,
        ...outcome.diagnostics,
        ...(status === 'stale' ? ['input mutation: new run required'] : []),
      ],
      origin: reused ? 'baseline' : 'executed',
    };
    await saveProofRecord(run.root, locator, receipt);
    if (!reused && receipt.status === 'pass' && inputs.cacheable && diagnostics.length === 0) {
      const record: ProofRecord = {
        version: 1,
        node: node.id,
        input: inputs.key,
        manifest: inputs.manifest,
        status: 'pass',
        code: 0,
      };
      await saveProofRecord(run.root, baselineName, record);
    }
    return receipt;
  } finally {
    await lease.release();
  }
}
