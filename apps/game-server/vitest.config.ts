import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 15_000,
    // One Colyseus server per file on a fixed port.
    fileParallelism: false,
  },
});
