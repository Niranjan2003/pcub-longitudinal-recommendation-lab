import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { ConnectionIndicator, GlobalBanners } from '@/app/StatusStrip';
import { createQueryClient } from '@/state/queryClient';
import { deriveBackendStatus, isLiveCapable } from '@/state/backendStatus';
import { ApiError } from '@/api/errors';
import { capabilitiesSchema } from '@/api/schemas';
import capabilities from '../fixtures/captured/capabilities.json';

const B = 'http://backend.test';

function mount() {
  const qc = createQueryClient();
  // Make failures resolve quickly in tests.
  qc.setDefaultOptions({ queries: { retry: false } });
  return render(
    <QueryClientProvider client={qc}>
      <ConnectionIndicator />
      <GlobalBanners />
    </QueryClientProvider>,
  );
}

describe('header connection indicator and banners', () => {
  it('offline backend: only "Backend connected"; no API version, asset fingerprint, capability text or re-check', async () => {
    server.use(http.get(`${B}/v1/capabilities`, () => HttpResponse.json(capabilities)));
    mount();
    expect(await screen.findByText('Backend connected')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Backend status' })).toHaveTextContent(/^Backend connected$/);
    expect(screen.queryByText(/Live backend connected/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Offline mode|recorded decisions only/)).not.toBeInTheDocument();
    expect(screen.queryByText(/API v/)).not.toBeInTheDocument();
    expect(screen.queryByText(/9ec70f/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('live-capable backend: only "Live backend connected", with no secondary live-LLM text and no alarm banner', async () => {
    server.use(http.get(`${B}/v1/capabilities`, () => HttpResponse.json({ ...capabilities, mode: 'live_opt_in', live_guarded: true })));
    mount();
    expect(await screen.findByText('Live backend connected')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Backend status' })).toHaveTextContent(/^Live backend connected$/);
    expect(screen.queryByText(/Live LLM|per-session permission required/)).not.toBeInTheDocument();
    expect(screen.queryByText(/API v/)).not.toBeInTheDocument();
    expect(screen.queryByText(/9ec70f/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an unreachable state with instructions (no invented data)', async () => {
    server.use(http.get(`${B}/v1/capabilities`, () => HttpResponse.error()));
    mount();
    expect(await screen.findAllByText(/Backend not reachable/)).not.toHaveLength(0);
    expect(screen.getByText(/Start the/)).toBeInTheDocument();
  });

  it('explains 401 (token configured) without ever asking for a token', async () => {
    server.use(http.get(`${B}/v1/capabilities`, () => HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })));
    mount();
    expect(await screen.findByText('Backend requires an operator token')).toBeInTheDocument();
    expect(screen.getByText(/never handles tokens/)).toBeInTheDocument();
  });

  it('explains 403 origin denial with the exact setting', async () => {
    server.use(http.get(`${B}/v1/capabilities`, () => HttpResponse.json({ error: { code: 'ORIGIN_DENIED' } }, { status: 403 })));
    mount();
    expect(await screen.findByText('Origin denied')).toBeInTheDocument();
    expect(screen.getAllByText(/DEMO_FRONTEND_ORIGIN/).length).toBeGreaterThan(0);
  });

  it('shows asset integrity failure (503) as a backend problem', async () => {
    server.use(http.get(`${B}/v1/capabilities`, () => HttpResponse.json({ error: { code: 'ASSET_INTEGRITY_FAILURE' } }, { status: 503 })));
    mount();
    expect(await screen.findByText('Asset integrity failure')).toBeInTheDocument();
  });

  it('shows a contract mismatch when capabilities are malformed', async () => {
    server.use(http.get(`${B}/v1/capabilities`, () => HttpResponse.json({ mode: 'offline' })));
    mount();
    expect(await screen.findByText('Contract mismatch')).toBeInTheDocument();
  });
});

describe('live-mode detection', () => {
  const caps = capabilitiesSchema.parse(capabilities);
  it('offline + live_guarded:false is not live-capable', () => {
    expect(isLiveCapable(caps)).toBe(false);
  });
  it('any non-offline mode, or live_guarded:true, is live-capable', () => {
    expect(isLiveCapable({ ...caps, mode: 'live_opt_in' })).toBe(true);
    expect(isLiveCapable({ ...caps, live_guarded: true })).toBe(true);
  });
  it('derives distinct states from errors', () => {
    expect(deriveBackendStatus({ isPending: true, data: undefined, error: null }).kind).toBe('loading');
    expect(deriveBackendStatus({ isPending: false, data: undefined, error: new ApiError({ kind: 'network', message: 'x' }) }).kind).toBe('unreachable');
    expect(deriveBackendStatus({ isPending: false, data: undefined, error: new ApiError({ kind: 'backend', message: 'x', code: 'UNAUTHORIZED', status: 401 }) }).kind).toBe(
      'unauthorized',
    );
  });
});
