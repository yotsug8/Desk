import { test, expect } from '@playwright/test';
import { createBoard, addNote, waitSaved } from './helpers.js';

test('Ctrl+K: команда создаёт заметку, поиск по тексту подводит к ней, Esc закрывает', async ({ page }) => {
  await createBoard(page);
  await addNote(page, 300, 300, 'Купить молоко');
  // уводим доску далеко
  await page.mouse.move(600, 400);
  for (let i = 0; i < 20; i++) await page.mouse.wheel(500, 0);
  await page.waitForTimeout(200);

  await page.keyboard.press('Control+k');
  const input = page.locator('.pinput');
  await expect(input).toBeFocused();
  await page.keyboard.type('молок');
  const hit = page.locator('.pi.hit', { hasText: 'Купить молоко' });
  await expect(hit).toHaveCount(1);
  await page.keyboard.press('ArrowDown'); // команд с таким словом нет, первая строка уже заметка
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.locator('.palette-back')).toHaveCount(0);
  // заметка выделена и в кадре
  const note = page.locator('.el.note.sel', { hasText: 'Купить молоко' });
  await expect(note).toHaveCount(1);
  await expect.poll(async () => {
    const b = await note.boundingBox();
    return b && b.x > 0 && b.x + b.width < 1280 && b.y > 0 && b.y + b.height < 800;
  }).toBe(true);

  // команда «Новая заметка»
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('новая замет');
  await page.keyboard.press('Enter');
  await expect(page.locator('body.editing, .el textarea').first()).toBeVisible();
  await page.keyboard.type('Из меню команд');
  await page.mouse.click(1050, 560);
  await waitSaved(page);
  await expect(page.locator('.el.note', { hasText: 'Из меню команд' })).toHaveCount(1);

  // Esc закрывает
  await page.keyboard.press('Control+k');
  await expect(page.locator('.palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.palette-back')).toHaveCount(0);
});

test('ссылку или текст из браузера можно бросить на доску', async ({ page }) => {
  await createBoard(page);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/uri-list', '# комментарий\nhttps://example.com/статья');
    dt.setData('text/plain', 'https://example.com/статья');
    const stage = document.getElementById('stage');
    for (const type of ['dragover', 'drop']) stage.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: 500, clientY: 350, bubbles: true, cancelable: true }));
  });
  await waitSaved(page);
  await expect(page.locator('.el.note a[href="https://example.com/статья"]')).toHaveCount(1);
});
