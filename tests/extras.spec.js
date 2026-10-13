import { test, expect } from '@playwright/test';
import { createBoard, addNote, notes, waitSaved } from './helpers.js';

test('поиск подсвечивает совпадения и переходит между ними', async ({ page }) => {
  await createBoard(page);
  await addNote(page, 300, 300, 'Купить палатку');
  await addNote(page, 700, 350, 'Взять спальник');
  await addNote(page, 500, 550, 'палатка у Миши');

  await page.keyboard.press('Control+f');
  await expect(page.locator('#find')).toBeVisible();
  await page.keyboard.type('палат');
  await expect(page.locator('#find .cnt')).toHaveText('1 из 2');
  await expect(page.locator('.el.found')).toHaveCount(2);
  await expect(page.locator('.el.cur')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('#find .cnt')).toHaveText('2 из 2');

  await page.locator('#find input').fill('чайник');
  await expect(page.locator('#find .cnt')).toHaveText('нет');

  await page.keyboard.press('Escape');
  await expect(page.locator('#find')).toBeHidden();
  await expect(page.locator('.el.found')).toHaveCount(0);
  await expect(page.locator('#world')).not.toHaveClass(/searching/);
});

test('мини-карта видна и по нажатию переносит взгляд', async ({ page }) => {
  await createBoard(page);
  await expect(page.locator('#minimap')).toBeHidden();
  await addNote(page, 400, 300, 'Раз');
  await expect(page.locator('#minimap')).toBeVisible();

  const cam = () => page.evaluate(() => ({ ...window.__desk.cam }));
  const before = await cam();
  const box = await page.locator('#minimap canvas').boundingBox();
  await page.mouse.click(box.x + 6, box.y + 6);
  expect(await cam()).not.toEqual(before);

});

test('доска скачивается текстом и картинкой', async ({ page }) => {
  await createBoard(page, 'Аня', 'Поход');
  await addNote(page, 400, 300, 'Купить палатку');
  await page.keyboard.press('k');
  await page.mouse.click(750, 320);
  await page.keyboard.type('котелок');
  await page.mouse.click(1050, 560);
  await waitSaved(page);

  await page.click('#btnMenu');
  await page.click('#menu [data-m=export]');
  const [md] = await Promise.all([page.waitForEvent('download'), page.click('[data-x=md]')]);
  expect(md.suggestedFilename()).toMatch(/^Поход .*\.md$/);
  const text = await (await md.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
  expect(text).toContain('# Поход');
  expect(text).toContain('> Купить палатку');
  expect(text).toContain('- [ ] котелок');

  await page.click('#btnMenu');
  await page.click('#menu [data-m=export]');
  const [png] = await Promise.all([page.waitForEvent('download'), page.click('[data-x=png]')]);
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  const buf = await (await png.createReadStream()).toArray().then((c) => Buffer.concat(c));
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  expect(buf.length).toBeGreaterThan(5000);
});

test('приложение можно установить: манифест и service worker на месте', async ({ page }) => {
  await page.goto('/');
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href;
    return (await fetch(href)).json();
  });
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i) => i.sizes === '512x512')).toBe(true);
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active)).toBe(true);
});
