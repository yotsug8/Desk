import { test, expect } from '@playwright/test';
import { createBoard, joinBoard, addNote, notes, waitSaved, ageMember } from './helpers.js';

const firstNoteId = (page) => page.evaluate(() => [...window.__desk.els.values()].find((r) => r.type === 'note' && !r.deleted_at).id);

test('новичок первые минуты только добавляет своё', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await addNote(a, 400, 300, 'Анина');
  await joinBoard(b, url, 'Новичок', { trusted: false });
  await expect(b.locator('#status')).toContainText('новичок');

  // через интерфейс
  await notes(b).first().click();
  await b.keyboard.press('Delete');
  await expect(b.locator('.toast').last()).toContainText('Новичкам');
  await expect(notes(a)).toHaveCount(1);

  // в обход интерфейса
  const id = await firstNoteId(b);
  const errs = await b.evaluate(async (id) => {
    const sb = window.__deskApi.sb;
    return [
      (await sb.rpc('el_delete', { p_ids: [id] })).error?.message,
      (await sb.rpc('el_move', { p_moves: [{ id, x: 0, y: 0 }] })).error?.message,
      (await sb.rpc('el_update', { p_id: id, p_base_version: 1, p_patch: { data: { text: 'x' } } })).error?.message,
      (await sb.rpc('rollback_to', { p_board: window.__desk.id, p_history_id: 1 })).error?.message,
    ];
  }, id);
  expect(errs).toEqual(['too_new', 'too_new', 'too_new', 'too_new']);

  // своё добавлять можно
  await addNote(b, 800, 400, 'Моя');
  await expect(notes(a)).toHaveCount(2);
});

test('закреплённое меняют только автор и владелец', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await addNote(a, 400, 300, 'Важное');
  await joinBoard(b, url, 'Миша');

  await notes(a).first().click({ button: 'right' });
  await a.click('#ctx [data-act=lock]');
  await expect(notes(b).first().locator('.lockmark')).toHaveCount(1);

  const id = await firstNoteId(b);
  const err = await b.evaluate(async (id) => (await window.__deskApi.sb.rpc('el_delete', { p_ids: [id] })).error?.message, id);
  expect(err).toBe('locked');
  // закрепить чужое нельзя
  const err2 = await b.evaluate(async (id) => (await window.__deskApi.sb.rpc('el_lock', { p_id: id, p_locked: false })).error?.message, id);
  expect(err2).toBe('no_access');
});

test('больше 10 чужих элементов: через одобрение, запрос видят все', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await a.evaluate(async () => {
    for (let i = 0; i < 12; i++) {
      await window.__deskApi.sb.rpc('el_create', { p_board: window.__desk.id, p_type: 'note', p_x: (i % 6) * 220 - 600, p_y: Math.floor(i / 6) * 200, p_w: 200, p_h: 170, p_data: { text: 'n' + i } });
    }
  });
  await joinBoard(b, url, 'Миша');
  await expect(notes(b)).toHaveCount(12);

  await b.mouse.click(640, 700);
  await b.keyboard.press('Control+a');
  await b.keyboard.press('Delete');
  await b.click('.modal [data-send]');
  await expect(notes(b)).toHaveCount(12);

  // запрос виден Ане, она разрешает
  await expect(a.locator('.req')).toContainText('Миша хочет удалить 12');
  await a.click('.req [data-ra=yes]');
  await expect(notes(a)).toHaveCount(0);
  await expect(notes(b)).toHaveCount(0);
  await expect.poll(() => b.evaluate(() => [...window.__desk.requests.values()].map((r) => r.id + ':' + r.status).join())).toBe('');
  await expect(b.locator('.req')).toHaveCount(0);
});

test('корзина возвращает снятое', async ({ page }) => {
  await createBoard(page);
  await addNote(page, 400, 300, 'В корзину');
  await notes(page).first().click();
  await page.keyboard.press('Delete');
  await expect(notes(page)).toHaveCount(0);
  await page.click('#btnMenu');
  await page.click('#menu [data-m=trash]');
  await expect(page.locator('.trash .tr')).toContainText('В корзину');
  await page.click('.trash [data-back]');
  await expect(notes(page)).toHaveCount(1);
});

test('владелец: только просмотр для новых, выгнать, откатить действия человека', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await addNote(a, 400, 300, 'Анина');
  await joinBoard(b, url, 'Миша');

  // Миша пишет своё и правит Анино
  await addNote(b, 800, 300, 'Мишина');
  await notes(b).filter({ hasText: 'Анина' }).dblclick();
  await b.keyboard.press('End');
  await b.keyboard.type(' испорчено');
  await b.mouse.click(1100, 650);
  await waitSaved(b);
  await expect(notes(a).filter({ hasText: 'испорчено' })).toHaveCount(1);

  // Аня откатывает всё, что сделал Миша
  await a.click('#btnMenu');
  await a.click('#menu [data-m=people]');
  a.once('dialog', (d) => d.accept());
  await a.locator('.mr', { hasText: 'Миша' }).locator('[data-a=undo]').click();
  await expect(notes(a)).toHaveCount(1);
  await expect(notes(a).first().locator('.body')).toHaveText('Анина');

  // новые гости только смотрят
  await a.click('.switch [data-ro]');
  const c = await (await browser.newContext()).newPage();
  await joinBoard(c, url, 'Гость', { trusted: false });
  await expect(c.locator('#status')).toHaveText('только просмотр');
  await expect(c.locator('#ledge')).toBeHidden();

  // выгнать Мишу: его выкидывает с доски
  await a.locator('.mr', { hasText: 'Миша' }).locator('[data-a=ban]').click();
  await expect(b.locator('#gate')).toContainText('закрыл вам доступ');
});
