import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/{permissions,workflow,safety-gates,automation,api}/**/*.test.ts', 'packages/**/*.test.ts'],
    environment: 'node',
    reporters: ['verbose'],
  },
});
