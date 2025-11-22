import { test, expect } from '@playwright/test';

async function parseBest(page) {
  const text = await page.textContent('#best-display');
  if (!text) return Number.NaN;
  const m = text.match(/([-+]?[0-9]*\.?[0-9]+(?:e[-+]?\d+)?)/i);
  return m ? Number(m[1]) : Number.NaN;
}

test('CMA-ES run improves best fitness', async ({ page }) => {
  await page.goto('/examples/viz-benchmarks.html');
  await page.click('#run');

  const initial = await parseBest(page);
  await expect(initial).not.toBeNaN();

  await page.waitForFunction(() => {
    const el = document.querySelector('#best-display');
    if (!el) return false;
    const m = el.textContent?.match(/([-+]?[0-9]*\.?[0-9]+(?:e[-+]?\d+)?)/i);
    return m ? Number(m[1]) < 1 : false;
  }, { timeout: 15000 });

  const improved = await parseBest(page);
  expect(improved).toBeLessThan(initial || Infinity);
});

test('controls are present and share/export buttons are clickable', async ({ page }) => {
  await page.goto('/examples/viz-benchmarks.html');
  const buttons = ['#share-config', '#export-csv', '#export-json', '#run'];
  for (const selector of buttons) {
    const el = await page.$(selector);
    expect(el, `${selector} missing`).not.toBeNull();
    await el!.click({ timeout: 5000 });
  }
});
