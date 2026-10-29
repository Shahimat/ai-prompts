import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: { testTimeout: 30_000, server: { deps: { inline: [/@shahimat\//] } } },
});
