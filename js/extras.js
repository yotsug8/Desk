// Поиск по доске, мини-карта и выгрузка доски картинкой или текстом
import { icon } from './icons.js';
import { toast } from './ui.js';

const $ = (id) => document.getElementById(id);
let B, A; // состояние доски и функции board.js

export function initExtras(board, api) {
  B = board;
  A = api;
  initMinimap();
}

// Видимые сейчас элементы (живые или снимок истории)
function rows() {
  const ids = B.past ? [...B.past.keys()] : [...B.els.keys()];
  return ids.map((id) => A.viewOf(id)).filter(Boolean);
}

const plain = (s) => (s || '').replace(/^\[( |x)\] ?/gm, '').trim();

// ---------- Поиск ----------

const find = { q: '', hits: [], i: -1 };

export function openFind() {
  const bar = $('find');
  if (!bar.hidden) { bar.querySelector('input').select(); return; }
  bar.innerHTML = `${icon('search', true)}
    <input type="search" placeholder="Найти на доске" aria-label="Найти на доске" maxlength="80">
    <span class="cnt"></span>
    <button class="ib sm" data-f="prev" title="Предыдущее (Shift + Enter)">${icon('up', true)}</button>
    <button class="ib sm" data-f="next" title="Следующее (Enter)">${icon('down', true)}</button>
    <button class="ib sm" data-f="close" title="Закрыть (Esc)">${icon('close', true)}</button>`;
  bar.hidden = false;
  const input = bar.querySelector('input');
  input.value = find.q;
  input.focus();
  input.oninput = () => runFind(input.value);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  };
  bar.onclick = (e) => {
    const f = e.target.closest('[data-f]')?.dataset.f;
    if (f === 'close') closeFind();
    else if (f) step(f === 'next' ? 1 : -1);
  };
  if (find.q) runFind(find.q);
}

export function closeFind() {
  $('find').hidden = true;
  find.hits = [];
  find.i = -1;
  mark();
}

export const findOpen = () => !$('find').hidden;

// Перерисовка подсветки после изменений на доске
export function refreshFind() {
  if (findOpen() && find.q) runFind(find.q, true);
}

function runFind(q, keep) {
  find.q = q;
  const needle = q.trim().toLowerCase();
  const prev = find.hits[find.i];
  find.hits = needle
    ? rows().filter((r) => r.type !== 'link' && plain(r.data?.text).toLowerCase().includes(needle))
      .sort((a, b) => a.y - b.y || a.x - b.x).map((r) => r.id)
    : [];
  find.i = keep && prev ? find.hits.indexOf(prev) : -1;
  if (!keep && find.hits.length) { find.i = 0; show(); }
  mark();
}

function step(d) {
  if (!find.hits.length) return;
  find.i = (find.i + d + find.hits.length) % find.hits.length;
  show();
  mark();
}

function show() {
  const r = A.viewOf(find.hits[find.i]);
  if (r) A.flyTo(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.8, Math.min(1.2, B.cam.s)), 450);
}

function mark() {
  const on = findOpen() && find.q.trim();
  $('world').classList.toggle('searching', !!on);
  const hits = new Set(on ? find.hits : []);
  const cur = find.hits[find.i];
  for (const [id, node] of B.nodes) {
    node.classList.toggle('found', hits.has(id));
    node.classList.toggle('cur', on && id === cur);
  }
  const cnt = $('find').querySelector('.cnt');
  if (cnt) cnt.textContent = !on ? '' : find.hits.length ? `${find.i + 1} из ${find.hits.length}` : 'нет';
}

// ---------- Мини-карта ----------

const MAP_W = 176, MAP_H = 116;
const mm = { box: null, cv: null, k: 1, ox: 0, oy: 0, queued: false };

