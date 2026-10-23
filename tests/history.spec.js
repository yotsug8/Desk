import { test, expect } from '@playwright/test';
import { createBoard, joinBoard, addNote, notes, waitSaved } from './helpers.js';

test('история: просмотр прошлого, откат и откат отката', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await joinBoard(b, url, 'Миша');

  await addNote(a, 300, 300, 'Первая');
  await addNote(a, 600, 300, 'Вторая');
  await expect(notes(b)).toHaveCount(2);

  // Миша портит доску: удаляет обе заметки
  await notes(b).first().click();
  await notes(b).nth(1).click({ modifiers: ['Shift'] });
  await b.keyboard.press('Delete');
  await waitSaved(b);
  await expect(notes(a)).toHaveCount(0);

  // Аня открывает историю и смотрит момент до удаления
  await a.click('#btnHistory');
  const evs = a.locator('.ev');
  await expect(evs.first()).toContainText('Снято с доски: 2');
  await expect(evs.first()).toContainText('Миша');
  await evs.nth(1).click();
  await expect(a.locator('#pastBar')).toBeVisible();
  await expect(notes(a)).toHaveCount(2);
  // у Миши в это время ничего не поменялось
  await expect(notes(b)).toHaveCount(0);

  await a.click('[data-go]');
  await expect(a.locator('#pastBar')).toBeHidden();
  await expect(notes(a)).toHaveCount(2);
  await expect(notes(b)).toHaveCount(2);
  await expect(evs.first()).toContainText('Откат доски, изменений: 2');

  // откат тоже можно откатить
  await evs.nth(1).click();
  await expect(notes(a)).toHaveCount(0);
  await a.click('[data-go]');
  await expect(notes(b)).toHaveCount(0);
  await waitSaved(a);
});
