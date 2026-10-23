import { test, expect } from '@playwright/test';
import { createBoard, addNote, joinBoard, waitLive } from './helpers.js';

async function makeCode(page) {
  await page.click('#btnMenu');
  await page.click('#menu [data-m=transfer]');
  const code = page.locator('.tcode');
  await expect(code).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  return { code: await code.textContent(), link: await page.locator('.modal input').inputValue() };
}

test('перенос по коду: доски, имя и права владельца на другом компьютере', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня', 'Моя доска');
  await addNote(a, 400, 300, 'Привет');
  const { code } = await makeCode(a);

  const b = await (await browser.newContext()).newPage();
  await b.goto('/');
  // неверный код
  await b.click('[data-tin]');
  await b.fill('.tinput', 'ZZZZ-ZZZZ');
  await b.click('.modal form button');
  await expect(b.locator('.modal .err')).toHaveText('Код неверный или устарел');
  // верный
  await b.fill('.tinput', code.toLowerCase());
  await b.click('.modal form button');
  await expect(b.locator('.recent a', { hasText: 'Моя доска' })).toHaveCount(1);
  await expect(b.locator('#name')).toHaveValue('Аня');
  await b.click('.recent a');
  // без вопроса об имени и сразу владелец
  await expect(b.locator('#app')).toBeVisible();
  await waitLive(b);
  await expect(b.locator('.el.note', { hasText: 'Привет' })).toHaveCount(1);
  await expect.poll(() => b.evaluate(() => window.__desk.me.role)).toBe('owner');
  expect(b.url().split('?')[1]).toBe(url.split('?')[1]);

  // код одноразовый
  const c = await (await browser.newContext()).newPage();
  await c.goto('/');
  await c.click('[data-tin]');
  await c.fill('.tinput', code);
  await c.click('.modal form button');
  await expect(c.locator('.modal .err')).toHaveText('Код неверный или устарел');
});

test('перенос по ссылке; новичок и запрет переносом не снимаются', async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  const url = await createBoard(owner, 'Хозяин', 'Чужая доска');
  const a = await (await browser.newContext()).newPage();
  await joinBoard(a, url, 'Аня', { trusted: false }); // новичок
  const { link } = await makeCode(a);

  const b = await (await browser.newContext()).newPage();
  await b.goto(link);
  await expect(b.locator('.recent a', { hasText: 'Чужая доска' })).toHaveCount(1);
  await b.click('.recent a');
  await expect(b.locator('#app')).toBeVisible();
  await waitLive(b);
  // по-прежнему новичок: время входа то же, что у Ани
  await expect(b.locator('#status')).toHaveText(/новичок/);
  expect(await b.evaluate(() => window.__desk.me.role)).toBe('editor');
});
