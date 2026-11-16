import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../msw/server';
import { createTestRouter } from '@/app/router';
import { createQueryClient } from '@/state/queryClient';
import { journal } from '@/api/commands/journal';
import { liveConsent } from '@/state/liveConsent';
import capabilities from '../fixtures/captured/capabilities.json';
import recipe from '../fixtures/captured/recipe_249560.json';
import session0 from '../fixtures/captured/session_rev0.json';
import session1 from '../fixtures/captured/session_rev1_pending.json';
import synthetic0 from '../fixtures/captured/synthetic_session_rev0.json';

/*
 * Live guarded workflow (MSW, no backend). The backend's live-mode response shapes
 * used here (provider_costs with journal snapshots, live_guarded provenance) were
 * observed from the unmodified backend running against the fake-provider harness
 * (scripts/fake_live_backend.py) and are exercised end to end in tests/live-fake.
 */

const B = 'http://backend.test';
const GUARDED = 'guarded_llm_score_vector';
const LIVE_CAPS = { ...capabilities, mode: 'live_opt_in', live_guarded: true };
const KEY = 'f77ad401b89d02eb6c52fe461b588f5d07809e46897c98a028b71203863c3429';
const j = (v: unknown) => HttpResponse.json(v as JsonBodyType);

const journalAfter = (reservations: number) => ({
  reservations,
  completed_responses: reservations,
  unknown: 0,
  records: [{ key: KEY, usage: { input_tokens: 2118, output_tokens: 1216, total_tokens: 3334 }, latency_seconds: 19.96 }],
});

function pendingWith(mode: string, costs: Record<string, unknown>) {
  const s = session1 as { pending: Record<string, unknown> & { provenance: Record<string, unknown> } };
  return {
    ...(session1 as object),
    policy: GUARDED,
    pending: {
      ...s.pending,
      provenance: { ...s.pending.provenance, recommendation_execution_mode: mode },
      source_decision_fingerprint: mode === 'deterministic' ? null : KEY,
      provider_costs: costs,
    },
  };
}

const liveNew = pendingWith('live_guarded', {
  reservations: 1,
  live_calls: 1,
  new_tokens: 3334,
  cache_reuse: false,
  journal_before: { reservations: 0, completed_responses: 0, unknown: 0, records: [] },
  journal_after: journalAfter(1),
});

/** The GET handler serves `state.session`, so a POST handler can advance it like the real backend. */
function mount(path: string, opts: { session: unknown; caps?: unknown }) {
  const state = { session: opts.session };
  server.use(
    http.get(`${B}/v1/capabilities`, () => j(opts.caps ?? LIVE_CAPS)),
    http.get(`${B}/v1/sessions/:id`, () => j(state.session)),
    http.get(`${B}/v1/recipes/:id`, () => j(recipe)),
  );
  const qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={createTestRouter([path])} />
    </QueryClientProvider>,
  );
  return state;
}

const humanPath = `/lab/sessions/${(session0 as { id: string }).id}`;

afterEach(() => liveConsent.revokeAll());

