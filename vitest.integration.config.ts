import { defineConfig } from 'vitest/config';
import 'dotenv/config';
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    reporters: ['verbose'],
    fileParallelism: false, // shared database fixtures
    testTimeout: 30000,
  },
});
