// Отмена и повтор своих действий (Ctrl+Z, Ctrl+Shift+Z).
// Запись хранит состояние элементов до и после действия; отмена возвращает «до», повтор «после».
import { toast } from './ui.js';

let B, A;
const done = [], undone = [];
const LIMIT = 100;
let running = false;
window.__deskUndo = { done, undone }; // для тестов

export function initUndo(board, api) {
  B = board;
  A = api;
}

const copy = (r) => (r ? { ...r, data: { ...r.data } } : null);

// Снимок перед действием: id -> строка или null, если элемента ещё нет
export function snap(ids) {
  return new Map([...ids].map((id) => [id, copy(B.els.get(id))]));
}

// Записать действие: before собран до него, after берётся из текущего состояния
export function commit(before) {
  if (running || !before?.size) return;
  const after = new Map([...before.keys()].map((id) => [id, copy(B.els.get(id))]));
  const same = [...before].every(([id, b]) => sameRow(b, after.get(id)));
  if (same) return;
  done.push({ before, after });
  if (done.length > LIMIT) done.shift();
  undone.length = 0;
}

// Правка текста сразу после создания не нужна отдельной записью: отмена всё равно уберёт элемент
export function justCreated(id) {
  const top = done[done.length - 1];
  return !!top && top.before.size === 1 && top.before.has(id) && top.before.get(id) === null;
}

// Обновить «после» у последней записи (текст дописан в новый элемент)
export function refreshTop(id) {
  const top = done[done.length - 1];
  if (top?.after.has(id)) top.after.set(id, copy(B.els.get(id)));
}

const alive = (r) => r && !r.deleted_at;
const sameRow = (a, b) => {
  if (!alive(a) && !alive(b)) return true;
  if (!alive(a) || !alive(b)) return false;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && JSON.stringify(a.data) === JSON.stringify(b.data);
};

export const canUndo = () => done.length > 0;

// Нажатия подряд встают в очередь, ни одно не теряется
let chain = Promise.resolve();
export const undo = () => (chain = chain.then(() => step(done, undone, 'before', 'Отменено')));
export const redo = () => (chain = chain.then(() => step(undone, done, 'after', 'Повторено')));

async function step(from, to, side, msg) {
  const entry = from.pop();
  if (!entry) { toast(side === 'before' ? 'Нечего отменять' : 'Нечего повторять'); return; }
  running = true;
  try {
    await apply(entry[side]);
    to.push(entry);
    toast(msg);
  } catch (err) {
    toast(err.message, true);
    A.resync();
  } finally {
    running = false;
  }
}

// Привести элементы к нужному состоянию минимальными вызовами
async function apply(target) {
  const del = [], res = [], upd = [];
  for (const [id, want] of target) {
    const cur = B.els.get(id);
    if (!alive(want)) { if (alive(cur)) del.push(id); continue; }
    if (!cur) continue; // элемент пропал совсем, вернуть нечего
    if (!alive(cur)) res.push(id);
    if (!sameRow(want, { ...cur, deleted_at: null })) upd.push([id, want]);
  }
  // сначала элементы, потом нитки: нитке нужны живые концы
  const linksLast = (ids) => ids.sort((a, b) => (B.els.get(a)?.type === 'link') - (B.els.get(b)?.type === 'link'));
  if (res.length) {
    for (const id of res) A.local(id, { deleted_at: null });
    await A.call('el_restore', { p_ids: linksLast(res) });
  }
  for (const [id, want] of upd) {
    const cur = B.els.get(id);
    const patch = { x: want.x, y: want.y, w: want.w, h: want.h, data: want.data };
    A.local(id, patch);
    const r = await A.call('el_update', { p_id: id, p_base_version: cur.version, p_patch: patch });
    if (r?.element) A.applyRemote(r.element);
  }
  if (del.length) {
    for (const id of del) A.local(id, { deleted_at: new Date().toISOString() });
    await A.call('el_delete', { p_ids: del });
  }
}
