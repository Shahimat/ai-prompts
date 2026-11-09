import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: {
    setupFiles: ['./test/setup.ts'],
    server: { deps: { inline: [/@shahimat\//] } },
  },
});
