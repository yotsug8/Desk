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

test('голосование: у каждого три кнопки, итоги видят все', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await joinBoard(b, url, 'Миша');
  await addNote(a, 350, 300, 'Палатка');
  await addNote(a, 750, 300, 'Шатёр');

  await a.click('[data-act=vote]');
  await a.click('[data-m="1"]');
  await expect(b.locator('#voteBar')).toContainText('Голосование');

  // Аня втыкает три кнопки, четвёртая не проходит
  for (let i = 0; i < 3; i++) await notes(a).nth(0).click();
  await expect(notes(a).nth(0).locator('.votes b')).toHaveText('3');
  await notes(a).nth(1).click();
  await expect(a.locator('.toast').last()).toContainText('закончились');
  await expect(notes(b).nth(0).locator('.votes b')).toHaveText('3');

  // и в обход интерфейса тоже
  const err = await a.evaluate(async () => {
    const id = [...window.__desk.els.values()].find((r) => r.type === 'note').id;
    return (await window.__deskApi.sb.rpc('vote', { p_element: id, p_delta: 1 })).error?.message;
  });
  expect(err).toBe('no_votes_left');

  // Миша голосует за вторую
  await b.click('#voteBar [data-v=tool]');
  await notes(b).nth(1).click();
  await expect(notes(a).nth(1).locator('.votes b')).toHaveText('1');

  // Аня заканчивает: остаются итоги
  await a.click('#voteBar [data-v=stop]');
  await expect(b.locator('#voteBar')).toContainText('Итоги');
});

test('«Сюда!» переносит камеру второго участника', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await joinBoard(b, url, 'Миша');

  // Аня уезжает далеко и зовёт
  for (let i = 0; i < 4; i++) await a.mouse.wheel(0, 600);
  await a.click('[data-act=summon]');
  const target = await a.evaluate(() => ({ x: window.__desk.cam.x, y: window.__desk.cam.y }));
  await expect.poll(() => b.evaluate(() => Math.round(window.__desk.cam.y))).toBe(Math.round(target.y));
  await expect(b.locator('.toast').last()).toContainText('Аня зовёт');
});

test('круговое меню создаёт заметку', async ({ page }) => {
  await createBoard(page);
  await page.mouse.click(600, 400, { button: 'right' });
  await page.locator('#radial [data-act=note]').click();
  await page.keyboard.type('Из меню');
  await page.mouse.click(1100, 650);
  await waitSaved(page);
  await expect(notes(page).first()).toContainText('Из меню');
});
