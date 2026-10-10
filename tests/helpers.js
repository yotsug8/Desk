// Общие шаги тестов
import { expect } from '@playwright/test';

export async function createBoard(page, name = 'Аня', title = 'Тестовая доска') {
  await page.goto('/');
  await page.fill('#name', name);
  await page.fill('#title', title);
  await page.uncheck('#starter');
  await page.click('.bigbtn');
  await expect(page.locator('#app')).toBeVisible();
  await page.click('[data-close]');
  await waitLive(page);
  return page.url();
}

export async function joinBoard(page, url, name = 'Миша', { trusted = true } = {}) {
  await page.goto(url);
  await page.fill('#name', name);
  await page.click('.bigbtn');
  await expect(page.locator('#app')).toBeVisible();
  await waitLive(page);
  if (trusted) await ageMember(page);
}

// Только для локальной базы: участник как будто пришёл час назад (снимает ограничения новичка)
const LOCAL_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
export async function ageMember(page) {
  const { board, user } = await page.evaluate(() => ({ board: window.__desk.id, user: window.__desk.me.user_id }));
  const res = await fetch(`http://127.0.0.1:54321/rest/v1/members?board_id=eq.${board}&user_id=eq.${user}`, {
    method: 'PATCH',
    headers: { apikey: LOCAL_SERVICE_KEY, authorization: `Bearer ${LOCAL_SERVICE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ joined_at: new Date(Date.now() - 3600e3).toISOString() }),
  });
  if (!res.ok) throw new Error('ageMember: ' + res.status + ' ' + await res.text());
  // клиент узнаёт об этом через живую связь
  await expect.poll(() => page.evaluate(() => new Date(window.__desk.me.joined_at).getTime() < Date.now() - 60e3)).toBe(true);
}

export async function waitLive(page) {
  await expect(page.locator('#status')).toHaveText(/сохранено|только просмотр|новичок/);
}

// Новая заметка в точке экрана с текстом
export async function addNote(page, x, y, text) {
  await page.keyboard.press('n');
  await page.mouse.click(x, y);
  await page.keyboard.type(text);
  await page.mouse.click(1050, 560);
  await waitSaved(page);
}

export async function waitSaved(page) {
  await expect.poll(() => page.evaluate(() => window.__desk.pending)).toBe(0);
}

export const notes = (page) => page.locator('.el.note');
