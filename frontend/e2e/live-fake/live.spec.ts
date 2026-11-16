import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Live guarded workflow in the browser, against the FAKE-PROVIDER HARNESS
 * (scripts/fake_live_backend.py) behind the Vite proxy. Every provider request is
 * counted independently by the harness (fake_provider_calls). Hard preflight: the
 * spec refuses to run against anything that is not the harness.
 */
const MARKER = 'fake_in_process_test_double';
const RUN = `pw${Date.now().toString(36)}`;

async function caps(request: APIRequestContext): Promise<{ mode: string; live_guarded?: boolean; provider_transport?: string; fake_provider_calls: number }> {
  const res = await request.get('/v1/capabilities');
  expect(res.ok(), 'backend must be reachable through the Vite proxy').toBeTruthy();
  return res.json();
}

test.beforeAll(async ({ request }) => {
  const c = await caps(request);
  if (c.provider_transport !== MARKER) {
    throw new Error(`Refusing to run: the backend behind the proxy is not the fake-provider harness (provider_transport=${String(c.provider_transport)})`);
  }
  expect(c.mode).toBe('live_opt_in');
  expect(c.live_guarded).toBe(true);
});

async function createGuardedHuman(page: Page, request = 'Recommend a safe recipe.') {
  await page.goto('/lab');
  await page.getByRole('button', { name: /Omnivore · no hard limits/ }).click();
  await page.getByLabel('Request (fixed for this scenario)').fill(request);
  await page.getByRole('radio', { name: /Guarded LLM scorer/ }).check();
  await expect(page.getByText(/Live scoring available on this backend\. The session asks for your permission before any provider request/)).toBeVisible();
  await page.getByRole('button', { name: 'Create scenario' }).click();
  await expect(page.getByRole('region', { name: 'Live guarded LLM scoring' })).toBeVisible();
}

async function allowLive(page: Page) {
  const panel = page.getByRole('region', { name: 'Live guarded LLM scoring' });
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Allow live provider requests for this session' }).click();
  await expect(panel.getByText(/Live provider requests are allowed for this session/)).toBeVisible();
}

async function apiPost(request: APIRequestContext, path: string, data: unknown) {
  const res = await request.post(path, { data, headers: { 'Idempotency-Key': `${RUN}-${Math.random().toString(36).slice(2)}` } });
  expect(res.status()).toBe(200);
  return res.json();
}

test('human guarded session: nothing is sent before permission; then one live request per click, with accounting', async ({ page, request }) => {
  await createGuardedHuman(page);
  await expect(page.getByRole('status', { name: 'Backend status' })).toHaveText('Live backend connected');
  await expect(page.getByText('Live LLM scoring available · per-session permission required')).toHaveCount(0);
  const get1 = page.getByRole('button', { name: 'Get recommendation for turn 1 (may send 1 live provider request)' });
  await expect(get1).toBeDisabled();
  const before = (await caps(request)).fake_provider_calls;

  await allowLive(page);
  expect((await caps(request)).fake_provider_calls).toBe(before);
  await get1.click();
  const work = page.getByRole('region', { name: 'Provider work for this recommendation' });
  await expect(work.getByText('New live provider decision')).toBeVisible();
  await expect(work.getByText('live_guarded')).toBeVisible();
  await expect(work.getByText('no: new provider response')).toBeVisible();
  await expect(work.getByLabel('Provider journal')).toBeVisible();
  expect((await caps(request)).fake_provider_calls).toBe(before + 1);

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);

  // The reaction is human-owned; the next guarded turn is again one click, one possible request.
  await page.getByRole('radio', { name: /Accept/ }).check();
  await page.getByRole('button', { name: 'Submit reaction' }).click();
  await expect(page.getByText('Forecast (made before reveal)')).toBeVisible();
  await page.getByRole('button', { name: /Get recommendation for turn 2/ }).click();
  await expect(work.getByText('New live provider decision')).toBeVisible();
  expect((await caps(request)).fake_provider_calls).toBe(before + 2);
});

