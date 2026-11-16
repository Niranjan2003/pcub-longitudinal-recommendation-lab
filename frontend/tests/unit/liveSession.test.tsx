import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../msw/server';
import { createTestRouter } from '@/app/router';
import { createQueryClient } from '@/state/queryClient';
import capabilities from '../fixtures/captured/capabilities.json';
import recipe from '../fixtures/captured/recipe_249560.json';
import humanRev0 from '../fixtures/captured/session_rev0.json';
import synAfter from '../fixtures/captured/synthetic_structured_after_advance.json';

const B = 'http://backend.test';
const j = (v: unknown) => HttpResponse.json(v as JsonBodyType);

function mount(path: string, session: unknown) {
  server.use(
    http.get(`${B}/v1/capabilities`, () => j(capabilities)),
    http.get(`${B}/v1/sessions/:id`, () => j(session)),
    http.get(`${B}/v1/recipes/:id`, () => j(recipe)),
  );
  const qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={createTestRouter([path])} />
    </QueryClientProvider>,
  );
}

const sid = (synAfter as { id: string }).id;

describe('Live Session naming', () => {
  it('the primary navigation and the page heading say “Live Session”; the route stays /lab', async () => {
    mount('/lab', synAfter);
    expect(await screen.findByRole('heading', { level: 1, name: 'Live Session' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const link = within(nav).getByRole('link', { name: 'Live Session' });
    expect(link).toHaveAttribute('href', '/lab');
    expect(within(nav).queryByRole('link', { name: 'Lab' })).not.toBeInTheDocument();
  });

  it('a human session is labelled by its world (“Human interaction”), not as a submitted reaction', async () => {
    mount(`/lab/sessions/${(humanRev0 as { id: string }).id}`, humanRev0);
    expect(await screen.findByText('Human interaction')).toBeInTheDocument();
  });
});

describe('Synthetic session guidance', () => {
  it('explains the fixture, simulator, horizon (from the backend plan) and prediction versus outcome, and offers to run the remaining turns', async () => {
    mount(`/lab/sessions/${sid}`, synAfter);
    expect(await screen.findByText('How a synthetic simulation works')).toBeInTheDocument();
    expect(screen.getByText(/2 longitudinal segments × 6 turns \(12 turns in total\)/)).toBeInTheDocument();
    expect(screen.getByText(/Predefined fixture\./)).toBeInTheDocument();
    expect(screen.getByText(/Independent simulator reactions\./)).toBeInTheDocument();
    expect(screen.getByText(/Prediction versus outcome\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run all 11 remaining turns' })).toBeEnabled();
  });

  it('a closed session shows a trajectory summary built only from returned values', async () => {
    const closed = { ...(synAfter as Record<string, unknown>), status: 'closed' };
    mount(`/lab/sessions/${sid}`, closed);
    const summary = await screen.findByRole('region', { name: 'Trajectory summary' });
    expect(within(summary).getByText(/1 of 12 planned turns recorded/)).toBeInTheDocument();
    const title = (synAfter as { history: { action: { selected_item: { title: string } } }[] }).history[0]!.action.selected_item.title;
    expect(within(summary).getByText(title)).toBeInTheDocument();
    expect(within(summary).getByText(/No accuracy score is computed/)).toBeInTheDocument();
    expect(within(summary).getByText('Engineered state after the last recorded turn')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run all/ })).not.toBeInTheDocument();
  });
});

describe('Constraint controls', () => {
  it('offers no allergy or exclusion input, disables unsupported diets and states the filter limits', async () => {
    mount('/lab', synAfter);
    expect(await screen.findByText(/not suitable for allergy-sensitive meal planning/)).toBeInTheDocument();
    expect(screen.getByText(/Allergy and ingredient-exclusion inputs\s+are not offered in this release/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Allergies/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Excluded ingredients/)).not.toBeInTheDocument();
    const diet = screen.getByLabelText('Dietary pattern');
    expect(within(diet).getByRole('option', { name: /Pescatarian/ })).toBeDisabled();
    expect(within(diet).getByRole('option', { name: /^Other/ })).toBeDisabled();
    expect(within(diet).getByRole('option', { name: /Vegetarian \(approximate screening\)/ })).toBeEnabled();
    expect(within(diet).getByRole('option', { name: /Pescatarian \(not supported\)/ })).toBeDisabled();
    expect(screen.getByText(/Maximum total recipe time/)).toBeInTheDocument();
    expect(screen.getByText(/A soft instruction, not a search or a filter/)).toBeInTheDocument();
    expect(screen.queryByText(/peanut allergy/i)).not.toBeInTheDocument();
  });

  it('a human scenario is created with empty allergy and exclusion lists', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const posts: unknown[] = [];
    server.use(
      http.post(`${B}/v1/sessions`, async ({ request }) => {
        posts.push(await request.json());
        return j(humanRev0);
      }),
    );
    mount('/lab', humanRev0);
    await user.click(await screen.findByRole('button', { name: /Vegetarian · ≤30 min total time/ }));
    await user.click(screen.getByRole('button', { name: 'Create scenario' }));
    await screen.findByText('Human interaction');
    const body = posts[0] as { persona: { allergies: string[]; excluded_ingredients: string[]; dietary_pattern: string; max_total_time_minutes: number } };
    expect(body.persona.allergies).toEqual([]);
    expect(body.persona.excluded_ingredients).toEqual([]);
    expect(body.persona.dietary_pattern).toBe('vegetarian');
    expect(body.persona.max_total_time_minutes).toBe(30);
  });
});
