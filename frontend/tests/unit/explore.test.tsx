import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../msw/server';
import { createTestRouter } from '@/app/router';
import { createQueryClient } from '@/state/queryClient';
import capabilities from '../fixtures/captured/capabilities.json';
import recipe from '../fixtures/captured/recipe_249560.json';
import session0 from '../fixtures/captured/session_rev0.json';
import session1 from '../fixtures/captured/session_rev1_pending.json';
import job from '../fixtures/captured/comparison_human_pcub8.json';

const B = 'http://backend.test';
const SID = (session1 as { id: string }).id;

function backend(opts: { session?: unknown; caps?: unknown } = {}) {
  server.use(
    http.get(`${B}/v1/capabilities`, () => HttpResponse.json((opts.caps ?? capabilities) as JsonBodyType)),
    http.get(`${B}/v1/sessions/:id`, () => HttpResponse.json((opts.session ?? session1) as JsonBodyType)),
    http.get(`${B}/v1/recipes/:id`, () => HttpResponse.json(recipe)),
    http.get(`${B}/v1/branch-comparisons/:id`, () => HttpResponse.json(job)),
  );
}

function mount() {
  const qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={createTestRouter([`/lab/sessions/${SID}/explore`])} />
    </QueryClientProvider>,
  );
}

describe('Branch explorer', () => {
  it('is visibly hypothetical, pins the factual root, and disables the oracle for human sessions with the reason', async () => {
    backend();
    mount();
    expect(await screen.findByRole('heading', { name: 'Branch explorer' })).toBeInTheDocument();
    expect(screen.getByText(/Factual root \(pinned\)/i)).toBeInTheDocument();
    const oracleBox = screen.getByRole('checkbox', { name: /exhaustive synthetic oracle/i });
    expect(oracleBox).toBeDisabled();
    expect(oracleBox).not.toBeChecked();
    expect(screen.getByText(/human oracle does not exist/i)).toBeInTheDocument();
    expect(screen.getByText('Branch probabilities use the frozen population model')).toBeInTheDocument();
  });

  it('offers exactly the backend’s allocators and budgets', async () => {
    backend();
    mount();
    await screen.findByRole('heading', { name: 'Branch explorer' });
    for (const a of ['Equal', 'Greedy', 'Uncertainty-first', 'PCUB']) expect(screen.getByRole('radio', { name: new RegExp(a) })).toBeInTheDocument();
    for (const n of [2, 4, 8, 12]) expect(screen.getByRole('radio', { name: `${n} expansions` })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '5 expansions' })).not.toBeInTheDocument();
  });

  it('requires two DIFFERENT policies', async () => {
    backend();
    mount();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Branch explorer' });
    await user.selectOptions(screen.getByLabelText('Policy B'), 'deterministic_recipe_recommendation');
    expect(screen.getByRole('button', { name: 'Run branch comparison' })).toBeDisabled();
    expect(screen.getByText('Choose two different policies.')).toBeInTheDocument();
  });

  it('submits EXACTLY the documented body with a journaled key, shows the synchronous running state, then opens the result', async () => {
    backend();
    const posts: { key: string | null; body: unknown }[] = [];
    server.use(
      http.post(`${B}/v1/branch-comparisons`, async ({ request }) => {
        posts.push({ key: request.headers.get('idempotency-key'), body: await request.json() });
        await new Promise((r) => setTimeout(r, 150));
        return HttpResponse.json(job);
      }),
    );
    mount();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Branch explorer' });
    await user.click(screen.getByRole('radio', { name: /Greedy/ }));
    await user.click(screen.getByRole('radio', { name: '4 expansions' }));
    await user.click(screen.getByRole('button', { name: 'Run branch comparison' }));
    expect(await screen.findByText(/cannot report progress/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Running comparison…' })).toBeDisabled();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.key).toMatch(/^pcubfe-v1:compare:/);
    expect(posts[0]!.body).toEqual({
      session_id: SID,
      expected_revision: 1,
      policies: ['deterministic_recipe_recommendation', 'feedback_sequence_recipe_recommendation'],
      allocator: 'greedy',
      budget: 4,
      oracle: false,
    });
    expect(await screen.findByRole('heading', { name: 'Branch comparison' })).toBeInTheDocument();
  });

  it('INSUFFICIENT_HORIZON is explained as a real backend answer', async () => {
    backend();
    server.use(http.post(`${B}/v1/branch-comparisons`, () => HttpResponse.json({ error: { code: 'INSUFFICIENT_HORIZON' } }, { status: 422 })));
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Run branch comparison' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('INSUFFICIENT_HORIZON')).toBeInTheDocument();
    expect(within(alert).getByText(/Not enough turns remain/i)).toBeInTheDocument();
  });

  it('RECORDED_CONTEXT_UNAVAILABLE for a guarded pair is shown faithfully', async () => {
    backend();
    server.use(http.post(`${B}/v1/branch-comparisons`, () => HttpResponse.json({ error: { code: 'RECORDED_CONTEXT_UNAVAILABLE' } }, { status: 409 })));
    mount();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Branch explorer' });
    await user.selectOptions(screen.getByLabelText('Policy B'), 'guarded_llm_score_vector');
    expect(screen.getByText(/most likely report/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run branch comparison' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/No other policy was substituted/)).toBeInTheDocument();
  });

  it('live-capable backend: guarded policy options are disabled and nothing is sent', async () => {
    let posts = 0;
    backend({ caps: { ...capabilities, mode: 'live_opt_in', live_guarded: true } });
    server.use(
      http.post(`${B}/v1/branch-comparisons`, () => {
        posts++;
        return HttpResponse.json(job);
      }),
    );
    mount();
    await screen.findByRole('heading', { name: 'Branch explorer' });
    const optionA = within(screen.getByLabelText('Policy A')).getByRole('option', { name: /Guarded LLM scorer/ });
    expect(optionA).toBeDisabled();
    expect(posts).toBe(0);
  });

  it('without a pending recommendation, a comparison cannot start and the reason is shown', async () => {
    backend({ session: session0 });
    mount();
    expect(await screen.findByText('A comparison needs a pending recommendation as its root')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run branch comparison' })).not.toBeInTheDocument();
  });
});
