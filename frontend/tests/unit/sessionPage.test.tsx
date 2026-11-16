import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../msw/server';
import { createTestRouter } from '@/app/router';
import { createQueryClient } from '@/state/queryClient';
import { journal } from '@/api/commands/journal';
import capabilities from '../fixtures/captured/capabilities.json';
import recipe from '../fixtures/captured/recipe_249560.json';
import session0 from '../fixtures/captured/session_rev0.json';
import session1 from '../fixtures/captured/session_rev1_pending.json';
import session2 from '../fixtures/captured/session_rev2_after_feedback.json';

const B = 'http://backend.test';
const SID = (session0 as { id: string }).id;
const PENDING_ID = (session1 as { pending: { id: string } }).pending.id;

interface Server {
  session: unknown;
  posts: { path: string; key: string | null; body: unknown }[];
}

function useBackend(opts: { session: unknown; caps?: unknown }): Server {
  const state: Server = { session: opts.session, posts: [] };
  server.use(
    http.get(`${B}/v1/capabilities`, () => HttpResponse.json((opts.caps ?? capabilities) as JsonBodyType)),
    http.get(`${B}/v1/sessions/:id`, () => HttpResponse.json(state.session as JsonBodyType)),
    http.get(`${B}/v1/recipes/:id`, () => HttpResponse.json(recipe)),
  );
  return state;
}

function mount() {
  const qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false } });
  const router = createTestRouter([`/lab/sessions/${SID}`]);
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const closed = { ...(session2 as object), status: 'closed' };

