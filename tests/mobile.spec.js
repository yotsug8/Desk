import { test, expect } from '@playwright/test';
test('масштаб не меняется при добавлении и при открытой клавиатуре', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.fill('#name', 'Аня');
  await page.click('.tpl:has([value=trip])');
  await page.click('.bigbtn');
  await expect(page.locator('.el.list')).toHaveCount(2, { timeout: 15000 });
  await page.waitForTimeout(800);
  const close = page.locator('[data-close]'); if (await close.count()) await close.first().click();
  const pct = () => page.locator('.zoom .pct').textContent();
  const s0 = await pct();
  await page.locator('.tool[data-tool=note]').click();
  await page.mouse.click(195, 600);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => !!document.activeElement?.closest('.el'))).toBe(true);
  expect(await pct()).toBe(s0);
  // щипок двумя пальцами во время набора
  const cdp = await ctx.newCDPSession(page);
  const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  await tp('touchStart', [[150, 400], [250, 400]]);
  for (let i = 1; i <= 5; i++) await tp('touchMove', [[150 - i * 15, 400], [250 + i * 15, 400]]);
  await tp('touchEnd', []);
  await page.waitForTimeout(300);
  expect(await pct()).toBe(s0);
  await ctx.close();
});
test('касание пустой доски пальцем закрывает правку', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.fill('#name', 'Аня');
  await page.click('.tpl:has([value=trip])');
  await page.click('.bigbtn');
  await expect(page.locator('.el.list')).toHaveCount(2, { timeout: 15000 });
  await page.waitForTimeout(800);
  const close = page.locator('[data-close]'); if (await close.count()) await close.first().click();
  await page.locator('.tool[data-tool=note]').click();
  await page.mouse.click(195, 500);
  await page.waitForTimeout(500);
  await expect(page.locator('body.editing')).toHaveCount(1);
  await page.touchscreen.tap(60, 700);
  await expect(page.locator('body.editing')).toHaveCount(0);
  await ctx.close();
});
test('при открытой клавиатуре палец двигает доску, правка не закрывается', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.fill('#name', 'Аня');
  await page.click('.tpl:has([value=trip])');
  await page.click('.bigbtn');
  await expect(page.locator('.el.list')).toHaveCount(2, { timeout: 15000 });
  await page.waitForTimeout(800);
  const close = page.locator('[data-close]'); if (await close.count()) await close.first().click();
  await page.locator('.tool[data-tool=note]').click();
  await page.mouse.click(195, 500);
  await page.waitForTimeout(500);
  const ed = page.locator('.el:has(textarea)');
  const before = await page.evaluate(() => document.querySelector('.el.list').getBoundingClientRect().top);
  const listBox0 = await page.evaluate(() => { const r = document.querySelector('.el.list'); return [r.style.left, r.style.top]; });
  // тянем пальцем по списку: доска сдвигается, список не перетаскивается
  const cdp = await ctx.newCDPSession(page);
  const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  // точка на списке, не закрытая панелью выделения
  const [x, y] = await page.evaluate(() => {
    for (const el of document.querySelectorAll('.el.list')) {
      const r = el.getBoundingClientRect();
      for (let k = 0.2; k < 0.9; k += 0.1) {
        const px = r.left + r.width / 2, py = r.top + r.height * k;
        if (el.contains(document.elementFromPoint(px, py))) return [px, py];
      }
    }
  });
  await tp('touchStart', [[x, y]]);
  for (let i = 1; i <= 6; i++) await tp('touchMove', [[x, y + i * 15]]);
  await tp('touchEnd', []);
  await page.waitForTimeout(300);
  await expect(page.locator('body.editing')).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA');
  const after = await page.evaluate(() => document.querySelector('.el.list').getBoundingClientRect().top);
  expect(after - before).toBeGreaterThan(50);
  expect(await page.evaluate(() => { const r = document.querySelector('.el.list'); return [r.style.left, r.style.top]; })).toEqual(listBox0);
  await ctx.close();
});