function initMinimap() {
  const box = $('minimap');
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = MAP_W * dpr;
  cv.height = MAP_H * dpr;
  cv.style.width = MAP_W + 'px';
  cv.style.height = MAP_H + 'px';
  cv.getContext('2d').scale(dpr, dpr);
  box.replaceChildren(cv);
  Object.assign(mm, { box, cv });

  // нажатие или протяжка по карте переносит взгляд
  const go = (e) => {
    const b = cv.getBoundingClientRect();
    const x = (e.clientX - b.left - mm.ox) / mm.k, y = (e.clientY - b.top - mm.oy) / mm.k;
    B.cam = { s: B.cam.s, x: innerWidth / 2 - x * B.cam.s, y: innerHeight / 2 - y * B.cam.s };
    A.manualCamera?.();
    A.applyCamera();
  };
  cv.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    cv.setPointerCapture(e.pointerId);
    go(e);
    cv.onpointermove = go;
  });
  cv.addEventListener('pointerup', () => { cv.onpointermove = null; });
  cv.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
}

export function drawMinimap() {
  if (mm.queued || !mm.cv) return;
  mm.queued = true;
  requestAnimationFrame(paintMinimap);
}

function paintMinimap() {
  mm.queued = false;
  const list = rows().filter((r) => r.type !== 'link');
  const show = list.length > 0;
  mm.box.hidden = !show;
  if (!show) return;

  const { x: cx, y: cy, s } = B.cam;
  const view = { x1: -cx / s, y1: -cy / s, x2: (innerWidth - cx) / s, y2: (innerHeight - cy) / s };
  let x1 = view.x1, y1 = view.y1, x2 = view.x2, y2 = view.y2;
  for (const r of list) {
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
  }
  const pad = 8;
  const k = Math.min((MAP_W - pad * 2) / (x2 - x1 || 1), (MAP_H - pad * 2) / (y2 - y1 || 1));
  mm.k = k;
  mm.ox = (MAP_W - (x2 - x1) * k) / 2 - x1 * k;
  mm.oy = (MAP_H - (y2 - y1) * k) / 2 - y1 * k;

  const g = mm.cv.getContext('2d');
  g.clearRect(0, 0, MAP_W, MAP_H);
  for (const r of list) {
    g.fillStyle = colorOf(r);
    g.fillRect(mm.ox + r.x * k, mm.oy + r.y * k, Math.max(2, r.w * k), Math.max(2, r.h * k));
  }
  g.strokeStyle = '#e8846f';
  g.lineWidth = 1.5;
  g.strokeRect(mm.ox + view.x1 * k, mm.oy + view.y1 * k, (view.x2 - view.x1) * k, (view.y2 - view.y1) * k);
}

function colorOf(r) {
  const c = r.data?.color;
  if (r.type === 'note') return A.SWATCH[c] || A.SWATCH.yellow;
  if (r.type === 'list') return c === 'yellow' ? '#f6edc6' : c === 'blue' ? '#e2ecf4' : '#fbf9f4';
  if (r.type === 'draw') return A.DRAW[c] || A.DRAW.white;
  if (r.type === 'image') return '#e9e4da';
  if (r.type === 'frame') return '#ffffff33';
  return c === 'white' ? '#fbf7ee' : c === 'red' ? '#b8412e' : '#26221f';
}

// ---------- Выгрузка ----------

export function exportDialog() {
  const { root, close } = A.openModal(`
    <h3>Скачать доску</h3>
    <p>Файл сохранится на вашем устройстве.</p>
    <div class="choices">
      <button class="choice" data-x="png">${icon('image', true)}<span><b>Картинкой</b><small>вся доска в PNG</small></span></button>
      <button class="choice" data-x="md">${icon('note', true)}<span><b>Текстом</b><small>заметки и списки в Markdown</small></span></button>
    </div>
    <div class="row"><button class="minibtn" data-close>Закрыть</button></div>`);
  root.querySelector('[data-close]').onclick = close;
  root.onclick = async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    close();
    try {
      if (x === 'md') save(new Blob([toMarkdown()], { type: 'text/markdown' }), 'md');
      else save(await toPNG(), 'png');
    } catch (err) {
      toast('Не удалось сохранить: ' + err.message, true);
    }
  };
}

