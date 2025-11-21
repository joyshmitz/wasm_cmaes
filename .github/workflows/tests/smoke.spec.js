import { test, expect } from '@playwright/test';

test('viz page loads and runs', async ({ page }) => {
  await page.goto('/examples/viz-benchmarks.html');
  await expect(page.locator('#run')).toBeVisible();
  await page.click('#run');
  await page.waitForTimeout(2000);
  await expect(page.locator('#best-display')).not.toHaveText('–');
});
