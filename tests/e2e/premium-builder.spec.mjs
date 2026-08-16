import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const fixtures = (...names) => names.map((name) => join(process.cwd(), 'tests', 'fixtures', 'intake', name));

async function beginNewProject(page) {
  await page.goto('/');
  const firstRun = page.getByRole('button', { name: /Build a new app/i });
  if (await firstRun.isVisible().catch(() => false)) await firstRun.click();
  else await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByRole('heading', { name: /Tell Builder what/i })).toBeVisible();
}

test('production compose surface accepts multimodal evidence without UI errors', async ({ page }) => {
  const fatalConsole = [];
  page.on('console', (message) => message.type() === 'error' && fatalConsole.push(message.text()));
  await page.setViewportSize({ width: 1440, height: 960 });
  await beginNewProject(page);

  await page.getByLabel('Project name').fill(`Premium Multimodal UI ${Date.now()}`);
  await page.getByLabel('What should the finished app do?').fill('Build a production-ready private local application from the supplied requirements and visual references.');
  await page.locator('input[type=file]').setInputFiles(fixtures('restaurant-flow.pdf', 'product-brief.docx'));

  await expect(page.getByText('restaurant-flow.pdf')).toBeVisible();
  await expect(page.getByText('product-brief.docx')).toBeVisible();
  await expect(page.getByRole('button', { name: /Review what Builder understood/i })).toBeEnabled();
  await expect(page.locator('.system-health')).toBeVisible();
  await page.screenshot({ path: 'output/playwright/premium-builder-1440x960.png', fullPage: true });
  expect(fatalConsole.filter((line) => !/favicon/i.test(line))).toEqual([]);
});

test('premium control surface remains usable at compact desktop size and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1080, height: 720 });
  await beginNewProject(page);
  await expect(page.getByLabel('Project name')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  await expect(page.locator('.health-compact, .system-health')).toBeVisible();
  await page.screenshot({ path: 'output/playwright/premium-builder-1080x720.png', fullPage: true });
});
