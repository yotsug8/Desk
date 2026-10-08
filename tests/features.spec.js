import { test, expect } from '@playwright/test';
import { createBoard, joinBoard, addNote, notes, waitSaved } from './helpers.js';

test('нитка между заметками видна второму участнику и тянется за заметкой', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await joinBoard(b, url, 'Миша');
  await addNote(a, 350, 300, 'Раз');
  await addNote(a, 750, 400, 'Два');

  await a.keyboard.press('l');
  await notes(a).nth(0).click();
  await notes(a).nth(1).click();
  await waitSaved(a);
  await expect(a.locator('#strings [data-link]')).toHaveCount(1);
  await expect(b.locator('#strings [data-link]')).toHaveCount(1);

  // Миша тащит заметку: нитка у Ани перерисовывается вслед
  const before = await a.locator('#strings path.s').first().getAttribute('d');
  const box = await notes(b).nth(1).boundingBox();
  await b.mouse.move(box.x + 60, box.y + 60);
  await b.mouse.down();
  await b.mouse.move(box.x + 160, box.y + 160, { steps: 6 });
  await b.mouse.up();
  await waitSaved(b);
  await expect.poll(() => a.locator('#strings path.s').first().getAttribute('d')).not.toBe(before);

  // сервер не даёт привязать нитку к самой себе или к чужой доске
  const res = await a.evaluate(async () => {
    const sb = window.__deskApi.sb;
    const ids = [...window.__desk.els.values()].filter((r) => r.type === 'note').map((r) => r.id);
    const self = await sb.rpc('el_create', { p_board: window.__desk.id, p_type: 'link', p_x: 0, p_y: 0, p_w: 20, p_h: 20, p_data: { from: ids[0], to: ids[0] } });
    const fake = await sb.rpc('el_create', { p_board: window.__desk.id, p_type: 'link', p_x: 0, p_y: 0, p_w: 20, p_h: 20, p_data: { from: ids[0], to: '00000000-0000-4000-8000-000000000000' } });
    return [self.error?.message, fake.error?.message];
  });
  expect(res).toEqual(['bad_link', 'bad_link']);
});

test('голос: один на человека, ставится и снимается, виден всем', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await joinBoard(b, url, 'Миша');
  await addNote(a, 400, 300, 'Палатка');
  await expect(notes(b)).toHaveCount(1);

  // Аня голосует из меню элемента
  await notes(a).first().click({ button: 'right' });
  await a.click('#ctx [data-act=vote]');
  await expect(notes(b).first().locator('.votes b')).toHaveText('1');

  // Миша голосует нажатием на счётчик
  await notes(b).first().locator('.votes').click();
  await expect(notes(a).first().locator('.votes b')).toHaveText('2');

  // повторное нажатие снимает голос
  await notes(b).first().locator('.votes').click();
  await expect(notes(a).first().locator('.votes b')).toHaveText('1');

  // в обход интерфейса больше одного голоса не набрать: функция только переключает
  const n = await a.evaluate(async () => {
    const id = [...window.__desk.els.values()].find((r) => r.type === 'note').id;
    const sb = window.__deskApi.sb;
    await sb.rpc('vote_toggle', { p_element: id });
    return (await sb.rpc('vote_toggle', { p_element: id })).data;
  });
  expect(n).toBe(1);
});

test('«Сюда!» переносит камеру второго участника', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await joinBoard(b, url, 'Миша');

  // Аня уезжает далеко и зовёт через меню доски
  for (let i = 0; i < 4; i++) await a.mouse.wheel(0, 600);
  await a.click('#btnMenu');
  await a.click('#menu [data-m=summon]');
  const target = await a.evaluate(() => ({ x: window.__desk.cam.x, y: window.__desk.cam.y }));
  await expect.poll(() => b.evaluate(() => Math.round(window.__desk.cam.y))).toBe(Math.round(target.y));
  await expect(b.locator('.toast').last()).toContainText('Аня зовёт');
});

test('контекстное меню создаёт заметку', async ({ page }) => {
  await createBoard(page);
  await page.mouse.click(600, 400, { button: 'right' });
  await page.locator('#ctx [data-act=note]').click();
  await page.keyboard.type('Из меню');
  await page.mouse.click(1100, 650);
  await waitSaved(page);
  await expect(notes(page).first()).toContainText('Из меню');
});

test('новая доска с подсказками: заметки и нитки уже приколоты', async ({ page }) => {
  await page.goto('/');
  await page.fill('#name', 'Аня');
  await page.click('.bigbtn');
  await expect(notes(page)).toHaveCount(5);
  await expect(page.locator('.el.text')).toHaveText('Наша доска');
  await expect(page.locator('#strings [data-link]')).toHaveCount(3);
  await waitSaved(page);
  await page.reload();
  await expect(notes(page)).toHaveCount(5);
});

test('снятую заметку можно сразу вернуть', async ({ page }) => {
  await createBoard(page);
  await addNote(page, 500, 350, 'Не теряйся');
  await notes(page).first().click();
  await page.keyboard.press('Delete');
  await expect(notes(page)).toHaveCount(0);
  await page.locator('#undo button').click();
  await expect(notes(page)).toHaveCount(1);
  await waitSaved(page);
  await page.reload();
  await expect(notes(page).first()).toContainText('Не теряйся');
});

test('ярлычок «вернуть» не ложится на полоску мелков', async ({ page }) => {
  await createBoard(page);
  await page.keyboard.press('d');
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 320, { steps: 10 });
  await page.mouse.up();
  await waitSaved(page);
  await page.locator('#pens [data-er]').click();
  await page.mouse.move(500, 250);
  await page.mouse.down();
  await page.mouse.move(500, 380, { steps: 15 });
  await page.mouse.up();
  await expect(page.locator('#undo')).toBeVisible();
  const u = await page.locator('#undo').boundingBox();
  const p = await page.locator('#pens').boundingBox();
  expect(u.y + u.height).toBeLessThanOrEqual(p.y);
});

test('уведомление и ярлычок «вернуть» не перекрываются', async ({ page }) => {
  await createBoard(page);
  await addNote(page, 500, 300, 'Раз');
  await notes(page).first().click();
  await page.keyboard.press('Delete');
  await expect(page.locator('#undo')).toBeVisible();
  await page.mouse.click(900, 400, { button: 'right' });
  await page.click('#ctx [data-act=summon]');
  const t = await page.locator('.toast').last().boundingBox();
  const u = await page.locator('#undo').boundingBox();
  const overlap = !(t.y >= u.y + u.height || u.y >= t.y + t.height);
  expect(overlap).toBe(false);
});
