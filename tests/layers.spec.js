import { test, expect } from '@playwright/test';
import { createBoard, addNote, notes, waitSaved } from './helpers.js';

const zOf = (page, text) => page.evaluate((t) => Number([...document.querySelectorAll('.el.note')].find((n) => n.textContent.includes(t)).style.zIndex), text);

test('выбранное поверх, перенесённое остаётся сверху и после перезагрузки', async ({ page }) => {
  await createBoard(page);
  await addNote(page, 400, 300, 'Нижняя');
  await addNote(page, 560, 360, 'Верхняя');
  expect(await zOf(page, 'Верхняя')).toBeGreaterThan(await zOf(page, 'Нижняя'));

  // выделение поднимает наверх
  await page.mouse.click(330, 240);
  await expect.poll(async () => (await zOf(page, 'Нижняя')) > (await zOf(page, 'Верхняя'))).toBe(true);

  // перенос закрепляет порядок для всех
  await page.mouse.move(330, 240);
  await page.mouse.down();
  await page.mouse.move(300, 220, { steps: 4 });
  await page.mouse.up();
  await waitSaved(page);
  await page.keyboard.press('Escape');
  expect(await zOf(page, 'Нижняя')).toBeGreaterThan(await zOf(page, 'Верхняя'));
  await page.reload();
  await expect(notes(page)).toHaveCount(2);
  expect(await zOf(page, 'Нижняя')).toBeGreaterThan(await zOf(page, 'Верхняя'));
});
