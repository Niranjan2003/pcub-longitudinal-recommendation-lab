import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Same-origin proxy: the browser only ever calls relative /v1/... URLs.
// The target is the local offline PCUB backend. No token or credential is
// injected here, and the Origin header is intentionally left untouched so the
// backend's DEMO_FRONTEND_ORIGIN check stays meaningful.
// Defaults are the documented local setup (app on http://localhost:5173, backend
// on http://127.0.0.1:8765). PCUB_FRONTEND_PORT and PCUB_BACKEND_URL override
// them, e.g. to run a second checkout beside one already using those ports.
const port = Number(process.env.PCUB_FRONTEND_PORT ?? 5173);
if (!Number.isInteger(port) || port <= 0) throw new Error('PCUB_FRONTEND_PORT must be a port number');
const backend = {
  '/v1': { target: process.env.PCUB_BACKEND_URL ?? 'http://127.0.0.1:8765', changeOrigin: false },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { host: 'localhost', port, strictPort: true, proxy: backend },
  preview: { host: 'localhost', port, strictPort: true, proxy: backend },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    css: false,
  },
});
