import { defineConfig } from 'vitest/config';

// Ожидания к промптам: заголовки it — для человека, тела — проверки.
// Запуск: npx harness expect report (или judge / lint).
export default defineConfig({
  test: {
    include: ['expectations/**/*.expect.ts'],
    testTimeout: 30_000,
  },
});
