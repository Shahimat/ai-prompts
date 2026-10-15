import { defineConfig } from 'vitest/config';

const entry = process.env['HARNESS_EXPECT_ENTRY'];
if (entry === undefined || entry === '') throw new Error('HARNESS_EXPECT_ENTRY не задан');

export default defineConfig({
  test: {
    include: [entry],
    testTimeout: 30_000,
  },
});
