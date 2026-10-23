import { test, expect } from '@playwright/test';
import { createBoard, joinBoard, addNote, notes, waitSaved } from './helpers.js';

test('что нового: после возвращения видно, кто что добавил и поменял, новое подсвечено', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await addNote(a, 300, 300, 'Старая');
  // первый визит: сводки нет
  await expect(a.locator('#news')).toBeHidden();
  // Аня уходит
  await a.goto('about:blank');

  const b = await (await browser.newContext()).newPage();
  await joinBoard(b, url, 'Миша');
  await addNote(b, 950, 600, 'Новая от Миши');
  await notes(b).filter({ hasText: 'Старая' }).click();
  await b.click('#seltools [data-color=pink]');
  await waitSaved(b);

  // Аня вернулась
  await a.goto(url);
  const news = a.locator('#news');
  await expect(news).toBeVisible();
  await expect(news).toContainText('Миша: добавлено 1, изменено 1');
  await expect(a.locator('.el.note.fresh')).toHaveCount(2);
  await expect(a.locator('.el.note.fresh', { hasText: 'Новая от Миши' })).toHaveCount(1);
  await news.locator('[data-show]').click();
  await news.locator('[data-x]').click();
  await expect(news).toBeHidden();
  await expect(a.locator('.el.fresh')).toHaveCount(0);

  // увиденное второй раз не показывается
  await a.reload();
  await expect(a.locator('#app')).toBeVisible();
  await a.waitForTimeout(1500);
  await expect(news).toBeHidden();
});
