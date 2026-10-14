import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['expectations/**/*.expect.ts'],
    testTimeout: 30_000,
  },
});
