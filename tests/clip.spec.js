import { test, expect } from '@playwright/test';
import { createBoard, addNote, notes, waitSaved } from './helpers.js';

// Вставка текста как будто из другого приложения
const pasteText = (page, text) => page.evaluate((t) => {
  const dt = new DataTransfer();
  dt.setData('text/plain', t);
  dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
}, text);

test('копирование, вставка и дублирование вместе с ниткой', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await createBoard(page);
  await addNote(page, 350, 300, 'Раз');
  await addNote(page, 650, 320, 'Два');
  await page.keyboard.press('l');
  await notes(page).nth(0).click();
  await notes(page).nth(1).click();
  await waitSaved(page);
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.mouse.move(500, 600);
  await page.keyboard.press('Control+v');
  await expect(notes(page)).toHaveCount(4);
  await expect(page.locator('#strings [data-link]')).toHaveCount(2);
  await waitSaved(page);

  // дублирование одной заметки
  await notes(page).first().click();
  await page.keyboard.press('Control+d');
  await expect(notes(page)).toHaveCount(5);
  await waitSaved(page);
  await page.reload();
  await expect(notes(page)).toHaveCount(5);
  await expect(page.locator('#strings [data-link]')).toHaveCount(2);
});

test('текст из буфера становится заметкой, пункты становятся списком', async ({ page }) => {
  await createBoard(page);
  await pasteText(page, 'Позвонить в гостиницу');
  await expect(notes(page)).toHaveCount(1);
  await expect(notes(page).first()).toContainText('Позвонить в гостиницу');

  await pasteText(page, '- палатка\n- котелок\n- фонарик');
  await expect(page.locator('.el.list')).toHaveCount(1);
  await waitSaved(page);
  const data = await page.evaluate(() => [...window.__desk.els.values()].find((r) => r.type === 'list').data.text);
  expect(data).toBe('[ ] палатка\n[ ] котелок\n[ ] фонарик');
});

test('стрелки сдвигают выделенное и это сохраняется', async ({ page }) => {
  await createBoard(page);
  await addNote(page, 400, 300, 'Двигай');
  await notes(page).first().click();
  const x0 = await page.evaluate(() => [...window.__desk.els.values()][0].x);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__desk.pending)).toBe(0);
  await page.waitForTimeout(500);
  await waitSaved(page);
  await page.reload();
  await expect(notes(page)).toHaveCount(1);
  expect(await page.evaluate(() => [...window.__desk.els.values()][0].x)).toBe(x0 + 60);
});

test('доска из заготовки «Задачи»', async ({ page }) => {
  await page.goto('/');
  await page.fill('#name', 'Аня');
  await page.click('.tpl:has([value=kanban])');
  await page.click('.bigbtn');
  await expect(page.locator('.el.text')).toHaveCount(3);
  await expect(page.locator('.el.text', { hasText: 'В работе' })).toHaveCount(1);
  await expect(notes(page)).toHaveCount(4);
});
