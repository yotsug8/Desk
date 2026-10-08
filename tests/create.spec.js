import { test, expect } from '@playwright/test';
import { createBoard, joinBoard, waitSaved } from './helpers.js';

// Маленькая картинка 40x30 в PNG
const PNG = Buffer.from('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', 'base64');

test('мелок рисует, второй видит, ластик стирает', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await joinBoard(b, url, 'Миша');

  await a.keyboard.press('d');
  await expect(a.locator('#pens')).toBeVisible();
  await a.mouse.move(400, 300);
  await a.mouse.down();
  for (let i = 0; i <= 20; i++) await a.mouse.move(400 + i * 15, 300 + Math.sin(i / 3) * 40);
  await a.mouse.up();
  await waitSaved(a);
  await expect(a.locator('.el.draw')).toHaveCount(1);
  await expect(b.locator('.el.draw')).toHaveCount(1);

  // ластиком проводим поперёк линии
  await a.locator('#pens [data-er]').click();
  await a.mouse.move(550, 200);
  await a.mouse.down();
  await a.mouse.move(550, 450, { steps: 25 });
  await a.mouse.up();
  await expect(a.locator('.el.draw')).toHaveCount(0);
  await expect(b.locator('.el.draw')).toHaveCount(0);
});

test('список с галочками: пункты, отметка видна второму', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await joinBoard(b, url, 'Миша');

  await a.keyboard.press('k');
  await a.mouse.click(500, 300);
  await a.keyboard.type('хлеб');
  await a.keyboard.press('Enter');
  await a.keyboard.type('молоко');
  await a.mouse.click(1100, 650);
  await waitSaved(a);
  await expect(a.locator('.el.list .li')).toHaveCount(2);
  await expect(b.locator('.el.list .li')).toHaveCount(2);

  await a.locator('.el.list .li').nth(1).locator('.box').click();
  await waitSaved(a);
  await expect(b.locator('.el.list .li').nth(1)).toHaveClass(/done/);
  await expect(b.locator('.el.list .li').nth(0)).not.toHaveClass(/done/);
});

test('фото загружается в хранилище и видно второму', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await joinBoard(b, url, 'Миша');

  const chooser = a.waitForEvent('filechooser');
  await a.keyboard.press('p');
  await (await chooser).setFiles({ name: 'p.png', mimeType: 'image/png', buffer: PNG });
  await expect(a.locator('.el.image')).toHaveCount(1);
  await expect(b.locator('.el.image')).toHaveCount(1);
  await expect.poll(() => b.locator('.el.image img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
});

test('хранилище и фото защищены', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  const board = new URL(url).searchParams.get('b');

  // свой участник: путь только в папку своей доски
  const own = await a.evaluate(async (board) => {
    const sb = window.__deskApi.sb;
    const blob = new Blob(['x'], { type: 'image/png' });
    const bad = await sb.storage.from('images').upload(`zzzzzzzz/${crypto.randomUUID()}.png`, blob, { contentType: 'image/png' });
    const fake = await sb.rpc('el_create', { p_board: board, p_type: 'image', p_x: 0, p_y: 0, p_w: 100, p_h: 100, p_data: { src: `otherbrd/${crypto.randomUUID()}.jpg` } });
    return [!!bad.error, fake.error?.message];
  }, board);
  expect(own).toEqual([true, 'bad_image']);

  // посторонний не может положить файл в папку чужой доски
  const x = await (await browser.newContext()).newPage();
  await x.goto('/');
  const outsider = await x.evaluate(async (board) => {
    const sb = window.__deskApi.sb;
    await sb.auth.signInAnonymously();
    const blob = new Blob(['x'], { type: 'image/png' });
    return !!(await sb.storage.from('images').upload(`${board}/${crypto.randomUUID()}.png`, blob, { contentType: 'image/png' })).error;
  }, board);
  expect(outsider).toBe(true);
});
