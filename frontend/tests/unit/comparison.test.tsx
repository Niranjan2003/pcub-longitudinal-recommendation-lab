import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../msw/server';
import { createTestRouter } from '@/app/router';
import { createQueryClient } from '@/state/queryClient';
import capabilities from '../fixtures/captured/capabilities.json';
import recipe from '../fixtures/captured/recipe_249560.json';
import session1 from '../fixtures/captured/session_rev1_pending.json';
import job from '../fixtures/captured/comparison_human_pcub8.json';

const B = 'http://backend.test';
const JOB_ID = (job as { id: string }).id;

function backend(j: unknown = job, opts: { session?: unknown; caps?: unknown } = {}) {
  server.use(
    http.get(`${B}/v1/capabilities`, () => HttpResponse.json((opts.caps ?? capabilities) as JsonBodyType)),
    http.get(`${B}/v1/branch-comparisons/:id`, () => HttpResponse.json(j as JsonBodyType)),
    http.get(`${B}/v1/sessions/:id`, () => HttpResponse.json((opts.session ?? session1) as JsonBodyType)),
    http.get(`${B}/v1/recipes/:id`, () => HttpResponse.json(recipe)),
  );
}

function mount(path = `/comparisons/${JOB_ID}`) {
  const qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={createTestRouter([path])} />
    </QueryClientProvider>,
  );
}

