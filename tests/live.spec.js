import { test, expect } from '@playwright/test';
import { createBoard, joinBoard, addNote, notes, waitSaved } from './helpers.js';

test('два окна: заметки, курсоры, перетаскивание видны вживую', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await joinBoard(b, url, 'Миша');

  // участник появился в списке
  await expect(a.locator('#people .av')).toHaveCount(1);

  await addNote(a, 400, 300, 'Привет от Ани');
  await expect(notes(b)).toHaveCount(1);
  await expect(notes(b).first()).toContainText('Привет от Ани');

  // курсор Миши виден Ане с подписью
  await b.mouse.move(600, 500);
  await b.mouse.move(620, 520);
  await expect(a.locator('.cur b')).toHaveText('Миша');

  // Миша тащит заметку: у Ани видна рамка и заметка едет
  const box = await notes(b).first().boundingBox();
  await b.mouse.move(box.x + 40, box.y + 40);
  await b.mouse.down();
  await b.mouse.move(box.x + 140, box.y + 90, { steps: 6 });
  await expect(notes(a).first().locator('.tag')).toHaveText('Миша двигает');
  await b.mouse.up();
  await waitSaved(b);
  await expect(notes(a).first().locator('.tag')).toHaveCount(0);
  const id = await notes(a).first().getAttribute('data-id');
  await expect.poll(() => a.evaluate((i) => window.__desk.els.get(i).x, id))
    .toBe(await b.evaluate((i) => window.__desk.els.get(i).x, id));

  // удаление у Миши пропадает у Ани
  await b.mouse.click(1100, 700);
  await notes(b).first().click();
  await b.keyboard.press('Delete');
  await expect(notes(a)).toHaveCount(0);
});

test('двое правят текст одной заметки и не затирают друг друга', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await joinBoard(b, url, 'Миша');
  await addNote(a, 400, 300, 'середина');
  await expect(notes(b)).toHaveCount(1);

  // оба открывают правку
  await notes(a).first().dblclick();
  await notes(b).first().dblclick();
  const ta = a.locator('.el.note textarea');
  const tb = b.locator('.el.note textarea');
  await expect(ta).toBeVisible();
  await expect(tb).toBeVisible();
  await expect(notes(a).first().locator('.tag')).toHaveText('Миша пишет');

  // Аня пишет в начало, Миша в конец, одновременно
  await ta.press('Control+Home');
  await tb.press('Control+End');
  await Promise.all([
    a.keyboard.type('НАЧАЛО ', { delay: 30 }),
    b.keyboard.type(' КОНЕЦ', { delay: 30 }),
  ]);

  const want = 'НАЧАЛО середина КОНЕЦ';
  await expect(ta).toHaveValue(want, { timeout: 10_000 });
  await expect(tb).toHaveValue(want, { timeout: 10_000 });
  await a.mouse.click(1100, 700);
  await b.mouse.click(1100, 700);
  await waitSaved(a);
  await waitSaved(b);

  // на сервере то же самое
  await a.reload();
  await expect(notes(a).first().locator('.body')).toHaveText(want);
});
