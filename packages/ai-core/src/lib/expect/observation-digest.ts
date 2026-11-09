import { createHash } from 'node:crypto';
import { canonicalJson } from '#lib/proof/inputs';

export function observedDigest(value: unknown): string {
  if (typeof value === 'string')
    return createHash('sha256')
      .update(`observation-string-utf16le-v1\0${value.length}\0`)
      .update(Buffer.from(value, 'utf16le'))
      .digest('hex');
  return createHash('sha256')
    .update(canonicalJson(value === undefined ? { defined: false } : { defined: true, value }))
    .digest('hex');
}
