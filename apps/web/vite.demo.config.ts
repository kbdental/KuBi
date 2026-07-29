import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Builds the try-it file: the real app, one HTML, nothing external.
 * Everything is inlined so it opens from a download with no server.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-demo',
    // Inline every asset regardless of size — the output must be one file.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'demo.html',
      output: { inlineDynamicImports: true },
    },
  },
});
