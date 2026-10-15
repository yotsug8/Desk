import { test, expect } from '@playwright/test';
import { createBoard, addNote, notes, waitSaved } from './helpers.js';

const rowOf = (page, text) => page.evaluate((t) => { const r = [...window.__desk.els.values()].find((e) => e.data.text === t && !e.deleted_at); return { x: r.x, y: r.y }; }, text);

test('перенос: заметка прилипает к краю соседки и показывает направляющую, с Alt нет', async ({ page }) => {
  await createBoard(page);
  await addNote(page, 300, 250, 'Раз');
  await addNote(page, 700, 520, 'Два');
  const a = await rowOf(page, 'Раз');
  const b0 = await rowOf(page, 'Два');
  const s = await page.evaluate(() => window.__desk.cam.s);
  // тянем «Два» так, чтобы левый край оказался в 3 точках от левого края «Раз»
  const box = await notes(page).filter({ hasText: 'Два' }).boundingBox();
  const sx = box.x + 60, sy = box.y + 60;
  const tx = sx + (a.x - b0.x) * s + 3;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move((sx + tx) / 2, sy, { steps: 4 });
  await page.mouse.move(tx, sy, { steps: 4 });
  await expect(page.locator('#guides line')).toHaveCount(1);
  await page.mouse.up();
  await waitSaved(page);
  expect((await rowOf(page, 'Два')).x).toBe(a.x);
  await expect(page.locator('#guides line')).toHaveCount(0);

  // с Alt: ставим ровно туда, куда тянули
  const box2 = await notes(page).filter({ hasText: 'Два' }).boundingBox();
  const b1 = await rowOf(page, 'Два');
  await page.keyboard.down('Alt');
  await page.mouse.move(box2.x + 60, box2.y + 60);
  await page.mouse.down();
  await page.mouse.move(box2.x + 60 + 20 * s, box2.y + 60, { steps: 3 });
  await page.mouse.move(box2.x + 60 + (a.x - b1.x + 40 + 3) * s, box2.y + 60, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await waitSaved(page);
  // в 3 точках от края «Раз»+40: без Alt прилипло бы, с Alt стоит где отпустили
  expect((await rowOf(page, 'Два')).x).toBe(a.x + 43);
  await expect(page.locator('#guides line')).toHaveCount(0);
});
