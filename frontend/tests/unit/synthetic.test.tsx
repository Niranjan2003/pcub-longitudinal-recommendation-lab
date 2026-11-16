import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../msw/server';
import { createTestRouter } from '@/app/router';
import { createQueryClient } from '@/state/queryClient';
import { SYNTHETIC_PRESETS } from '@/config/syntheticPresets';
import capabilities from '../fixtures/captured/capabilities.json';
import recipe from '../fixtures/captured/recipe_249560.json';
import synRev0 from '../fixtures/captured/synthetic_session_rev0.json';
import synPending from '../fixtures/captured/synthetic_structured_pending.json';
import synAfter from '../fixtures/captured/synthetic_structured_after_advance.json';
import synOracleStructured from '../fixtures/captured/synthetic_structured_comparison_oracle.json';
import synOracleAgenda from '../fixtures/captured/synthetic_agenda_comparison_oracle.json';

const B = 'http://backend.test';
const j = (v: unknown) => HttpResponse.json(v as JsonBodyType);

function mount(path: string) {
  const qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={createTestRouter([path])} />
    </QueryClientProvider>,
  );
}

function baseHandlers(session: unknown) {
  server.use(
    http.get(`${B}/v1/capabilities`, () => j(capabilities)),
    http.get(`${B}/v1/sessions/:id`, () => j(session)),
    http.get(`${B}/v1/recipes/:id`, () => j(recipe)),
  );
}

describe('Lab — synthetic world', () => {
  it('shows only verified presets, hides persona fields, and posts a fixture-only body for the matching backend', async () => {
    baseHandlers(synRev0);
    const posts: { body: Record<string, unknown>; key: string | null }[] = [];
    server.use(
      http.post(`${B}/v1/sessions`, async ({ request }) => {
        posts.push({ body: (await request.json()) as Record<string, unknown>, key: request.headers.get('idempotency-key') });
        return j(synRev0);
      }),
    );
    mount('/lab');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: /Synthetic simulation/ }));
    expect(screen.queryByLabelText('Display name (pseudonym)')).not.toBeInTheDocument();
    expect(screen.queryByText('Example personas')).not.toBeInTheDocument();
    for (const p of SYNTHETIC_PRESETS) expect(screen.getByRole('radio', { name: new RegExp(p.title) })).toBeInTheDocument();
    // Pick the agenda preset: backend must follow the fixture.
    await user.click(screen.getByRole('radio', { name: /Agenda-derived simulator/ }));
    expect(screen.getByText(/fixed by the scenario/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create scenario' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    const agenda = SYNTHETIC_PRESETS.find((p) => p.backend.startsWith('usersimcrs'))!;
    expect(posts[0]!.body).toEqual({
      world_kind: 'synthetic_simulation',
      policy: 'deterministic_recipe_recommendation',
      prediction_backend: agenda.backend,
      predictor: 'contextual',
      fixture: agenda.fixture,
    });
    // No persona, initial state, request, segments or turns may be sent for a synthetic scenario.
    for (const forbidden of ['persona', 'initial_state', 'request', 'segments', 'turns_per_segment']) expect(posts[0]!.body).not.toHaveProperty(forbidden);
    expect(posts[0]!.key).toMatch(/^pcubfe-v1:create_session:/);
  });
});

describe('Session workspace — synthetic', () => {
  const pendingId = (synPending as { pending: { id: string } }).pending.id;
  const sid = (synPending as { id: string }).id;

  it('replaces the feedback form with “the simulator decides”; the advance request carries no reaction', async () => {
    baseHandlers(synPending);
    const posts: unknown[] = [];
    server.use(
      http.post(`${B}/v1/sessions/:id/feedback`, async ({ request }) => {
        posts.push(await request.json());
        return j(synAfter);
      }),
    );
    mount(`/lab/sessions/${sid}`);
    expect(await screen.findByText('The simulator decides the reaction')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit reaction' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Accept/ })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Synthetic simulation/).length).toBeGreaterThan(0);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reveal the simulated reaction' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ expected_revision: 1, operation: 'feedback', recommendation_id: pendingId });
  });

  it('after the reveal, the evidence is labelled synthetic and exposes simulator internals only as a post-hoc audit', async () => {
    baseHandlers(synAfter);
    mount(`/lab/sessions/${sid}`);
    expect(await screen.findByText('Forecast (made before reveal)')).toBeInTheDocument();
    expect(screen.getAllByText(/Synthetic · factual in simulation/).length).toBeGreaterThan(0);
    const audit = screen.getByText(/Simulator internals \(post-hoc audit, not predictor input\)/);
    expect(audit).toBeInTheDocument();
    expect(screen.getByText(/never available to the predictor, policy or allocator/i)).toBeInTheDocument();
  });
});

