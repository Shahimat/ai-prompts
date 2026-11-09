import { defineConfig } from 'vitest/config';

export default defineConfig({
  envDir: false,
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: { include: ['test/bounded-guards.test.ts'] },
});
