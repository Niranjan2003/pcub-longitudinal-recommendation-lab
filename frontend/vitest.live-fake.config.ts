import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Live-mode suite against the FAKE-PROVIDER HARNESS only (scripts/fake_live_backend.py):
// the unmodified backend in live mode, with an in-process provider double, so no request
// leaves the machine. Its preflight aborts unless the backend reports the harness marker
// provider_transport = "fake_in_process_test_double". Never point it at a real live backend.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    globals: true,
    environment: 'node',
    env: { PCUB_FAKE_LIVE: '1' },
    include: ['tests/live-fake/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
