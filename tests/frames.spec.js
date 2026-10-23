import { test, expect } from '@playwright/test';
import { createBoard, joinBoard, addNote, notes, waitSaved } from './helpers.js';

test('область: подпись, лежит под заметками и тащит их за собой', async ({ page }) => {
  await createBoard(page);
  await page.keyboard.press('f');
  await page.mouse.click(640, 420);
  await page.keyboard.type('Идеи');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  const frame = page.locator('.el.frame');
  await expect(frame).toHaveCount(1);
  await expect(frame.locator('.ftitle')).toHaveText('Идеи');

  // заметка внутри области, а нажатие в пустую середину области её не хватает
  await addNote(page, 600, 420, 'Внутри');
  const z = await page.evaluate(() => [...document.querySelectorAll('.el')].map((n) => [n.className.split(' ')[1], Number(n.style.zIndex)]));
  expect(z.find(([t]) => t === 'frame')[1]).toBeLessThan(z.find(([t]) => t === 'note')[1]);

  const pos = () => page.evaluate(() => Object.fromEntries([...window.__desk.els.values()].map((r) => [r.type, [r.x, r.y]])));
  const before = await pos();
  const title = await frame.locator('.ftitle').boundingBox();
  await page.mouse.move(title.x + 20, title.y + 10);
  await page.mouse.down();
  await page.mouse.move(title.x + 120, title.y + 70, { steps: 6 });
  await page.mouse.up();
  await waitSaved(page);
  const after = await pos();
  expect(after.frame[0] - before.frame[0]).toBe(100);
  expect(after.note[0] - before.note[0]).toBe(100);
  expect(after.note[1] - before.note[1]).toBe(60);

  await page.reload();
  await expect(page.locator('.el.frame .ftitle')).toHaveText('Идеи');
  expect((await pos()).note).toEqual(after.note);
});

test('общий таймер виден второму участнику и тому, кто зашёл позже', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await joinBoard(b, url, 'Миша');

  await a.click('#btnMenu');
  await a.click('#menu [data-m=timer]');
  await a.click('[data-m="5"]');
  await expect(a.locator('#timer')).toBeVisible();
  await expect(a.locator('#timer b')).toHaveText(/0[45]:\d\d/);
  await expect(b.locator('#timer b')).toHaveText(/0[45]:\d\d/);

  const c = await (await browser.newContext()).newPage();
  await joinBoard(c, url, 'Оля', { trusted: false });
  await expect(c.locator('#timer b')).toHaveText(/0[45]:\d\d/);

  await b.click('#timer [data-stop]');
  await expect(a.locator('#timer')).toBeHidden();
  await expect(c.locator('#timer')).toBeHidden();
});
