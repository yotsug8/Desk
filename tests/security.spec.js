import { test, expect } from '@playwright/test';
import { createBoard, joinBoard, addNote } from './helpers.js';

// Попытки обойти правила прямо из консоли браузера
test('участник не может писать в таблицы напрямую', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await joinBoard(b, url, 'Миша');
  await addNote(a, 400, 300, 'Не трогать');
  await expect(b.locator('.el.note')).toHaveCount(1);

  const res = await b.evaluate(async () => {
    const sb = window.__deskApi.sb;
    const id = [...window.__desk.els.keys()][0];
    const board = window.__desk.id;
    const r = {};
    r.update = (await sb.from('elements').update({ x: 999 }).eq('id', id)).error?.code;
    r.del = (await sb.from('elements').delete().eq('id', id)).error?.code;
    r.insert = (await sb.from('elements').insert({ board_id: board, type: 'note', x: 0, y: 0, w: 1, h: 1, z: 1 })).error?.code;
    r.history = (await sb.from('history').insert({ board_id: board, action: 'create' })).error?.code;
    r.historyDel = (await sb.from('history').delete().eq('board_id', board)).error?.code;
    r.secret = (await sb.from('boards').select('owner_secret_hash')).error?.code;
    r.owner = (await sb.from('boards').update({ owner_id: (await sb.auth.getUser()).data.user.id }).eq('id', board)).error?.code;
    r.role = (await sb.from('members').update({ role: 'owner' }).eq('board_id', board)).error?.code;
    r.rename = (await sb.rpc('rename_board', { p_board: board, p_title: 'Взлом' })).error?.message;
    r.claim = (await sb.rpc('claim_owner', { p_board: board, p_secret: 'угадал' })).data;
    r.badColor = (await sb.rpc('el_update', { p_id: id, p_base_version: 99, p_patch: { data: { color: 'red' } } })).error?.message;
    r.badKey = (await sb.rpc('el_update', { p_id: id, p_base_version: 99, p_patch: { created_by: board } })).error?.message;
    return r;
  });
  expect(res.update).toBe('42501');
  expect(res.del).toBe('42501');
  expect(res.insert).toBe('42501');
  expect(res.history).toBe('42501');
  expect(res.historyDel).toBe('42501');
  expect(res.secret).toBe('42501');
  expect(res.owner).toBe('42501');
  expect(res.role).toBe('42501');
  expect(res.rename).toBe('no_access');
  expect(res.claim).toBe(false);
  expect(res.badColor).toBe('bad_color');
  expect(res.badKey).toBe('bad_patch');
});

test('посторонний без входа на доску ничего не видит и не меняет', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const url = await createBoard(a, 'Аня');
  await addNote(a, 400, 300, 'Секрет');
  const board = new URL(url).searchParams.get('b');
  const id = await a.evaluate(() => [...window.__desk.els.keys()][0]);

  const x = await (await browser.newContext()).newPage();
  await x.goto('/');
  const res = await x.evaluate(async ({ board, id }) => {
    const sb = window.__deskApi.sb;
    await sb.auth.signInAnonymously();
    const r = {};
    r.read = (await sb.from('elements').select('*').eq('board_id', board)).data?.length;
    r.history = (await sb.from('history').select('*').eq('board_id', board)).data?.length;
    r.create = (await sb.rpc('el_create', { p_board: board, p_type: 'note', p_x: 0, p_y: 0, p_w: 100, p_h: 100, p_data: {} })).error?.message;
    r.update = (await sb.rpc('el_update', { p_id: id, p_base_version: 1, p_patch: { x: 5 } })).error?.message;
    r.del = (await sb.rpc('el_delete', { p_ids: [id] })).error?.message;
    r.rollback = (await sb.rpc('rollback_to', { p_board: board, p_history_id: 1 })).error?.message;
    return r;
  }, { board, id });
  expect(res.read).toBe(0);
  expect(res.history).toBe(0);
  expect(res.create).toBe('no_access');
  expect(res.update).toBe('no_access');
  expect(res.del).toBe('no_access');
  expect(res.rollback).toBe('no_access');
});

test('ссылка владельца возвращает права в новом браузере', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await createBoard(a, 'Аня');
  const owner = await a.evaluate(() => window.__desk.opts.ownerLink());
  expect(owner).toContain('owner=');

  const a2 = await (await browser.newContext()).newPage();
  await a2.goto(owner);
  await expect(a2.locator('#app')).toBeVisible();
  await expect.poll(() => a2.evaluate(() => window.__desk.me.role)).toBe('owner');
  expect(a2.url()).not.toContain('owner=');
});
