import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.stubEnv('OC3_PROOF_TRANSPORT', undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});
