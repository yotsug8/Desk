// Общие шаги тестов
import { expect } from '@playwright/test';

export async function createBoard(page, name = 'Аня', title = 'Тестовая доска') {
  await page.goto('/');
  await page.fill('#name', name);
  await page.fill('#title', title);
  await page.click('.bigbtn');
  await expect(page.locator('#app')).toBeVisible();
  await page.click('[data-close]');
  await waitLive(page);
  return page.url();
}

export async function joinBoard(page, url, name = 'Миша') {
  await page.goto(url);
  await page.fill('#name', name);
  await page.click('.bigbtn');
  await expect(page.locator('#app')).toBeVisible();
  await waitLive(page);
}

export async function waitLive(page) {
  await expect(page.locator('#status')).toHaveText(/сохранено|только просмотр/);
}

// Новая заметка в точке экрана с текстом
export async function addNote(page, x, y, text) {
  await page.keyboard.press('n');
  await page.mouse.click(x, y);
  await page.keyboard.type(text);
  await page.mouse.click(1100, 700);
  await waitSaved(page);
}

export async function waitSaved(page) {
  await expect.poll(() => page.evaluate(() => window.__desk.pending)).toBe(0);
}

export const notes = (page) => page.locator('.el.note');
