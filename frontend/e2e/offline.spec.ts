import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Hard preflight: never run browser tests unless the backend is OFFLINE. */
test.beforeAll(async ({ request }) => {
  const res = await request.get('/v1/capabilities');
  expect(res.ok(), 'backend must be reachable through the Vite proxy').toBeTruthy();
  const caps = (await res.json()) as { mode: string; live_guarded?: boolean };
  if (caps.mode !== 'offline' || caps.live_guarded === true) {
    throw new Error(`Refusing to run: backend is not offline (mode=${caps.mode}, live_guarded=${String(caps.live_guarded)})`);
  }
});

const ROUTES = ['/', '/lab', '/r1', '/method', '/system'];

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(1);
}

test.describe('accessibility (axe) on every static route', () => {
  for (const route of ROUTES) {
    test(`no serious or critical violations: ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole('main')).toBeVisible();
      // Let data-driven routes settle.
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
    });
  }
});

test.describe('responsive: 375px mobile', () => {
  test.use({ viewport: { width: 375, height: 800 } });
  for (const route of ROUTES) {
    test(`no horizontal page scroll: ${route}`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe('responsive: 375px mobile on data-heavy dynamic pages', () => {
  test.use({ viewport: { width: 375, height: 800 } });
  test('session workspace, comparison (no oracle) and comparison (oracle) fit the viewport', async ({ page }) => {
    await page.goto('/lab');
    await page.getByRole('button', { name: /Omnivore · no hard limits/ }).click();
    await page.getByRole('button', { name: 'Create scenario' }).click();
    await page.getByRole('button', { name: /Get recommendation for turn 1/ }).click();
    await expect(page.getByRole('region', { name: 'Forecast (pending)' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('radio', { name: /Accept/ }).check();
    await page.getByRole('button', { name: 'Submit reaction' }).click();
    await expect(page.getByText('Forecast (made before reveal)')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: /Get recommendation for turn 2/ }).click();
    await page.getByRole('link', { name: /Open the branch explorer/ }).click();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Run branch comparison' }).click();
    await expect(page.getByRole('heading', { name: 'Branch comparison' })).toBeVisible({ timeout: 60_000 });
    await expectNoHorizontalOverflow(page);

    await page.goto('/lab');
    await page.getByRole('radio', { name: /Synthetic simulation/ }).check();
    await page.getByRole('button', { name: 'Create scenario' }).click();
    await page.getByRole('button', { name: 'Run 3 turns with simulator reactions' }).click();
    await expect(page.getByText(/Result of turn 3/)).toBeVisible({ timeout: 90_000 });
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: /Get recommendation for turn 4/ }).click();
    await page.getByRole('link', { name: /Open the branch explorer/ }).click();
    await page.getByRole('button', { name: 'Run branch comparison' }).click();
    await expect(page.getByRole('heading', { name: 'Branch comparison' })).toBeVisible({ timeout: 90_000 });
    await expectNoHorizontalOverflow(page);
  });
});

test('keyboard: the skip link is the first tab stop and moves focus to main', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('overview loop is keyboard operable and never claims a human study', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Forecast/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText('never edited afterwards');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Realized reaction/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('A human study, or measured psychology.')).toBeVisible();
});

test('R1 archive: formal closure is shown as false and the claim is verbatim', async ({ page }) => {
  await page.goto('/r1');
  await expect(page.getByText('formal closure present: false')).toBeVisible();
  await expect(page.getByText(/RQ1 positive gain and RQ3 strict superiority were not established/)).toBeVisible();
  await expect(page.getByText('Frozen historical R1').first()).toBeVisible();
});

test.describe('real human session through the UI', () => {
  test('create → recommend → forecast → structured feedback → forecast vs realized → compare', async ({ page }) => {
    await page.goto('/lab');
    await page.getByRole('button', { name: /Omnivore · no hard limits/ }).click();
    await page.getByRole('button', { name: 'Create scenario' }).click();
    await expect(page).toHaveURL(/\/lab\/sessions\//);
    await expect(page.getByText('Ready for the first recommendation')).toBeVisible();

    await page.getByRole('button', { name: /Get recommendation for turn 1/ }).click();
    await expect(page.getByRole('region', { name: 'Forecast (pending)' })).toBeVisible();
    // Concise screening statement in the main view; the full statement sits in the technical details.
    await expect(page.getByText(/not an allergy-safety check/i)).toBeVisible();
    await page.getByText('Technical details: screening record, ranking and provenance').click();
    await expect(page.getByText(/not an allergy or clinical safety certification/i)).toBeVisible();

    await page.getByRole('radio', { name: /Defer/ }).check();
    await page.getByRole('button', { name: 'Submit reaction' }).click();
    await expect(page.getByText('Forecast (made before reveal)')).toBeVisible();
    await expect(page.getByText('Human-submitted · factual').first()).toBeVisible();
    await expect(page.getByText(/Next: turn 2/)).toBeVisible();

    // Branch explorer from the next pending root.
    await page.getByRole('button', { name: /Get recommendation for turn 2/ }).click();
    await page.getByRole('link', { name: /Open the branch explorer/ }).click();
    await expect(page.getByRole('checkbox', { name: /exhaustive synthetic oracle/i })).toBeDisabled();
    await page.getByRole('radio', { name: '4 expansions' }).check();
    await page.getByRole('button', { name: 'Run branch comparison' }).click();
    await expect(page.getByRole('heading', { name: 'Branch comparison' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/No oracle result/)).toBeVisible();
    await expect(page.getByText(/not changed by a comparison/i)).toBeVisible();
    // The tree shows exactly the budgeted number of expanded nodes.
    await expect(page.getByRole('group', { name: /two-depth reaction tree/i }).getByRole('button')).toHaveCount(4);
  });
});

test.describe('real synthetic session with oracle through the UI', () => {
  for (const preset of [/Structured simulator/, /Agenda-derived simulator/]) {
    test(`synthetic ${String(preset)} → simulator reactions → oracle comparison`, async ({ page }) => {
      await page.goto('/lab');
      await page.getByRole('radio', { name: /Synthetic simulation/ }).check();
      await page.getByRole('radio', { name: preset }).check();
      await page.getByRole('button', { name: 'Create scenario' }).click();
      await expect(page).toHaveURL(/\/lab\/sessions\//);

      await page.getByRole('button', { name: 'Run 3 turns with simulator reactions' }).click();
      await expect(page.getByText(/Result of turn 3/)).toBeVisible({ timeout: 90_000 });
      await expect(page.getByText('Synthetic · factual in simulation').first()).toBeVisible();

      await page.getByRole('button', { name: /Get recommendation for turn 4/ }).click();
      await expect(page.getByText('The simulator decides the reaction')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Submit reaction' })).toHaveCount(0);
      await page.getByRole('link', { name: /Open the branch explorer/ }).click();

      await expect(page.getByRole('checkbox', { name: /exhaustive synthetic oracle/i })).toBeChecked();
      await page.getByRole('radio', { name: '4 expansions' }).check();
      await page.getByRole('button', { name: 'Run branch comparison' }).click();
      await expect(page.getByRole('heading', { name: 'Branch comparison' })).toBeVisible({ timeout: 90_000 });

      const oracle = page.getByRole('region', { name: 'Synthetic oracle' });
      await expect(oracle.getByText('Synthetic reference · not human truth')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Evaluation metrics' })).toContainText('regret');
      // Whatever the outcome, it is stated plainly (agreement is never overclaimed, disagreement never hidden).
      await expect(page.getByRole('region', { name: 'Evaluation metrics' })).toContainText(/(agreed|disagreed) with the synthetic reference/);
    });
  }
});

async function expectAccessible(page: Page) {
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test('accessibility of the data-heavy views: pending turn, comparison without oracle, comparison with oracle', async ({ page }) => {
  // Human: pending turn + comparison without oracle.
  await page.goto('/lab');
  await page.getByRole('button', { name: /Vegan · ≤10 ingredients/ }).click();
  await page.getByRole('button', { name: 'Create scenario' }).click();
  await page.getByRole('button', { name: /Get recommendation for turn 1/ }).click();
  await expect(page.getByRole('region', { name: 'Forecast (pending)' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('radio', { name: /Accept/ }).check();
  await page.getByRole('button', { name: 'Submit reaction' }).click();
  await expect(page.getByText('Forecast (made before reveal)')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: /Get recommendation for turn 2/ }).click();
  await page.getByRole('link', { name: /Open the branch explorer/ }).click();
  await expectAccessible(page);
  await page.getByRole('radio', { name: '4 expansions' }).check();
  await page.getByRole('button', { name: 'Run branch comparison' }).click();
  await expect(page.getByRole('heading', { name: 'Branch comparison' })).toBeVisible({ timeout: 60_000 });
  await expectAccessible(page);

  // Synthetic: comparison with oracle.
  await page.goto('/lab');
  await page.getByRole('radio', { name: /Synthetic simulation/ }).check();
  await page.getByRole('button', { name: 'Create scenario' }).click();
  await page.getByRole('button', { name: 'Run 3 turns with simulator reactions' }).click();
  await expect(page.getByText(/Result of turn 3/)).toBeVisible({ timeout: 90_000 });
  await expectAccessible(page);
  await page.getByRole('button', { name: /Get recommendation for turn 4/ }).click();
  await page.getByRole('link', { name: /Open the branch explorer/ }).click();
  await page.getByRole('radio', { name: '4 expansions' }).check();
  await page.getByRole('button', { name: 'Run branch comparison' }).click();
  await expect(page.getByRole('heading', { name: 'Branch comparison' })).toBeVisible({ timeout: 90_000 });
  await expectAccessible(page);
});