function fileName(ext) {
  const t = (B.title || 'доска').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'доска';
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${t} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${ext}`;
}

function save(blob, ext) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName(ext);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Файл сохранён');
}

// Markdown: сверху вниз, слева направо
export function toMarkdown() {
  const list = rows().filter((r) => ['note', 'text', 'list', 'image', 'frame'].includes(r.type) && (r.data?.text || '').trim())
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [`# ${B.title || 'Доска'}`, ''];
  for (const r of list) {
    const t = r.data.text.trim();
    if (r.type === 'text' || r.type === 'frame') out.push(`## ${t.replace(/\n+/g, ' ')}`);
    else if (r.type === 'list') out.push(t.split('\n').map((l) => (/^\[( |x)\]/.test(l) ? `- ${l}` : `**${l.trim()}**`)).join('\n'));
    else if (r.type === 'image') out.push(`*Фото: ${t}*`);
    else out.push(t.split('\n').map((l) => `> ${l}`).join('\n'));
    out.push('');
  }
  return out.join('\n');
}

// Размер как на экране: у списков, текста и фото он зависит от содержимого
function sized(r) {
  const n = B.nodes.get(r.id);
  return r.type === 'note' || r.type === 'draw' || r.type === 'frame' || !n ? r : { ...r, w: n.offsetWidth || r.w, h: n.offsetHeight || r.h };
}

// PNG: всё рисуем заново на холсте, без снимков экрана
async function toPNG() {
  const list = rows().map(sized);
  const solid = list.filter((r) => r.type !== 'link');
  if (!solid.length) throw new Error('доска пуста');
  const pad = 60;
  const x1 = Math.min(...solid.map((r) => r.x)) - pad, y1 = Math.min(...solid.map((r) => r.y)) - pad;
  const x2 = Math.max(...solid.map((r) => r.x + r.w)) + pad, y2 = Math.max(...solid.map((r) => r.y + r.h)) + pad;
  // не больше 8000 точек по стороне, но и не мельче обычного вида
  const sc = Math.min(2, 8000 / (x2 - x1), 8000 / (y2 - y1));
  const cv = document.createElement('canvas');
  cv.width = Math.ceil((x2 - x1) * sc);
  cv.height = Math.ceil((y2 - y1) * sc);
  const g = cv.getContext('2d');
  g.scale(sc, sc);
  g.translate(-x1, -y1);

  // пробка
  const tile = new Image();
  tile.src = getComputedStyle($('app')).backgroundImage.slice(5, -2);
  await tile.decode().catch(() => {});
  g.fillStyle = tile.width ? g.createPattern(tile, 'repeat') : '#b48a5e';
  g.fillRect(x1, y1, x2 - x1, y2 - y1);

  const imgs = new Map(await Promise.all(solid.filter((r) => r.type === 'image').map(async (r) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.src = A.imageURL(r.data.src);
    try { await im.decode(); return [r.id, im]; } catch { return [r.id, null]; }
  })));

  const byZ = [...solid].sort((a, b) => (a.type === 'frame' ? 0 : 1) - (b.type === 'frame' ? 0 : 1) || (a.z || 0) - (b.z || 0));
  for (const r of byZ) paintEl(g, r, imgs.get(r.id));
  for (const r of list.filter((q) => q.type === 'link')) paintLink(g, r);

  return new Promise((ok, bad) => cv.toBlob((b) => (b ? ok(b) : bad(new Error('картинка слишком большая'))), 'image/png'));
}

const SANS = getComputedStyle(document.documentElement).getPropertyValue('--sans') || 'sans-serif';

function shadowed(g, fn) {
  g.save();
  g.shadowColor = '#00000040';
  g.shadowBlur = 10;
  g.shadowOffsetY = 3;
  fn();
  g.restore();
}

