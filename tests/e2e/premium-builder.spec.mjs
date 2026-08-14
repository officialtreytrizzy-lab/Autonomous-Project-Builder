import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const fixtures = (...names) => names.map((name) => join(process.cwd(), 'tests', 'fixtures', 'intake', name));

async function resolveMaterialDecisions(page) {
  const forms = page.locator('.decision-well form');
  while (await forms.count()) {
    const before = await forms.count();
    const form = forms.first();
    await form.getByPlaceholder(/State the intended requirement/i).fill('Confirmation happens before payment. Preserve the private local-only scope and all explicit acceptance requirements.');
    await form.getByRole('button', { name: /Resolve decision/i }).click();
    await expect(forms).toHaveCount(before - 1);
  }
}

test('multimodal evidence becomes an approved immutable local build', async ({ page }) => {
  const fatalConsole = [];
  page.on('console', (message) => message.type() === 'error' && fatalConsole.push(message.text()));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByRole('heading', { name: /Describe the outcome/i })).toBeVisible();
  await page.getByLabel('Project name').fill(`Premium Multimodal E2E ${Date.now()}`);
  await page.getByLabel('Finished outcome').fill('Build the production-ready private local restaurant ordering application described by all supplied textual and visual evidence.');
  await page.locator('input[type=file]').setInputFiles(fixtures('restaurant-flow.pdf', 'product-brief.docx'));
  await page.getByRole('button', { name: 'Understand project' }).click();

  await expect(page.locator('.coverage')).toContainText(/\d+\/\d+\s+pages/i, { timeout: 18 * 60 * 1000 });
  await expect(page.getByRole('heading', { name: /source-grounded\s+Build Brief/i })).toBeVisible();
  if (await page.locator('.decision-well').isVisible().catch(() => false)) await resolveMaterialDecisions(page);
  await expect(page.getByRole('button', { name: /Review approval contract/i })).toBeEnabled();

  const citation = page.locator('.citation-strip button').filter({ hasText: /p\.\s*1|p\.\s*2/i }).first();
  await expect(citation).toBeVisible();
  await citation.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close evidence' }).click();

  await page.getByRole('button', { name: /Review approval contract/i }).click();
  await expect(page.getByRole('heading', { name: /One approval/i })).toBeVisible();
  await page.getByRole('button', { name: 'Approve & Build', exact: true }).click();
  await expect(page.getByText('Living Build Spine')).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: 'output/playwright/premium-builder-1440x960.png', fullPage: true });
  expect(fatalConsole.filter((line) => !/favicon/i.test(line))).toEqual([]);
});

test('premium control surface remains usable at compact desktop size and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1080, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByLabel('Project name')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  await expect(page.locator('.health-compact, .system-health')).toBeVisible();
  await page.screenshot({ path: 'output/playwright/premium-builder-1080x720.png', fullPage: true });
});
