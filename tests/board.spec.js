import { test, expect } from '@playwright/test';
import { createBoard, addNote, notes, waitSaved, waitLive } from './helpers.js';

test('создать доску, заметку и надпись; после перезагрузки всё на месте', async ({ page }) => {
  await createBoard(page);
  await addNote(page, 400, 300, 'Купить хлеб');
  await page.keyboard.press('t');
  await page.mouse.click(300, 150);
  await page.keyboard.type('Заголовок');
  await page.mouse.click(1100, 700);
  await waitSaved(page);

  await page.reload();
  await waitLive(page);
  await expect(notes(page)).toHaveCount(1);
  await expect(notes(page).first()).toContainText('Купить хлеб');
  await expect(page.locator('.el.text')).toContainText('Заголовок');
});

test('перетаскивание сохраняется', async ({ page }) => {
  await createBoard(page);
  await addNote(page, 400, 300, 'Двигай меня');
  const id = await notes(page).first().getAttribute('data-id');
  const start = await page.evaluate((i) => ({ ...window.__desk.els.get(i) }), id);
  const box = await notes(page).first().boundingBox();
  await page.mouse.move(box.x + 50, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 150, { steps: 8 });
  await page.mouse.up();
  await waitSaved(page);
  await page.reload();
  await waitLive(page);
  const end = await page.evaluate((i) => window.__desk.els.get(i), id);
  expect(end.x - start.x).toBe(200);
  expect(end.y - start.y).toBe(100);
});

test('удаление клавишей и цвет заметки', async ({ page }) => {
  await createBoard(page);
  await addNote(page, 400, 300, 'Раз');
  await addNote(page, 700, 300, 'Два');
  await notes(page).filter({ hasText: 'Раз' }).click();
  await page.locator('.sw[data-color="pink"]').click();
  await expect(notes(page).filter({ hasText: 'Раз' })).toHaveClass(/c-pink/);
  await page.keyboard.press('Delete');
  await expect(notes(page)).toHaveCount(1);
  await waitSaved(page);
  await page.reload();
  await waitLive(page);
  await expect(notes(page)).toHaveCount(1);
  await expect(notes(page).first()).toContainText('Два');
});
