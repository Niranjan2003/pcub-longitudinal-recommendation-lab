import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { configureApi } from '@/api/client';
import { server } from './msw/server';
import { journal } from '@/api/commands/journal';

// Node's fetch needs absolute URLs; MSW intercepts this origin.
configureApi({ baseUrl: 'http://backend.test' });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  localStorage.clear();
  journal.clear();
});
afterAll(() => server.close());
