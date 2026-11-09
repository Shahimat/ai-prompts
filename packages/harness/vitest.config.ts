import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    conditions: ['source'],
    alias: {
      '#expect-proof-fixture': path.resolve(
        import.meta.dirname,
        '..',
        'ai-core/src/lib/expect/proof.ts',
      ),
    },
  },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
    server: { deps: { inline: [/@shahimat\//] } },
  },
});
