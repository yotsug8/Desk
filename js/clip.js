// Копирование, вставка и дублирование элементов; вставка текста заметкой или списком
import { toast } from './ui.js';

let B, A; // состояние доски и функции board.js
const KEY = 'desk-clip';
let pointer = null; // где мышь в координатах доски

export function initClip(board, api) {
  B = board;
  A = api;
  addEventListener('pointermove', (e) => { if (e.target.closest?.('#stage')) pointer = A.toWorld(e.clientX, e.clientY); }, { passive: true });
}

const busy = (e) => ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || !document.getElementById('modal').hidden || B.editing;

// Выделенное вместе с нитками между выделенными
function picked() {
  const ids = new Set([...B.sel].filter((id) => B.els.get(id) && !B.els.get(id).deleted_at));
  const rows = [...ids].map((id) => B.els.get(id)).filter((r) => r.type !== 'link');
  const links = [...B.els.values()].filter((r) => r.type === 'link' && !r.deleted_at && ids.has(r.data.from) && ids.has(r.data.to));
  return rows.length ? [...rows, ...links] : [];
}

const plainOf = (rows) => rows.filter((r) => r.type !== 'link' && r.data?.text).map((r) => r.data.text).join('\n\n');

function onCopy(e, cut) {
  if (busy(e) || !B.sel.size || B.past) return;
  const rows = picked();
  if (!rows.length) return;
  const text = plainOf(rows) || ' ';
  const clean = rows.map(({ id, type, x, y, w, h, z, data }) => ({ id, type, x, y, w, h, z, data }));
  try { localStorage.setItem(KEY, JSON.stringify({ text, rows: clean })); } catch { /* приватный режим */ }
  e.clipboardData.setData('text/plain', text);
  e.preventDefault();
  if (cut) A.deleteSel(true);
  toast(cut ? 'Вырезано' : `Скопировано: ${rows.filter((r) => r.type !== 'link').length}`);
}

function onPaste(e) {
  if (busy(e) || B.past || !A.canEdit()) return;
  if ([...(e.clipboardData?.files || [])].some((x) => x.type.startsWith('image/'))) return; // фото вставляет board.js
  const text = e.clipboardData?.getData('text/plain') || '';
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* нет копии */ }
  if (saved && saved.text === (text || ' ')) {
    e.preventDefault();
    place(saved.rows, where(saved.rows));
  } else if (text.trim()) {
    e.preventDefault();
    pasteText(text);
  }
}

// Куда вставлять: под мышь, иначе в центр экрана
function where(rows) {
  const solid = rows.filter((r) => r.type !== 'link');
  const x1 = Math.min(...solid.map((r) => r.x)), y1 = Math.min(...solid.map((r) => r.y));
  const x2 = Math.max(...solid.map((r) => r.x + r.w)), y2 = Math.max(...solid.map((r) => r.y + r.h));
  const at = pointer || A.toWorld(innerWidth / 2, innerHeight / 2);
  return { dx: Math.round(at.x - (x1 + x2) / 2), dy: Math.round(at.y - (y1 + y2) / 2) };
}

export function duplicateSel() {
  if (!A.canEdit() || B.past) return;
  const rows = picked();
  if (rows.length) place(rows, { dx: 30, dy: 30 });
}

// Создать копии со сдвигом; нитки перевязываются на новые элементы
async function place(rows, { dx, dy }) {
  const map = new Map(rows.map((r) => [r.id, A.uuid()]));
  const z0 = Date.now();
  const make = (r, i) => ({
    p_board: B.id, p_type: r.type, p_x: r.x + dx, p_y: r.y + dy, p_w: r.w, p_h: r.h, p_id: map.get(r.id),
    p_data: r.type === 'link' ? { ...r.data, from: map.get(r.data.from), to: map.get(r.data.to) } : r.data,
    _z: z0 + i,
  });
  const solid = rows.filter((r) => r.type !== 'link').sort((a, b) => (a.z || 0) - (b.z || 0)).map(make);
  const links = rows.filter((r) => r.type === 'link').map(make);
  try {
    const made = await Promise.all(solid.map(({ _z, ...args }) => A.call('el_create', args)));
    made.forEach(A.applyRemote);
    const tied = await Promise.all(links.map(({ _z, ...args }) => A.call('el_create', args)));
    tied.forEach(A.applyRemote);
    A.commit(new Map([...made, ...tied].map((r) => [r.id, null])));
    A.setSelection(made.map((r) => r.id));
  } catch (err) {
    toast(err.message, true);
    A.resync();
  }
}

// Текст из буфера: строки с маркерами становятся списком, остальное заметкой
async function pasteText(text) {
  text = text.replace(/\r\n?/g, '\n').trim().slice(0, 5000);
  const lines = text.split('\n').filter((l) => l.trim());
  const bullet = /^\s*(?:[-*•]|\d+[.)]|\[( |x|X)\])\s+/;
  const isList = lines.length > 1 && lines.filter((l) => bullet.test(l)).length >= lines.length / 2;
  const at = pointer || A.toWorld(innerWidth / 2, innerHeight / 2);
  const type = isList ? 'list' : 'note';
  const data = isList
    ? { text: lines.map((l) => {
      const m = l.match(bullet);
      if (!m) return l.trim();
      return `[${m[1] && m[1] !== ' ' ? 'x' : ' '}] ${l.slice(m[0].length).trim()}`;
    }).join('\n'), color: 'white' }
    : { text, color: B.lastColor || 'yellow' };
  const w = isList ? 240 : text.length > 160 ? 280 : 200;
  const h = isList ? 160 : text.length > 160 ? 240 : 170;
  try {
    const saved = await A.call('el_create', {
      p_board: B.id, p_type: type, p_x: Math.round(at.x - w / 2), p_y: Math.round(at.y - h / 2), p_w: w, p_h: h, p_data: data, p_id: A.uuid(),
    });
    A.applyRemote(saved);
    A.commit(new Map([[saved.id, null]]));
    A.setSelection([saved.id]);
  } catch (err) { toast(err.message, true); }
}

addEventListener('copy', (e) => B && onCopy(e, false));
addEventListener('cut', (e) => B && A.canEdit() && onCopy(e, true));
addEventListener('paste', (e) => B && onPaste(e));
