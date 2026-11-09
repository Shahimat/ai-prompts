import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isRecord, isStringArray } from '#shared/guards';
import { proofDigest } from '#lib/proof/inputs';
import { readProofRecord, saveProofRecord } from '#lib/proof/store';
import type { ProofPolicy, ProofRun } from '#lib/proof/model';

export const PROOF_TRANSPORT = 'OC3_PROOF_TRANSPORT';

export async function beginProofRun(root: string, policy: ProofPolicy): Promise<ProofRun> {
  const run = {
    ...policy,
    root: await realpath(root),
    id: randomUUID(),
    token: randomBytes(32).toString('hex'),
  };
  const { token, ...body } = run;
  await saveProofRecord(root, `runs/${run.id}/context.json`, {
    ...body,
    tokenDigest: proofDigest(token),
  });
  return run;
}

export function proofRunEnvironment(run: ProofRun): NodeJS.ProcessEnv {
  return { ...process.env, [PROOF_TRANSPORT]: JSON.stringify(run) };
}

export async function joinProofRun(
  root: string,
  transport: string,
  policy?: ProofPolicy,
): Promise<ProofRun> {
  const value: unknown = JSON.parse(transport);
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(value['id']) ||
    typeof value['token'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value['token']) ||
    value['root'] !== (await realpath(root)) ||
    typeof value['owner'] !== 'string' ||
    !isStringArray(value['scope']) ||
    typeof value['force'] !== 'boolean' ||
    typeof value['allowJudge'] !== 'boolean'
  )
    throw new Error('PROOF_TRANSPORT_REJECTED');
  const run: ProofRun = {
    root: await realpath(root),
    id: value['id'],
    token: value['token'],
    owner: value['owner'],
    scope: value['scope'],
    force: value['force'],
    allowJudge: value['allowJudge'],
  };
  const record = await readProofRecord(root, `runs/${run.id}/context.json`);
  const { token, ...body } = run;
  if (
    !isRecord(record) ||
    typeof record['tokenDigest'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record['tokenDigest']) ||
    !timingSafeEqual(
      Buffer.from(proofDigest(token)),
      Buffer.from(String(record['tokenDigest']).padEnd(64).slice(0, 64)),
    ) ||
    proofDigest(record) !== proofDigest({ ...body, tokenDigest: proofDigest(token) }) ||
    (policy !== undefined &&
      proofDigest(policy) !==
        proofDigest({
          owner: run.owner,
          scope: run.scope,
          force: run.force,
          allowJudge: run.allowJudge,
        }))
  )
    throw new Error('PROOF_TRANSPORT_REJECTED');
  return run;
}

export async function beginOrJoinProofRun(root: string, policy: ProofPolicy): Promise<ProofRun> {
  const inherited = process.env[PROOF_TRANSPORT];
  return inherited === undefined
    ? beginProofRun(root, policy)
    : joinProofRun(root, inherited, policy);
}