test('a context the provider already answered is reused from the journal: no request, shown as cache reuse', async ({ page, request }) => {
  const body = {
    world_kind: 'human_interaction',
    policy: 'guarded_llm_score_vector',
    prediction_backend: 'current_structured_simulator@1',
    predictor: 'population',
    persona: { user_id: `${RUN}-reuse`, display_name: 'Reuse check', dietary_pattern: 'omnivore', allergies: [], excluded_ingredients: [], health_goals: [], taste_preferences: [] },
    request: 'Recommend a safe recipe.',
    segments: 1,
    turns_per_segment: 3,
  };
  const first = await apiPost(request, '/v1/sessions', body);
  await apiPost(request, `/v1/sessions/${first.id}/recommendations`, { expected_revision: 0 });
  const second = await apiPost(request, '/v1/sessions', body);
  const before = (await caps(request)).fake_provider_calls;

  await page.goto(`/lab/sessions/${second.id}`);
  await allowLive(page);
  await page.getByRole('button', { name: /Get recommendation for turn 1/ }).click();
  const work = page.getByRole('region', { name: 'Provider work for this recommendation' });
  await expect(work.getByText('Live decision reused from the provider journal')).toBeVisible();
  await expect(work.getByText('yes: journaled live decision')).toBeVisible();
  expect((await caps(request)).fake_provider_calls).toBe(before);
});

test('synthetic guarded session: one consented turn at a time; Run 3 and Run all stay disabled', async ({ page }) => {
  await page.goto('/lab');
  await page.getByRole('radio', { name: /Synthetic simulation/ }).check();
  await page.getByRole('radio', { name: /Guarded LLM scorer/ }).check();
  await page.getByRole('button', { name: 'Create scenario' }).click();
  await expect(page.getByRole('region', { name: 'Live guarded LLM scoring' })).toBeVisible();
  const run1 = page.getByRole('button', { name: 'Run 1 turn with simulator reactions' });
  await expect(run1).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Run 3 turns with simulator reactions' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Run all 12 remaining turns/ })).toBeDisabled();
  await allowLive(page);
  await expect(page.getByRole('button', { name: 'Run 3 turns with simulator reactions' })).toBeDisabled();
  await run1.click();
  await expect(page.getByText(/Result of turn 1/)).toBeVisible({ timeout: 60_000 });
});

test('branch explorer on a live backend: guarded comparisons disabled with the reason; a deterministic pair runs with no provider request', async ({ page, request }) => {
  await page.goto('/lab');
  await page.getByRole('button', { name: /Omnivore · no hard limits/ }).click();
  await page.getByRole('button', { name: 'Create scenario' }).click();
  await expect(page.getByRole('region', { name: 'Live guarded LLM scoring' })).toHaveCount(0);
  await page.getByRole('button', { name: /Get recommendation for turn 1/ }).click();
  await page.getByRole('link', { name: /Open the branch explorer/ }).click();
  await expect(page.getByText('Live mode: guarded-LLM comparisons are disabled')).toBeVisible();
  await expect(page.getByLabel('Policy A').getByRole('option', { name: /disabled in live mode/ })).toBeDisabled();
  const before = (await caps(request)).fake_provider_calls;
  await page.getByRole('button', { name: 'Run branch comparison' }).click();
  await expect(page.getByRole('heading', { name: 'Branch comparison' })).toBeVisible({ timeout: 90_000 });
  expect((await caps(request)).fake_provider_calls).toBe(before);
});

test('unknown completion: shown as terminal, live requests stop on the page, and the journal never offers recovery', async ({ page, request }) => {
  await createGuardedHuman(page, 'Recommend a safe recipe. fake-provider-timeout');
  await allowLive(page);
  const before = (await caps(request)).fake_provider_calls;
  await page.getByRole('button', { name: /Get recommendation for turn 1/ }).click();
  await expect(page.getByText('PROVIDER_UNKNOWN_COMPLETION').first()).toBeVisible();
  await expect(page.getByText('Live provider requests are stopped on this page')).toBeVisible();
  await expect(page.getByRole('button', { name: /Get recommendation for turn 1/ })).toBeDisabled();
  expect((await caps(request)).fake_provider_calls).toBe(before + 1);

  await page.goto('/system');
  await expect(page.getByText('Provider unknown completion — never retry').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recover' })).toHaveCount(0);
});

test.describe('375px', () => {
  test.use({ viewport: { width: 375, height: 800 } });
  test('the live panel and the provider accounting fit the viewport', async ({ page }) => {
    await createGuardedHuman(page);
    await allowLive(page);
    await page.getByRole('button', { name: /Get recommendation for turn 1/ }).click();
    await expect(page.getByRole('region', { name: 'Provider work for this recommendation' }).getByText('New live provider decision')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