describe('Comparison result page (real captured human job)', () => {
  it('is visibly hypothetical, and states that the session is not changed', async () => {
    backend();
    mount();
    expect(await screen.findByRole('heading', { name: 'Branch comparison' })).toBeInTheDocument();
    expect(screen.getAllByText(/Hypothetical · counterfactual/).length).toBeGreaterThan(0);
    expect(screen.getByText(/nothing here happened/i)).toBeInTheDocument();
    expect(screen.getByText(/not changed by a comparison/i)).toBeInTheDocument();
  });

  it('draws EXACTLY the backend’s expanded nodes and shows every other slot as "not expanded — no estimate"', async () => {
    backend();
    mount();
    await screen.findByRole('group', { name: /two-depth reaction tree/i });
    const tree = screen.getByRole('group', { name: /two-depth reaction tree/i });
    const nodes = job.result.nodes;
    const d1 = nodes.filter((n) => n.depth === 1).length;
    const d2 = nodes.filter((n) => n.depth === 2).length;
    // Expanded nodes are the buttons; their count is exactly what the backend returned.
    expect(within(tree).getAllByRole('button')).toHaveLength(nodes.length);
    // Unexpanded slots: 4 first-reaction slots minus expanded + (4 second slots per expanded first) minus expanded second.
    const expectedSlots = 4 - d1 + d1 * 4 - d2;
    expect(tree.querySelectorAll('[aria-label$="not expanded within budget"]')).toHaveLength(expectedSlots);
    expect(within(tree).getAllByText(/not expanded — no estimate/).length).toBe(expectedSlots);
  });

  it('shows the backend expansion order as badges and in the stepper', async () => {
    backend();
    mount();
    const stepper = await screen.findByRole('region', { name: 'Expansion order' });
    expect(within(stepper).getByText('step 8 / 8')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(stepper).getByRole('button', { name: 'Reset' }));
    expect(within(stepper).getByText('step 0 / 8')).toBeInTheDocument();
    await user.click(within(stepper).getByRole('button', { name: /Next expansion/ }));
    expect(within(stepper).getByText('step 1 / 8')).toBeInTheDocument();
    expect(within(stepper).getByText(/Expansion 1:/)).toBeInTheDocument();
    // The first expanded node is the one the backend listed first (MODIFY_CLARIFY at depth 1 for this fixture).
    expect(job.result.expansion_order[0]).toMatch(/:d1:MODIFY_CLARIFY$/);
  });

  it('selecting a node shows both policies’ backend probabilities and utilities verbatim', async () => {
    backend();
    mount();
    const user = userEvent.setup();
    const first = job.result.nodes.find((n) => n.node_id === job.result.expansion_order[0])!;
    const tree = await screen.findByRole('group', { name: /two-depth reaction tree/i });
    const btn = within(tree).getAllByRole('button').find((b) => b.getAttribute('aria-label')?.includes('expansion 1,'))!;
    await user.click(btn);
    const detail = await screen.findByRole('region', { name: 'Selected hypothetical node' });
    expect(within(detail).getByText('Deterministic')).toBeInTheDocument();
    expect(within(detail).getByText('Feedback-sequence')).toBeInTheDocument();
    const util = first.policy_evidence[0]!.utility.synthetic_branch_utility;
    expect(within(detail).getAllByText(util.toFixed(4)).length).toBeGreaterThan(0);
    expect(within(detail).getByText(/not a measure of human welfare/i)).toBeInTheDocument();
  });

  it('null oracle and metrics render as ABSENT, never as zero; no regret is shown', async () => {
    backend();
    mount();
    const oracle = await screen.findByRole('region', { name: 'Synthetic oracle' });
    expect(within(oracle).getByText(/No oracle result/)).toBeInTheDocument();
    expect(within(oracle).getByText(/absence, not a zero/i)).toBeInTheDocument();
    expect(within(oracle).getByText(/No regret or value-error metrics/)).toBeInTheDocument();
    // No empty metrics area is drawn when there is no oracle.
    expect(screen.queryByRole('region', { name: 'Evaluation metrics' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^regret$/)).not.toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Comparison summary' });
    expect(within(summary).getAllByText(/Not available|Not requested/).length).toBe(2);
  });

  it('cost ledger keeps logical counters apart from provider work and says reuse is not a fresh charge', async () => {
    backend();
    mount();
    const ledger = await screen.findByRole('region', { name: 'Cost ledger' });
    expect(within(ledger).getByText(/Logical engine counters/)).toBeInTheDocument();
    expect(within(ledger).getByText(/not provider calls/i)).toBeInTheDocument();
    expect(within(ledger).getByText(/Preparation \(provider work\)/)).toBeInTheDocument();
    expect(within(ledger).getByText(/full 20-node forest/)).toBeInTheDocument();
    expect(within(ledger).getAllByText(/not a fresh provider charge/i).length).toBeGreaterThan(0);
  });

  it('null provider counts display as "unknown", not 0', async () => {
    const unknown = structuredClone(job) as unknown as { costs: { preparation: { live_calls: number | null; new_tokens: number | null } } };
    unknown.costs.preparation.live_calls = null;
    unknown.costs.preparation.new_tokens = null;
    backend(unknown);
    mount();
    const ledger = await screen.findByRole('region', { name: 'Cost ledger' });
    expect(within(ledger).getAllByText('unknown').length).toBeGreaterThanOrEqual(2);
  });

  it('says branch probabilities use the frozen population model when the session is contextual', async () => {
    backend();
    mount();
    expect(await screen.findByText(/Branch probabilities use the frozen population model/)).toBeInTheDocument();
    expect(screen.getByText(/carried down the hypothetical branches/i)).toBeInTheDocument();
  });

  it('never shows P/U/D/C allocator values (they are not in the API)', async () => {
    backend();
    mount();
    await screen.findByRole('region', { name: 'Cost ledger' });
    expect(screen.queryByText(/disagreement score|frontier score|PCUB score/i)).not.toBeInTheDocument();
  });

  it('warns when the job’s asset fingerprint differs from the connected backend', async () => {
    const other = { ...(job as object), asset_manifest_fingerprint: 'f'.repeat(64) };
    backend(other);
    mount();
    expect(await screen.findByText('Asset fingerprint differs from this backend')).toBeInTheDocument();
  });

  it('a not-found comparison shows an honest state', async () => {
    server.use(
      http.get(`${B}/v1/capabilities`, () => HttpResponse.json(capabilities)),
      http.get(`${B}/v1/branch-comparisons/:id`, () => HttpResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })),
    );
    mount();
    expect(await screen.findByText('Comparison not found in this backend database')).toBeInTheDocument();
  });
});

describe('Oracle and metrics when present (MOCK values — shape verified only in milestone M-B)', () => {
  const withOracle = () => {
    const j = structuredClone(job) as Record<string, unknown>;
    j.oracle = {
      policy_values: { deterministic_recipe_recommendation: 1.25, feedback_sequence_recipe_recommendation: 1.31 },
      best_policy: 'feedback_sequence_recipe_recommendation',
      exact_tie: false,
      meaning: 'MOCK: synthetic exhaustive reference',
    };
    j.metrics = { regret: 0.05, best_policy_correct: false, value_mae: 0.01 };
    return j;
  };

  it('labels the oracle as a synthetic reference and states plainly when the limited selection was wrong', async () => {
    backend(withOracle());
    mount();
    const oracle = await screen.findByRole('region', { name: 'Synthetic oracle' });
    expect(within(oracle).getByText(/Synthetic reference · not human truth/)).toBeInTheDocument();
    expect(within(oracle).getByText('MOCK: synthetic exhaustive reference')).toBeInTheDocument();
    const metrics = screen.getByRole('region', { name: 'Evaluation metrics' });
    expect(within(metrics).getByText(/disagreed with the synthetic reference/i)).toBeInTheDocument();
    expect(within(metrics).getByText('0.05')).toBeInTheDocument();
  });
});