describe('Branch explorer — synthetic oracle', () => {
  const sid = (synPending as { id: string }).id;
  it('enables the oracle by default and sends oracle:true', async () => {
    baseHandlers(synPending);
    const posts: Record<string, unknown>[] = [];
    server.use(
      http.post(`${B}/v1/branch-comparisons`, async ({ request }) => {
        posts.push((await request.json()) as Record<string, unknown>);
        return j(synOracleStructured);
      }),
      http.get(`${B}/v1/branch-comparisons/:id`, () => j(synOracleStructured)),
    );
    mount(`/lab/sessions/${sid}/explore`);
    const box = await screen.findByRole('checkbox', { name: /exhaustive synthetic oracle/i });
    expect(box).toBeEnabled();
    expect(box).toBeChecked();
    expect(screen.getByText(/never an input to the allocator/i)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Run branch comparison' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.oracle).toBe(true);
  });

  it('the oracle can be switched off, giving oracle:false', async () => {
    baseHandlers(synPending);
    const posts: Record<string, unknown>[] = [];
    server.use(
      http.post(`${B}/v1/branch-comparisons`, async ({ request }) => {
        posts.push((await request.json()) as Record<string, unknown>);
        return j(synOracleStructured);
      }),
      http.get(`${B}/v1/branch-comparisons/:id`, () => j(synOracleStructured)),
    );
    mount(`/lab/sessions/${sid}/explore`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: /exhaustive synthetic oracle/i }));
    await user.click(screen.getByRole('button', { name: 'Run branch comparison' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.oracle).toBe(false);
  });
});

describe('Comparison result — real synthetic oracle captures', () => {
  function result(job: unknown) {
    server.use(
      http.get(`${B}/v1/capabilities`, () => j(capabilities)),
      http.get(`${B}/v1/branch-comparisons/:id`, () => j(job)),
      http.get(`${B}/v1/sessions/:id`, () => j(synPending)),
      http.get(`${B}/v1/recipes/:id`, () => j(recipe)),
    );
    mount(`/comparisons/${(job as { id: string }).id}`);
  }

  it('structured pair: labels the oracle a synthetic reference, shows its values and meaning verbatim, and states agreement without overclaiming', async () => {
    result(synOracleStructured);
    const oracle = await screen.findByRole('region', { name: 'Synthetic oracle' });
    expect(within(oracle).getByText(/Synthetic reference · not human truth/)).toBeInTheDocument();
    expect(within(oracle).getByText(synOracleStructured.oracle.meaning)).toBeInTheDocument();
    expect(within(oracle).getAllByText(/Deterministic value|Feedback-sequence value/).length).toBe(2);
    const metrics = screen.getByRole('region', { name: 'Evaluation metrics' });
    expect(within(metrics).getByText(/agreed with the synthetic reference for this root/i)).toBeInTheDocument();
    expect(within(metrics).getByText('regret')).toBeInTheDocument();
  });

  it('agenda pair: the ADVERSE case (limited selection disagreed with the oracle, regret > 0) is shown with a plain warning', async () => {
    expect(synOracleAgenda.metrics.best_policy_correct).toBe(false);
    result(synOracleAgenda);
    const metrics = await screen.findByRole('region', { name: 'Evaluation metrics' });
    expect(within(metrics).getByText(/disagreed with the synthetic reference/i)).toBeInTheDocument();
    // Rounded for reading (0.07199999999999984 → 0.072); the exact value is kept in the title and the verbatim block.
    expect(within(metrics).getAllByText('0.072').length).toBeGreaterThan(0);
    expect(within(metrics).getAllByTitle(String(synOracleAgenda.metrics.regret)).length).toBeGreaterThan(0);
    // Both estimate and oracle markers are present on the value plot.
    expect(screen.getByText('Synthetic oracle value')).toBeInTheDocument();
  });
});
