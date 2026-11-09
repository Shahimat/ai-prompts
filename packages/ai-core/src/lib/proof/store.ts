import { artifactRelative } from '#lib/artifacts';
import { publishProjectJson, readJson, safePath } from '#lib/local-store';
import { isRecord } from '#shared/guards';
import { proofDigest } from '#lib/proof/inputs';

export const proofFile = (name: string): string =>
  artifactRelative({ kind: 'run', key: 'verification', name });

export async function readProofRecord(root: string, name: string): Promise<unknown> {
  const record = await readJson(await safePath(root, proofFile(name)));
  if (record === undefined) return undefined;
  if (!isRecord(record) || record['integrity'] !== proofDigest(record['body']))
    throw new Error('CORRUPT_PROOF_RECORD');
  return record['body'];
}

export async function saveProofRecord(root: string, name: string, body: unknown): Promise<void> {
  await publishProjectJson(root, proofFile(name), { body, integrity: proofDigest(body) });
}