describe('live-capable backend: banner and guarded session gate', () => {
  it('the header only says the live backend is connected; the permission panel says the model only scores the safe shortlist and nothing is retried', async () => {
    mount(humanPath, { session: { ...(session0 as object), policy: GUARDED } });
    expect(await screen.findByText('Live backend connected')).toBeInTheDocument();
    expect(screen.queryByText(/Live LLM scoring available|per-session permission required/)).not.toBeInTheDocument();
    expect(screen.queryByText(/LIVE PROVIDER MODE/)).not.toBeInTheDocument();
    expect(await screen.findByText(/It only scores the safe shortlist\./)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is retried automatically/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow live provider requests for this session' })).toBeInTheDocument();
  });

  it('nothing is sent until the user deliberately allows live requests; then exactly one request per click', async () => {
    let posts = 0;
    const state = mount(humanPath, { session: { ...(session0 as object), policy: GUARDED } });
    server.use(
      http.post(`${B}/v1/sessions/:id/recommendations`, () => {
        posts++;
        state.session = liveNew;
        return j(liveNew);
      }),
    );
    const user = userEvent.setup();
    const panel = await screen.findByRole('region', { name: 'Live guarded LLM scoring' });
    expect(within(panel).getByText(/It only scores the safe shortlist\./)).toBeInTheDocument();
    expect(within(panel).getByText(/never receives or stores them/)).toBeInTheDocument();
    const get = screen.getByRole('button', { name: 'Get recommendation for turn 1 (may send 1 live provider request)' });
    expect(get).toBeDisabled();

    const allow = within(panel).getByRole('button', { name: 'Allow live provider requests for this session' });
    expect(allow).toBeDisabled();
    await user.click(within(panel).getByRole('checkbox'));
    await user.click(allow);
    expect(within(panel).getByText(/Live provider requests are allowed for this session/)).toBeInTheDocument();
    expect(posts).toBe(0);

    expect(get).toBeEnabled();
    await user.click(get);
    const work = await screen.findByRole('region', { name: 'Provider work for this recommendation' });
    expect(posts).toBe(1);
    expect(within(work).getByText('New live provider decision')).toBeInTheDocument();
    expect(within(work).getByText('no: new provider response')).toBeInTheDocument();
    expect(within(work).getByText('3334')).toBeInTheDocument();
    expect(within(work).getByText('2118 + 1216 = 3334')).toBeInTheDocument();
    expect(within(work).getByText('19.96 s')).toBeInTheDocument();
    expect(within(work).getByText('live_guarded')).toBeInTheDocument();
    expect(journal.list().filter((e) => e.command === 'recommend')).toHaveLength(1);
  });

  it('withdrawing permission disables the command again', async () => {
    mount(humanPath, { session: { ...(session0 as object), policy: GUARDED } });
    const user = userEvent.setup();
    const panel = await screen.findByRole('region', { name: 'Live guarded LLM scoring' });
    await user.click(within(panel).getByRole('checkbox'));
    await user.click(within(panel).getByRole('button', { name: 'Allow live provider requests for this session' }));
    const get = screen.getByRole('button', { name: /Get recommendation for turn 1/ });
    expect(get).toBeEnabled();
    await user.click(within(panel).getByRole('button', { name: 'Withdraw permission' }));
    expect(get).toBeDisabled();
  });

  it('after a provider unknown completion, live requests stop on this page and the command is never retried', async () => {
    let posts = 0;
    mount(humanPath, { session: { ...(session0 as object), policy: GUARDED } });
    server.use(
      http.post(`${B}/v1/sessions/:id/recommendations`, () => {
        posts++;
        return HttpResponse.json({ error: { code: 'PROVIDER_UNKNOWN_COMPLETION', action: 'Stop live operations; preserve journal and do not retry.' } }, { status: 409 });
      }),
    );
    const user = userEvent.setup();
    const panel = await screen.findByRole('region', { name: 'Live guarded LLM scoring' });
    await user.click(within(panel).getByRole('checkbox'));
    await user.click(within(panel).getByRole('button', { name: 'Allow live provider requests for this session' }));
    await user.click(screen.getByRole('button', { name: /Get recommendation for turn 1/ }));
    expect(await screen.findByText('Live provider requests are stopped on this page')).toBeInTheDocument();
    expect(screen.getByText(/Stop live operations; preserve journal and do not retry\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Get recommendation for turn 1/ })).toBeDisabled();
    expect(journal.list().find((e) => e.command === 'recommend')?.state).toBe('terminal');
    expect(posts).toBe(1);
  });

  it('a deterministic session on a live backend needs no permission and shows that no provider is involved', async () => {
    const deterministic = { ...pendingWith('deterministic', { reservations: 0, live_calls: 0, new_tokens: 0, cache_reuse: false }), policy: 'deterministic_recipe_recommendation' };
    mount(humanPath, { session: deterministic });
    expect(await screen.findByText('No provider involved')).toBeInTheDocument();
    expect(screen.getByText('not applicable')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Live guarded LLM scoring' })).not.toBeInTheDocument();
  });
});

describe('provider accounting is shown as returned, with cache reuse explained', () => {
  it('live decision reused from the journal: no new request', async () => {
    mount(humanPath, {
      session: pendingWith('live_guarded', { reservations: 0, live_calls: 0, new_tokens: 0, cache_reuse: true, journal_before: journalAfter(1), journal_after: journalAfter(1) }),
    });
    const work = await screen.findByRole('region', { name: 'Provider work for this recommendation' });
    expect(within(work).getByText('Live decision reused from the provider journal')).toBeInTheDocument();
    expect(within(work).getByText('yes: journaled live decision')).toBeInTheDocument();
    expect(within(work).getByText(/no new request was sent/)).toBeInTheDocument();
  });

  it('recorded guarded decision: no provider request, distinct from live', async () => {
    mount(humanPath, { session: pendingWith('recorded_guarded', { reservations: 0, live_calls: 0, new_tokens: 0, cache_reuse: true }), caps: capabilities });
    const work = await screen.findByRole('region', { name: 'Provider work for this recommendation' });
    expect(within(work).getByText('Recorded guarded decision')).toBeInTheDocument();
    expect(within(work).getByText('yes: recorded decision')).toBeInTheDocument();
    expect(within(work).queryByLabelText('Provider journal')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Live guarded LLM scoring' })).not.toBeInTheDocument();
  });
});

describe('synthetic sessions with the live guarded policy', () => {
  it('only single, consented turns: Run 3 and Run all stay disabled', async () => {
    mount(`/lab/sessions/${(synthetic0 as { id: string }).id}`, { session: { ...(synthetic0 as object), policy: GUARDED } });
    const user = userEvent.setup();
    const panel = await screen.findByRole('region', { name: 'Live guarded LLM scoring' });
    const run1 = screen.getByRole('button', { name: 'Run 1 turn with simulator reactions' });
    const run3 = screen.getByRole('button', { name: 'Run 3 turns with simulator reactions' });
    const runAll = screen.getByRole('button', { name: /Run all 12 remaining turns/ });
    expect(run1).toBeDisabled();
    expect(screen.getByText(/multi-turn runs are off/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('checkbox'));
    await user.click(within(panel).getByRole('button', { name: 'Allow live provider requests for this session' }));
    expect(run1).toBeEnabled();
    expect(run3).toBeDisabled();
    expect(runAll).toBeDisabled();
  });
});

describe('Live Session form and Branch Explorer on a live backend', () => {
  it('the guarded policy can be chosen, with a LIVE note', async () => {
    mount('/lab', { session: session0 });
    const option = await screen.findByRole('radio', { name: /Guarded LLM scorer/ });
    expect(option).toBeEnabled();
    expect(screen.getByText(/Live scoring available on this backend\. The session asks for your permission before any provider request/)).toBeInTheDocument();
  });

  it('guarded comparisons stay disabled and the reason (up to 21 provider decisions) is stated; deterministic pairs can still run', async () => {
    let posts = 0;
    mount(`/lab/sessions/${(session1 as { id: string }).id}/explore`, { session: session1 });
    server.use(
      http.post(`${B}/v1/branch-comparisons`, () => {
        posts++;
        return j({ error: { code: 'INTERNAL_ERROR' } });
      }),
    );
    await screen.findByRole('heading', { name: 'Branch explorer' });
    expect(screen.getByText('Live mode: guarded-LLM comparisons are disabled')).toBeInTheDocument();
    expect(screen.getByText(/up to 21 provider requests/)).toBeInTheDocument();
    expect(within(screen.getByLabelText('Policy A')).getByRole('option', { name: /disabled in live mode/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run branch comparison' })).toBeEnabled();
    expect(posts).toBe(0);
  });
});

describe('recovery in live mode', () => {
  it('the journal explains that a reserved decision is never sent twice', async () => {
    const e = journal.begin({ key: 'recommend-live-test-key', command: 'recommend', path: '/v1/sessions/x/recommendations', body: '{"expected_revision":0}', sessionId: 'x' });
    journal.settle(e.key, { state: 'uncertain', note: 'test' });
    mount('/system', { session: session0 });
    await waitFor(() => expect(screen.getByText(/a reserved decision is never sent twice/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Recover' })).toBeEnabled();
  });
});

describe('Overview connection label and live permission panel', () => {
  it('the Overview never calls a live-capable backend "offline"', async () => {
    mount('/', { session: session0 });
    expect(await screen.findByText(/Connected to a local backend with live LLM scoring available/)).toBeInTheDocument();
    expect(screen.queryByText(/Connected to the local backend \(offline mode/)).not.toBeInTheDocument();
  });

  it('the Overview still says offline for an offline backend', async () => {
    mount('/', { session: session0, caps: capabilities });
    expect(await screen.findByText(/Connected to the local backend \(offline mode/)).toBeInTheDocument();
  });

  it('after permission the explanation collapses, while the permission status stays visible', async () => {
    const user = userEvent.setup();
    mount(humanPath, { session: { ...(session0 as object), policy: GUARDED } });
    const panel = await screen.findByRole('region', { name: 'Live guarded LLM scoring' });
    expect(within(panel).queryByText(/How live guarded scoring works/)).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('checkbox'));
    await user.click(within(panel).getByRole('button', { name: 'Allow live provider requests for this session' }));
    expect(within(panel).getByText(/How live guarded scoring works/).closest('details')).not.toHaveAttribute('open');
    expect(within(panel).getByText(/Live provider requests are allowed for this session/)).toBeInTheDocument();
  });
});
