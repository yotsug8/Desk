import { test, expect } from '@playwright/test';
import { createBoard, joinBoard, waitSaved } from './helpers.js';

test('фон в клетку виден второму участнику и тому, кто зайдёт позже; мел на листе тёмный', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  const b = await (await browser.newContext()).newPage();
  await joinBoard(b, url, 'Миша');

  await a.click('#btnMenu');
  await a.click('#menu [data-m=background]');
  await a.click('.bgo[data-bg=grid]');
  await a.click('.modal [data-close]');
  await expect(a.locator('#app.bg-grid')).toHaveCount(1);
  // у второго меняется вживую
  await expect(b.locator('#app.bg-grid')).toHaveCount(1);
  // мел по умолчанию на листе тёмный
  expect(await b.evaluate(() => getComputedStyle(document.getElementById('app')).getPropertyValue('--chalk').trim())).toBe('#34414e');

  const c = await (await browser.newContext()).newPage();
  await joinBoard(c, url, 'Вадим');
  await expect(c.locator('#app.bg-grid')).toHaveCount(1);

  // вернуть пробку
  await a.click('#btnMenu');
  await a.click('#menu [data-m=background]');
  await a.click('.bgo[data-bg=cork]');
  await expect(b.locator('#app.bg-grid')).toHaveCount(0);
});

test('ластик: круг виден под стилусом, стирает задетые линии; обратный конец стилуса стирает сам', async ({ page }) => {
  await createBoard(page);
  // линия мелком
  await page.keyboard.press('d');
  await page.mouse.move(400, 300); await page.mouse.down();
  await page.mouse.move(600, 320, { steps: 8 }); await page.mouse.up();
  await waitSaved(page);
  await expect(page.locator('.el.draw')).toHaveCount(1);
  // ластик: круг идёт за указателем
  await page.click('#pens [data-er]');
  await page.mouse.move(700, 500);
  await expect(page.locator('#brush')).toBeVisible();
  await expect(page.locator('#brush.eraser')).toHaveCount(1);
  // проводим рядом с линией, а не точно по ней: стирает весь круг
  await page.mouse.move(500, 300); await page.mouse.down();
  await page.mouse.move(520, 300, { steps: 4 }); await page.mouse.up();
  await waitSaved(page);
  await expect(page.locator('.el.draw')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#brush')).toBeHidden();

  // новая линия, стираем обратным концом стилуса без выбора ластика
  await page.keyboard.press('d');
  await page.click('#pens [data-pc=white]');
  await page.mouse.move(400, 400); await page.mouse.down();
  await page.mouse.move(600, 410, { steps: 8 }); await page.mouse.up();
  await waitSaved(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.el.draw')).toHaveCount(1);
  await page.evaluate(() => {
    const stage = document.getElementById('stage');
    const ev = (type, x, buttons) => new PointerEvent(type, { pointerId: 7, pointerType: 'pen', button: type === 'pointermove' ? -1 : 5, buttons, clientX: x, clientY: 405, bubbles: true, cancelable: true });
    stage.dispatchEvent(ev('pointerdown', 480, 32));
    for (let x = 482; x < 520; x += 4) stage.dispatchEvent(ev('pointermove', x, 32));
    stage.dispatchEvent(ev('pointerup', 520, 0));
  });
  await waitSaved(page);
  await expect(page.locator('.el.draw')).toHaveCount(0);
});
