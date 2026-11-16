import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Real-backend integration suite. Runs in Node (no DOM) against the OFFLINE
// backend reached directly at PCUB_BACKEND_URL (default http://127.0.0.1:8765).
// Requires PCUB_REAL_OFFLINE=1; its preflight aborts unless the backend reports
// mode "offline" and no live flag. Tests run sequentially against one dev DB.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    globals: true,
    environment: 'node',
    // Selecting THIS config is the explicit opt-in. The preflight in tests/integration/helpers.ts
    // still aborts unless the backend reports mode "offline" and no live capability.
    env: { PCUB_REAL_OFFLINE: '1' },
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
