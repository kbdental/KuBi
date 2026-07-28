import { defineConfig } from 'vitest/config';
import 'dotenv/config';

// Integration tests run against the TEST database, never the dev one, so a
// test run can never disturb data a developer is looking at.
if (process.env.TEST_APP_DATABASE_URL) process.env.APP_DATABASE_URL = process.env.TEST_APP_DATABASE_URL;
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    reporters: ['verbose'],
    fileParallelism: false, // shared database fixtures
    testTimeout: 30000,
  },
});
