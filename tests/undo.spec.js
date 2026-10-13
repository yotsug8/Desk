import { test, expect } from '@playwright/test';
import { createBoard, addNote, notes, waitSaved } from './helpers.js';

const rows = (page) => page.evaluate(() => [...window.__desk.els.values()].filter((r) => !r.deleted_at).map((r) => ({ x: r.x, y: r.y, text: r.data.text, color: r.data.color })));

test('Ctrl+Z отменяет создание, перенос, цвет, текст и удаление; Ctrl+Shift+Z повторяет', async ({ page }) => {
  await createBoard(page);
  await addNote(page, 400, 300, 'Раз');
  await notes(page).first().click();
  const box = await notes(page).first().boundingBox();

  // перенос
  await page.mouse.move(box.x + 50, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 150, { steps: 5 });
  await page.mouse.up();
  await waitSaved(page);
  const moved = (await rows(page))[0];
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await rows(page))[0].x).toBe(moved.x - 200);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await rows(page))[0].x).toBe(moved.x);

  // цвет (Escape: повторный клик по выделенной заметке открыл бы правку)
  await page.keyboard.press('Escape');
  await notes(page).first().click();
  await page.click('#seltools [data-color=pink]');
  await waitSaved(page);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await rows(page))[0].color).toBe('yellow');

  // текст
  await page.keyboard.press('Escape');
  await notes(page).first().click();
  await page.keyboard.press('Enter');
  await page.keyboard.type(' два');
  await page.mouse.click(1050, 560);
  await waitSaved(page);
  await expect(notes(page).first()).toContainText('Раз два');
  await page.keyboard.press('Control+z');
  await expect(notes(page).first()).toHaveText('Раз');

  // удаление и возврат (пауза: два касания подряд открыли бы правку)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  await notes(page).first().click();
  await page.keyboard.press('Delete');
  await expect(notes(page)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(notes(page)).toHaveCount(1);

  // всё отменяется до создания, и это видно после перезагрузки
  for (let i = 0; i < 6; i++) await page.keyboard.press('Control+z');
  await expect(notes(page)).toHaveCount(0);
  await waitSaved(page);
  await page.reload();
  await expect(page.locator('#hint')).toBeVisible();
  await expect(notes(page)).toHaveCount(0);
});

test('выделение рамкой через Shift', async ({ page }) => {
  await createBoard(page);
  await addNote(page, 300, 300, 'А');
  await addNote(page, 600, 320, 'Б');
  await addNote(page, 950, 300, 'В');
  await page.keyboard.press('Escape');
  await page.keyboard.down('Shift');
  await page.mouse.move(150, 150);
  await page.mouse.down();
  await page.mouse.move(760, 500, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect(await page.evaluate(() => window.__desk.sel.size)).toBe(2);
  await page.keyboard.press('Delete');
  await expect(notes(page)).toHaveCount(1);
});
