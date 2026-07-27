import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The Express port from ADR 0004; dev proxies to it so dev is same-origin. */
const SERVER_ORIGIN = 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Consume the shared contract types from source, so `apps/web` never
      // depends on `packages/shared` having been built first.
      '@pulseboard/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin in dev exactly as in production (ADR 0003): no CORS config
    // exists to get wrong, and the session cookie behaves identically.
    proxy: {
      '/api': { target: SERVER_ORIGIN, changeOrigin: false },
      '/healthz': { target: SERVER_ORIGIN, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
