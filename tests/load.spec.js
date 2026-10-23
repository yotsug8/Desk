import { test, expect } from '@playwright/test';

test('сбой загрузки скрипта: страница сама пробует ещё раз', async ({ page }) => {
  let n = 0;
  await page.route('**/js/icons.js', (r) => (n++ === 0 ? r.fulfill({ status: 502, body: '' }) : r.continue()));
  await page.goto('/');
  await expect(page.locator('#name')).toBeVisible({ timeout: 15000 });
});

test('скрипт не грузится совсем: кнопка «Обновить» вместо вечной крутилки', async ({ page }) => {
  await page.route('**/js/icons.js', (r) => r.fulfill({ status: 502, body: '' }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Обновить' })).toBeVisible({ timeout: 15000 });
});
