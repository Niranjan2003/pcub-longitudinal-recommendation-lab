import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Browser tests of the live guarded workflow against the FAKE-PROVIDER HARNESS
 * (scripts/fake_live_backend.py), reached through the Vite proxy at
 * PCUB_BACKEND_URL. The spec aborts unless /v1/capabilities reports the harness
 * marker, so it can never drive a real provider.
 */
export default defineConfig({ ...base, testDir: './e2e/live-fake', testIgnore: [] });
