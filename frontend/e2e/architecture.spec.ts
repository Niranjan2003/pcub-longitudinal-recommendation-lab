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

const VIEWS = ['system', 'lifecycle', 'counterfactual', 'evaluation'] as const;

async function expectAccessible(page: Page) {
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(1);
}

test.describe('Architecture explorer — accessibility', () => {
  for (const v of VIEWS) {
    test(`no serious or critical axe violations: ${v}`, async ({ page }) => {
      await page.goto(`/architecture?view=${v}`);
      await expect(page.getByRole('tab', { selected: true })).toBeVisible();
      await expectAccessible(page);
    });
  }

  test('no violations with a component selected (highlight state)', async ({ page }) => {
    await page.goto('/architecture?view=system&node=transition');
    await expect(page.getByRole('heading', { name: 'State & history transition' })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('Architecture explorer — 375px mobile', () => {
  test.use({ viewport: { width: 375, height: 800 } });
  for (const v of VIEWS) {
    test(`no horizontal page scroll: ${v}`, async ({ page }) => {
      await page.goto(`/architecture?view=${v}`);
      await expect(page.getByRole('tab', { selected: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test('narrow screens get the component list instead of the diagram, and it still opens the inspector', async ({ page }) => {
    await page.goto('/architecture');
    await expect(page.getByRole('group', { name: /System map/ })).toBeHidden();
    const list = page.getByRole('navigation', { name: 'System components' });
    await list.getByRole('button', { name: /Longitudinal Memory Manager/ }).click();
    await expect(page.getByRole('heading', { name: 'Longitudinal Memory Manager' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test('keyboard: tab into the map, Enter selects a component, Escape clears; arrows switch views', async ({ page }) => {
  await page.goto('/architecture');
  const node = page.getByRole('button', { name: 'Session Orchestrator (Orchestration)' });
  await node.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Component inspector' }).getByRole('heading', { name: 'Session Orchestrator' })).toBeVisible();
  await expect(page).toHaveURL(/node=orchestrator/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Component inspector' }).getByRole('heading', { name: 'Select a component' })).toBeVisible();

  await page.getByRole('tab', { name: /System map/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Longitudinal lifecycle/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /Evaluation map/ })).toHaveAttribute('aria-selected', 'true');
});

test('lifecycle stepper and the counterfactual human/synthetic distinction', async ({ page }) => {
  await page.goto('/architecture?view=lifecycle');
  await page.getByRole('button', { name: /Step 7: Atomic history and state transition/ }).click();
  await expect(page.getByRole('heading', { name: 'Atomic history and state transition' })).toBeVisible();
  await expect(page.getByText(/no learned identity or memory transferred between separate/i)).toBeVisible();

  await page.goto('/architecture?view=counterfactual');
  await page.getByRole('radio', { name: /Human session/ }).check();
  await page.getByRole('button', { name: /Exhaustive synthetic oracle/ }).click();
  await expect(page.getByText(/no human oracle exists/i).first()).toBeVisible();
});

test('real offline backend: a synthetic comparison created in the Lab is overlaid with the backend’s own expansion and oracle', async ({ page }) => {
  // Create a real synthetic session and comparison through the UI (writes to the offline dev DB).
  await page.goto('/lab');
  await page.getByRole('radio', { name: /Synthetic simulation/ }).check();
  await page.getByRole('button', { name: 'Create scenario' }).click();
  await page.getByRole('button', { name: 'Run 3 turns with simulator reactions' }).click();
  await expect(page.getByText(/Result of turn 3/)).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: /Get recommendation for turn 4/ }).click();
  await page.getByRole('link', { name: /Open the branch explorer/ }).click();
  await page.getByRole('radio', { name: '4 expansions' }).check();
  await page.getByRole('button', { name: 'Run branch comparison' }).click();
  await expect(page.getByRole('heading', { name: 'Branch comparison' })).toBeVisible({ timeout: 90_000 });
  const jobId = page.url().split('/comparisons/')[1]!;

  // Overlay it in the explorer.
  await page.goto('/architecture?view=counterfactual');
  await page.getByLabel('Comparison', { exact: true }).selectOption(jobId);
  await expect(page.getByText(/open full result/)).toBeVisible();
  await page.getByRole('button', { name: /Budget-limited expansion/ }).click();
  await expect(page.locator('[data-forest-node][data-state="expanded"]')).toHaveCount(4);
  await page.getByRole('button', { name: /Regret and returned metrics/ }).click();
  await expect(page.getByRole('region', { name: 'Synthetic oracle' })).toContainText('never human ground truth');
  await expect(page.getByRole('region', { name: 'Evaluation metrics' })).toContainText('regret');
  await expectAccessible(page);
});

test('Overview names the system as the testbed and PCUB as its allocation method', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Its PCUB method allocates a limited budget/)).toBeVisible();
  await expect(page.getByText(/PCUB is a research testbed/)).toHaveCount(0);
});