describe('Session workspace — pending recommendation', () => {
  it('shows the forecast as pending (not an outcome), the safety disclaimer, and an unselected reaction form', async () => {
    useBackend({ session: session1 });
    mount();
    expect(await screen.findByRole('region', { name: 'Forecast (pending)' })).toBeInTheDocument();
    expect(screen.getByText(/not an allergy or clinical safety certification/i)).toBeInTheDocument();
    expect(screen.getByText(/Forecast · pending/)).toBeInTheDocument();
    expect(screen.getByText(/A forecast, not an outcome/i)).toBeInTheDocument();
    for (const r of ['Accept', 'Modify / clarify', 'Defer', 'Reject']) {
      expect(screen.getAllByText(r).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('button', { name: 'Submit reaction' })).toBeDisabled();
    // Engineered-state caption: never psychological measurement.
    expect(screen.getByText(/not measurements/i)).toBeInTheDocument();
  });

  it('shows conformal sets as diagnostic with the backend meaning verbatim', async () => {
    useBackend({ session: session1 });
    mount();
    const panel = await screen.findByRole('region', { name: 'Conformal diagnostics' });
    expect(within(panel).getByText(/no human coverage guarantee; no branch pruning/)).toBeInTheDocument();
    expect(within(panel).getByText(/Diagnostic only/)).toBeInTheDocument();
    expect(within(panel).getAllByRole('row').length).toBeGreaterThanOrEqual(5); // header + 4 methods
  });

  it('submits EXACTLY the structured feedback body (revision, pending id, reaction, continuation, typed change) with a journaled key', async () => {
    const state = useBackend({ session: session1 });
    server.use(
      http.post(`${B}/v1/sessions/:id/feedback`, async ({ request }) => {
        state.posts.push({ path: new URL(request.url).pathname, key: request.headers.get('idempotency-key'), body: await request.json() });
        state.session = session2;
        return HttpResponse.json(session2);
      }),
    );
    mount();
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Submit reaction' });
    await user.click(screen.getByRole('radio', { name: /Modify \/ clarify/ }));
    await user.click(screen.getByRole('button', { name: '+ Add a change' }));
    await user.click(screen.getByRole('checkbox', { name: 'effort' }));
    await user.type(screen.getByLabelText('Instruction 1'), 'Please make it quicker.');
    await user.click(screen.getByRole('button', { name: 'Submit reaction' }));

    await waitFor(() => expect(state.posts).toHaveLength(1));
    const p = state.posts[0]!;
    expect(p.path).toBe(`/v1/sessions/${SID}/feedback`);
    expect(p.key).toMatch(/^pcubfe-v1:feedback:/);
    expect(p.body).toEqual({
      expected_revision: 1,
      operation: 'feedback',
      recommendation_id: PENDING_ID,
      reaction: 'MODIFY_CLARIFY',
      continuation: 'CONTINUE',
      requested_changes: [{ dimensions: ['effort'], instruction: 'Please make it quicker.' }],
    });
    // Journaled before sending, committed after.
    expect(journal.list().find((e) => e.command === 'feedback')?.state).toBe('committed');
    // Forecast vs realized side by side after reveal.
    expect(await screen.findByText('Forecast (made before reveal)')).toBeInTheDocument();
    expect(screen.getAllByText('Realized').length).toBeGreaterThan(0);
    expect(screen.getByText(/makes no accuracy claim/i)).toBeInTheDocument();
  });

  it('a requested change without an instruction blocks submission', async () => {
    useBackend({ session: session1 });
    mount();
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Submit reaction' });
    await user.click(screen.getByRole('radio', { name: /Accept/ }));
    await user.click(screen.getByRole('button', { name: '+ Add a change' }));
    expect(screen.getByRole('button', { name: 'Submit reaction' })).toBeDisabled();
    expect(screen.getByText(/needs an instruction/i)).toBeInTheDocument();
  });

  it('DISENGAGE asks for confirmation and sends nothing until confirmed', async () => {
    const state = useBackend({ session: session1 });
    server.use(
      http.post(`${B}/v1/sessions/:id/feedback`, async ({ request }) => {
        state.posts.push({ path: '', key: null, body: await request.json() });
        return HttpResponse.json(closed);
      }),
    );
    mount();
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Submit reaction' });
    await user.click(screen.getByRole('radio', { name: /Reject/ }));
    await user.click(screen.getByRole('radio', { name: /Disengage/ }));
    await user.click(screen.getByRole('button', { name: 'Submit reaction' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/closes the session permanently/i)).toBeInTheDocument();
    expect(state.posts).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Go back' }));
    expect(state.posts).toHaveLength(0);
  });
});

describe('Session workspace — failure states are real states', () => {
  it('STALE_REVISION is shown with its code, plain explanation, and a reload action (no retry)', async () => {
    const state = useBackend({ session: session1 });
    let calls = 0;
    server.use(
      http.post(`${B}/v1/sessions/:id/feedback`, () => {
        calls++;
        return HttpResponse.json({ error: { code: 'STALE_REVISION' } }, { status: 409 });
      }),
    );
    void state;
    mount();
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Submit reaction' });
    await user.click(screen.getByRole('radio', { name: /Accept/ }));
    await user.click(screen.getByRole('button', { name: 'Submit reaction' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('STALE_REVISION')).toBeInTheDocument();
    expect(within(alert).getByText(/changed since you last loaded it/i)).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Reload current session' })).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it('NO_SAFE_RECOMMENDATION explains that constraints are never relaxed', async () => {
    useBackend({ session: session0 });
    server.use(http.post(`${B}/v1/sessions/:id/recommendations`, () => HttpResponse.json({ error: { code: 'NO_SAFE_RECOMMENDATION' } }, { status: 422 })));
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Get recommendation for turn 1/ }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('NO_SAFE_RECOMMENDATION')).toBeInTheDocument();
    expect(within(alert).getByText(/never relaxed/i)).toBeInTheDocument();
  });

  it('RECORDED_CONTEXT_UNAVAILABLE explains the 77-context closure and that no policy was substituted', async () => {
    useBackend({ session: { ...(session0 as object), policy: 'guarded_llm_score_vector' } });
    server.use(http.post(`${B}/v1/sessions/:id/recommendations`, () => HttpResponse.json({ error: { code: 'RECORDED_CONTEXT_UNAVAILABLE' } }, { status: 409 })));
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Get recommendation for turn 1/ }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/77 exact contexts/)).toBeInTheDocument();
    expect(within(alert).getByText(/No other policy was substituted/)).toBeInTheDocument();
  });

  it('a lost connection leaves an UNCERTAIN command; Recover replays the SAME key and body, only when the user clicks', async () => {
    useBackend({ session: session0 });
    const seen: { key: string | null; body: string }[] = [];
    server.use(
      http.post(`${B}/v1/sessions/:id/recommendations`, async ({ request }) => {
        seen.push({ key: request.headers.get('idempotency-key'), body: await request.text() });
        if (seen.length === 1) return HttpResponse.error();
        return HttpResponse.json(session1);
      }),
    );
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Get recommendation for turn 1/ }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/may or may not have been committed/i)).toBeInTheDocument();
    // Nothing is replayed automatically.
    await new Promise((r) => setTimeout(r, 100));
    expect(seen).toHaveLength(1);

    await user.click(within(alert).getByRole('button', { name: 'Recover' }));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toEqual(seen[0]);
    await waitFor(() => expect(journal.list().find((e) => e.command === 'recommend')?.state).toBe('committed'));
  });
});

describe('Session workspace — closed sessions and live mode', () => {
  it('a closed session is a read-only record: no feedback form, no new recommendation, no end button', async () => {
    useBackend({ session: closed });
    mount();
    expect(await screen.findByText('This session is closed')).toBeInTheDocument();
    expect(screen.getAllByText(/Closed · read-only record/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Submit reaction' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Get recommendation/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /End session/ })).not.toBeInTheDocument();
  });

  it('live-capable backend + guarded policy: nothing is sent before explicit permission', async () => {
    let posts = 0;
    useBackend({
      session: { ...(session0 as object), policy: 'guarded_llm_score_vector' },
      caps: { ...capabilities, mode: 'live_opt_in', live_guarded: true },
    });
    server.use(
      http.post(`${B}/v1/sessions/:id/recommendations`, () => {
        posts++;
        return HttpResponse.json(session1);
      }),
    );
    mount();
    expect(await screen.findByRole('region', { name: 'Live guarded LLM scoring' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Get recommendation for turn 1/ })).toBeDisabled();
    expect(posts).toBe(0);
  });

  it('an unknown session id shows a not-found state that names the database, with no invented data', async () => {
    server.use(
      http.get(`${B}/v1/capabilities`, () => HttpResponse.json(capabilities)),
      http.get(`${B}/v1/sessions/:id`, () => HttpResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })),
    );
    mount();
    expect(await screen.findByText('Session not found in this backend database')).toBeInTheDocument();
  });
});
