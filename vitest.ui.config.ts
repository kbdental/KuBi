import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // .ts as well as .tsx: the library test reads source files rather than
    // rendering them, and has no JSX of its own.
    include: ['tests/ui/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    reporters: ['verbose'],
  },
});