function paintEl(g, r, img) {
  const text = r.data?.text || '';
  if (r.type === 'frame') {
    const tint = { yellow: '241,226,164', green: '207,224,200', blue: '201,219,232', pink: '239,201,196' }[r.data.color] || '255,255,255';
    g.fillStyle = `rgba(${tint},.18)`;
    g.strokeStyle = `rgba(${tint},.8)`;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(r.x, r.y, r.w, r.h, 10);
    g.fill();
    g.stroke();
    if (text) {
      g.font = `600 14px ${SANS}`;
      const tw = g.measureText(text).width + 20;
      g.fillStyle = 'rgba(43,39,36,.8)';
      g.beginPath();
      g.roundRect(r.x - 2, r.y - 33, tw, 27, 7);
      g.fill();
      g.fillStyle = '#f2ede6';
      g.textBaseline = 'middle';
      g.fillText(text, r.x + 8, r.y - 19);
    }
  } else if (r.type === 'note' || r.type === 'list') {
    shadowed(g, () => { g.fillStyle = colorOf(r); g.fillRect(r.x, r.y, r.w, r.h); });
    g.fillStyle = '#26221f';
    g.font = `${r.type === 'list' ? 14 : 15}px ${SANS}`;
    const lines = r.type === 'list'
      ? text.split('\n').map((l) => l.replace(/^\[x\] ?/, '☑ ').replace(/^\[ \] ?/, '☐ '))
      : [text];
    wrap(g, lines, r.x + 14, r.y + 18, r.w - 28, r.type === 'list' ? 26 : 21, r.y + r.h - 8);
  } else if (r.type === 'text') {
    const size = r.data.size || 36;
    g.font = `700 ${size}px 'PT Serif', Georgia, serif`;
    g.fillStyle = colorOf(r);
    g.textBaseline = 'top';
    text.split('\n').forEach((l, i) => g.fillText(l, r.x, r.y + i * size * 1.15));
  } else if (r.type === 'draw') {
    g.save();
    g.translate(r.x, r.y);
    g.strokeStyle = colorOf(r);
    g.lineWidth = r.data.width || 6;
    g.lineCap = g.lineJoin = 'round';
    g.stroke(new Path2D(A.smoothPath(A.parsePoints(r.data.points))));
    g.restore();
  } else if (r.type === 'image') {
    shadowed(g, () => { g.fillStyle = '#fbf9f4'; g.fillRect(r.x, r.y, r.w, r.h); });
    const capH = text ? 34 : 0;
    const iw = r.w - 16, ih = r.h - 16 - capH;
    if (img) {
      const k = Math.max(iw / img.width, ih / img.height);
      const sw = iw / k, sh = ih / k;
      g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, r.x + 8, r.y + 8, iw, ih);
    } else {
      g.fillStyle = '#e9e4da';
      g.fillRect(r.x + 8, r.y + 8, iw, ih);
    }
    if (text) {
      g.fillStyle = '#26221f';
      g.font = `14px ${SANS}`;
      wrap(g, [text], r.x + 10, r.y + r.h - capH + 4, r.w - 20, 18, r.y + r.h);
    }
  }
}

// Перенос строк по ширине, обрезка по низу
function wrap(g, paras, x, y, w, lh, maxY) {
  g.textBaseline = 'top';
  for (const p of paras) {
    let line = '';
    for (const word of p.split(/(\s+)/)) {
      const t = line + word;
      if (g.measureText(t).width > w && line.trim()) {
        if (y + lh > maxY) return;
        g.fillText(line.trimEnd(), x, y);
        y += lh;
        line = word.trimStart();
      } else line = t;
    }
    if (y + lh > maxY) return;
    g.fillText(line, x, y);
    y += lh;
  }
}

function paintLink(g, r) {
  const a = A.anchor(r.data.from), b = A.anchor(r.data.to);
  if (!a || !b) return;
  const ax = a.x, ay = a.y, bx = b.x, by = b.y;
  const sag = Math.min(120, Math.hypot(bx - ax, by - ay) * 0.15);
  g.save();
  g.strokeStyle = A.STRING[r.data.color] || A.STRING.red;
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(ax, ay);
  g.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + sag, bx, by);
  g.stroke();
  // кнопки на концах нитки
  g.fillStyle = '#8f2a1c';
  for (const [x, y] of [[ax, ay], [bx, by]]) {
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
