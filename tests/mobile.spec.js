import { test, expect } from '@playwright/test';
test('масштаб не меняется при добавлении, два пальца при открытой клавиатуре ничего не двигают', async ({ browser }) => {
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
  const cam = () => page.evaluate(() => document.querySelector('.world').style.transform);
  const c0 = await cam();
  await tp('touchStart', [[150, 400], [250, 400]]);
  for (let i = 1; i <= 5; i++) await tp('touchMove', [[150 - i * 15, 400], [250 + i * 15, 400]]);
  await tp('touchEnd', []);
  await page.waitForTimeout(300);
  expect(await pct()).toBe(s0);
  // два пальца в одну сторону: доска стоит на месте, правка открыта
  await tp('touchStart', [[150, 400], [250, 400]]);
  for (let i = 1; i <= 5; i++) await tp('touchMove', [[150, 400 + i * 20], [250, 400 + i * 20]]);
  await tp('touchEnd', []);
  await page.waitForTimeout(300);
  expect(await cam()).toBe(c0);
  await expect(page.locator('body.editing')).toHaveCount(1);
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
  // заметка в верхней половине: доска не сдвигается, списки остаются в кадре
  const [ex, ey] = await page.evaluate(() => {
    for (let y = 260; y < 400; y += 20) for (let x = 60; x < 330; x += 30) {
      if (document.elementFromPoint(x, y)?.id === 'stage' || document.elementFromPoint(x, y)?.classList.contains('world')) return [x, y];
    }
  });
  await page.mouse.click(ex, ey);
  await expect(page.locator('body.editing')).toHaveCount(1);
  await page.waitForTimeout(500);
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
        const ed = document.querySelector('.el:has(textarea)').getBoundingClientRect();
        const onEd = px > ed.left - 20 && px < ed.right + 20 && py > ed.top - 20 && py < ed.bottom + 20;
        if (!onEd && py > 100 && py < innerHeight - 200 && el.contains(document.elementFromPoint(px, py))) return [px, py];
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
test('клавиатура ужимает окно: верхняя панель не сдвигается', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.fill('#name', 'Аня');
  await page.click('.bigbtn');
  await page.locator('.topbar').waitFor();
  await page.waitForTimeout(800);
  const pos = () => page.evaluate(() => ['.topbar', '#btnHistory', '#btnInvite'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }));
  const a = await pos();
  await page.setViewportSize({ width: 390, height: 420 }); // как будто клавиатура ужала окно
  await page.waitForTimeout(300);
  const b = await pos();
  expect(b).toEqual(a);
});
test('клавиатура уезжает: нижняя панель появляется уже на месте, без прыжков', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.fill('#name', 'Аня');
  await page.click('.bigbtn');
  await page.locator('#ledge').waitFor();
  await page.waitForTimeout(800);
  const close = page.locator('[data-close]'); if (await close.count()) await close.first().click();
  const ledge = () => page.evaluate(() => { const n = document.getElementById('ledge'); return { shown: getComputedStyle(n).visibility === 'visible', top: Math.round(n.getBoundingClientRect().top) }; });
  const final = await ledge();
  await page.locator('.tool[data-tool=note]').click();
  await page.mouse.click(195, 300);
  await expect(page.locator('body.editing')).toHaveCount(1);
  // клавиатура выехала и ужала окно
  await page.setViewportSize({ width: 390, height: 420 });
  await page.waitForTimeout(400);
  // правку закрыли, клавиатура уезжает по шагам
  await page.touchscreen.tap(40, 200);
  await expect(page.locator('body.editing')).toHaveCount(0);
  for (const h of [500, 620, 740, 844]) {
    expect((await ledge()).shown).toBe(false);
    await page.setViewportSize({ width: 390, height: h });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(600);
  expect(await ledge()).toEqual(final);
  await ctx.close();
});
test('панель цветов не мигает, когда начинаешь правку и выезжает клавиатура', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.fill('#name', 'Аня');
  await page.click('.bigbtn');
  await page.locator('#ledge').waitFor();
  await page.waitForTimeout(800);
  const close = page.locator('[data-close]'); if (await close.count()) await close.first().click();
  await page.locator('.tool[data-tool=note]').click();
  await page.mouse.click(195, 300);
  await expect(page.locator('body.editing')).toHaveCount(1);
  await page.touchscreen.tap(40, 200);
  await expect(page.locator('body.editing')).toHaveCount(0);
  await page.waitForTimeout(500);
  const note = page.locator('.el.note').first();
  const b = await note.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); // выбрать
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__log = [];
    const t0 = performance.now();
    const tick = () => {
      const s = document.getElementById('seltools'); const cs = getComputedStyle(s);
      const st = s.hidden ? 'hidden' : cs.opacity === '0' ? 'op0' : 'shown@' + Math.round(s.getBoundingClientRect().top);
      const last = window.__log[window.__log.length - 1];
      if (!last || last[1] !== st) window.__log.push([Math.round(performance.now() - t0), st, document.body.className]);
      if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
    };
    tick();
  });
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); // правка
  await page.waitForTimeout(100);
  await page.setViewportSize({ width: 390, height: 500 }); // клавиатура
  await page.waitForTimeout(2500);
  const log = await page.evaluate(() => window.__log);
  expect(log.map((l) => l[1])).toEqual([log[0][1]]);
  expect(log[0][1]).toMatch(/^shown/);
  await ctx.close();
});
test('бросок пальцем: доска докатывается и останавливается', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.fill('#name', 'Аня');
  await page.click('.tpl:has([value=empty])');
  await page.click('.bigbtn');
  await page.locator('#ledge').waitFor();
  await page.waitForTimeout(800);
  const close = page.locator('[data-close]'); if (await close.count()) await close.first().click();
  const camX = () => page.evaluate(() => window.__desk.cam.x);
  const cdp = await ctx.newCDPSession(page);
  const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  await tp('touchStart', [[100, 500]]);
  for (let i = 1; i <= 8; i++) { await tp('touchMove', [[100 + i * 20, 500]]); await page.waitForTimeout(8); }
  await tp('touchEnd', []);
  const atRelease = await camX();
  await page.waitForTimeout(1500);
  const after = await camX();
  expect(after).toBeGreaterThan(atRelease + 30); // докатилась дальше
  await page.waitForTimeout(500);
  expect(await camX()).toBe(after); // и остановилась
  await ctx.close();
});

test('бросок пальцем на медленном телефоне тоже докатывается', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.fill('#name', 'Аня');
  await page.click('.tpl:has([value=empty])');
  await page.click('.bigbtn');
  await page.locator('#ledge').waitFor();
  await page.waitForTimeout(800);
  const close = page.locator('[data-close]'); if (await close.count()) await close.first().click();
  const camX = () => page.evaluate(() => window.__desk.cam.x);
  const cdp = await ctx.newCDPSession(page);
  const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  await tp('touchStart', [[40, 500]]);
  for (let i = 1; i <= 6; i++) { await page.waitForTimeout(110); await tp('touchMove', [[40 + i * 40, 500]]); }
  await tp('touchEnd', []);
  const atRelease = await camX();
  await page.waitForTimeout(1500);
  const after = await camX();
  expect(after).toBeGreaterThan(atRelease + 30); // докатилась дальше
  await page.waitForTimeout(500);
  expect(await camX()).toBe(after); // и остановилась
  await ctx.close();
});
