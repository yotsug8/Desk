import { test, expect } from '@playwright/test';
import { createBoard, addNote, notes, waitSaved } from './helpers.js';

test('адрес сайта в заметке становится ссылкой, открывается по нажатию, но не после переноса', async ({ page, context }) => {
  await createBoard(page);
  await addNote(page, 400, 300, 'Смотри https://example.com/путь и www.example.org, а <b>это</b> просто текст');
  const note = notes(page).filter({ hasText: 'Смотри' });
  const links = note.locator('a');
  await expect(links).toHaveCount(2);
  await expect(links.first()).toHaveAttribute('href', 'https://example.com/путь');
  await expect(links.nth(1)).toHaveAttribute('href', 'https://www.example.org');
  await expect(links.first()).toHaveAttribute('target', '_blank');
  // разметка из текста не исполняется
  await expect(note.locator('b')).toHaveCount(0);
  await expect(note).toContainText('<b>это</b>');

  // перенос за ссылку не открывает вкладку
  let opened = 0;
  context.on('page', () => opened++);
  await context.route('https://example.com/**', (r) => r.fulfill({ body: 'ok' }));
  const box = await links.first().boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 40, { steps: 6 });
  await page.mouse.up();
  await waitSaved(page);
  await page.waitForTimeout(500);
  expect(opened).toBe(0);

  // простое нажатие открывает
  const popup = page.waitForEvent('popup');
  await links.first().click();
  expect((await popup).url()).toContain('example.com');
});

test('ссылки в пунктах списка', async ({ page }) => {
  await createBoard(page);
  await page.keyboard.press('k');
  await page.mouse.click(400, 300);
  await page.keyboard.type('билеты на https://rzd.ru');
  await page.mouse.click(1050, 560);
  await waitSaved(page);
  await expect(page.locator('.el.list a[href="https://rzd.ru"]')).toHaveCount(1);
});

test('новичок открывает ссылку в чужой заметке, которую трогать ещё не может', async ({ browser }) => {
  const { joinBoard } = await import('./helpers.js');
  const a = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await addNote(a, 400, 300, 'https://example.com');
  const b = await (await browser.newContext()).newPage();
  await joinBoard(b, url, 'Миша', { trusted: false });
  await b.context().route('https://example.com/**', (r) => r.fulfill({ body: 'ok' }));
  const link = b.locator('.el.note a');
  await expect(link).toHaveCount(1);
  const popup = b.waitForEvent('popup');
  await link.click();
  expect((await popup).url()).toContain('example.com');
});
