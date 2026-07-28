import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The session cookie is httpOnly and SameSite=strict, so the browser must
    // see the API on the same origin as the app. Proxying keeps that true in
    // development without loosening the cookie.
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
});
