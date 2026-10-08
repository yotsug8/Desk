// Доска: состояние, отрисовка элементов и ниток, камера, мышь и пальцы
import { rpc, select } from './api.js';
import { icon, CURSOR_SVG } from './icons.js';
import { merge3, mapCaret } from './merge.js';
import { toast, esc, openModal, copyText } from './ui.js';
import { connectLive } from './live.js';
import { initHistory } from './history.js';
import { corkOn } from './cork.js';

const $ = (id) => document.getElementById(id);
const NOTE_COLORS = ['yellow', 'pink', 'green', 'blue', 'white'];
const TEXT_COLORS = ['ink', 'white', 'red'];
const LINK_COLORS = ['red', 'ink', 'blue', 'white'];
const SWATCH = {
  yellow: '#f6d860', pink: '#f4b6c2', green: '#a8d8c0', blue: '#a9cbe8', white: '#fbf7ec',
  ink: '#2a1f14', red: '#b3261e',
};
const STRING = { red: '#b3261e', ink: '#2a1f14', blue: '#2f5d8a', white: '#fdf3df', green: '#2f7a5a', yellow: '#d4a93c', pink: '#c2577a' };
const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const MAX_VOTES = 3;

let B; // состояние открытой доски

// randomUUID есть только на HTTPS, запасной вариант на случайных байтах
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Небольшой постоянный наклон элемента, у каждого свой
function tilt(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 31) / 10 - 1.5).toFixed(1);
}

export async function startBoard(opts) {
  B = {
    id: opts.id,
    title: opts.title,
    me: opts.me,
    opts,
    els: new Map(),        // id -> строка элемента (включая удалённые, нужны для истории)
    members: new Map(),    // user_id -> участник
    nodes: new Map(),      // id -> DOM-узел
    sel: new Set(),
    tool: null,            // null: двигать; note, text, link, vote
    cam: { x: 0, y: 0, s: 1 },
    editing: null,
    holds: new Map(),      // id элемента -> { u, name, color, mode } от других людей
    myDrag: new Set(),     // что я сейчас тащу: чужие координаты для них не применяем
    past: null,            // снимок прошлого при просмотре истории
    pending: 0,
    online: null,          // null: ещё подключаемся
    linkFrom: null,        // откуда тянется нитка
    round: null,           // текущий раунд голосования
    votes: new Map(),      // id -> кнопка голосования
    follow: null,          // за кем слежу
    people: [],            // кто в сети
  };
  window.__desk = B; // для тестов и отладки

  $('app').hidden = false;
  buildChrome();

  const [els, members, rounds, votes] = await Promise.all([
    select('elements', B.id), select('members', B.id), select('rounds', B.id), select('votes', B.id),
  ]);
  for (const m of members) B.members.set(m.user_id, m);
  for (const e of els) B.els.set(e.id, e);
  B.round = rounds[0] || null;
  for (const v of votes) B.votes.set(v.id, v);
  fitCamera();
  renderAll();
  bindInput();
  updateVoteBar();
  document.fonts?.ready.then(() => { renderAll(); for (const r of B.els.values()) if (r.type === 'text' && !r.deleted_at) syncTextBox(r.id, true); });

  B.live = connectLive(B, {
    onElement: applyRemote,
    onMember,
    onHistory: (row) => B.history.onRow(row),
    onDrag,
    onPresence,
    onHold,
    onCursor: drawCursor,
    onViewport,
    onSummon,
    onRound: (r) => { B.round = r; updateVoteBar(); renderVotesAll(); },
    onVote: (v) => { B.votes.set(v.id, v); renderVotes(v.element_id); updateVoteBar(); },
    onStatus: (ok) => { B.online = ok; updateStatus(); },
    onResync: resync,
  });
  B.history = initHistory(B, { setPast, rollback, memberName, memberColor, setTitle });

  if (opts.fresh) inviteDialog();
}

// ---------- Ярлыки, полочка, часы ----------

function buildChrome() {
  $('boardTitle').textContent = B.title;
  $('titleLabel').classList.toggle('can', isOwner());
  $('titleLabel').onclick = () => isOwner() && renameDialog();
  $('btnInvite').onclick = inviteDialog;
  $('btnHistory').onclick = () => B.history.toggle();
  buildLedge();
  updateStatus();
  tickClock();
  setInterval(tickClock, 20000);
}

function tickClock() {
  const d = new Date();
  const m = d.getMinutes(), h = (d.getHours() % 12) + m / 60;
  $('btnHistory').querySelector('.h').style.transform = `rotate(${180 + h * 30}deg)`;
  $('btnHistory').querySelector('.m').style.transform = `rotate(${180 + m * 6}deg)`;
}

const LEDGE = [
  { tool: 'note', label: 'заметка', obj: '<i class="o-pad"></i>', edit: true, key: 'N' },
  { tool: 'text', label: 'надпись', obj: '<i class="o-marker"></i>', edit: true, key: 'T' },
  { tool: 'link', label: 'нитка', obj: '<i class="o-yarn"></i>', edit: true, key: 'L' },
];

function buildLedge() {
  const items = LEDGE.filter((t) => !t.edit || canEdit());
  $('ledge').hidden = !items.length;
  $('ledge').innerHTML = items.map((t) => `
    <button class="tool${t.tool && B.tool === t.tool ? ' on' : ''}" type="button" ${t.tool ? `data-tool="${t.tool}"` : `data-act="${t.act}"`}
      title="${t.label}${t.key ? ` (${t.key})` : ''}"><span class="obj">${t.obj}</span><span>${t.label}</span></button>`).join('');
  $('ledge').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) setTool(B.tool === b.dataset.tool ? null : b.dataset.tool);
    if (b.dataset.act === 'vote') voteAction();
    if (b.dataset.act === 'summon') summon();
  };
}

function setTool(t) {
  B.tool = t;
  if (t !== 'link') cancelLink();
  for (const b of $('ledge').children) b.classList.toggle('on', !!t && b.dataset.tool === t);
  $('stage').className = 'stage' + (t ? ' tool-' + t : '');
  if (t === 'link') toast('Нажмите на первый элемент, потом на второй');
}

const isOwner = () => B.me.role === 'owner';
const canEdit = () => ['owner', 'editor'].includes(B.me.role) && !B.past;

function updateStatus() {
  const el = $('status');
  el.classList.toggle('bad', B.online === false);
  if (B.online === null) el.textContent = 'подключаюсь';
  else if (!B.online) el.textContent = 'нет связи';
  else if (B.me.role === 'viewer') el.textContent = 'только просмотр';
  else el.textContent = B.pending ? 'сохраняю' : 'сохранено';
}

// Вызов функции сервера со счётчиком несохранённого
async function call(name, args) {
  B.pending++;
  updateStatus();
  try {
    return await rpc(name, args);
  } finally {
    B.pending--;
    updateStatus();
  }
}

function inviteDialog() {
  const owner = B.opts.ownerLink();
  const { root, close } = openModal(`
    <span class="tape"></span>
    <h3>Позвать на доску</h3>
    <p>Все, у кого есть ссылка, смогут войти и прикалывать заметки вместе с вами.</p>
    <div class="copyrow"><input class="field" readonly value="${esc(B.opts.inviteLink)}"><button class="minibtn" data-copy="0">Копировать</button></div>
    ${owner ? `
      <h3 style="margin-top:16px;font-size:26px">Ссылка владельца</h3>
      <p class="note-small">Сохраните её для себя и никому не отправляйте: по ней вы вернёте права владельца с другого устройства или после очистки браузера.</p>
      <div class="copyrow"><input class="field" readonly value="${esc(owner)}"><button class="minibtn" data-copy="1">Копировать</button></div>` : ''}
    <div class="row"><button class="minibtn go" data-close>Готово</button></div>`);
  root.onclick = (e) => {
    if (e.target.closest('[data-close]')) close();
    const c = e.target.closest('[data-copy]');
    if (c) copyText(c.dataset.copy === '1' ? owner : B.opts.inviteLink);
  };
}

function renameDialog() {
  const { root, close } = openModal(`
    <span class="tape"></span>
    <h3>Название доски</h3>
    <form><input class="field" maxlength="80" required value="${esc(B.title)}">
    <div class="row"><button type="button" class="minibtn" data-close>Отмена</button><button class="minibtn go">Сохранить</button></div></form>`);
  const input = root.querySelector('input');
  input.select();
  root.querySelector('[data-close]').onclick = close;
  root.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await call('rename_board', { p_board: B.id, p_title: input.value });
      setTitle(input.value.trim());
      close();
    } catch (err) { toast(err.message, true); }
  };
}

function setTitle(t) {
  B.title = t;
  $('boardTitle').textContent = t;
  B.opts.onTitle(t);
}

// ---------- Участники и слежение ----------

function memberName(uid) { return B.members.get(uid)?.name ?? 'Гость'; }
function memberColor(uid) { return B.members.get(uid)?.color ?? '#7a6a55'; }

function onMember(m) {
  B.members.set(m.user_id, m);
  if (m.user_id === B.me.user_id) {
    const was = B.me.role;
    B.me = m;
    if (m.banned) location.reload();
    if (was !== m.role) { buildLedge(); updateStatus(); }
  }
  for (const [id, row] of B.els) if (row.created_by === m.user_id) renderEl(id);
}

function onPresence(people) {
  B.people = people.filter((p) => p.u !== B.me.user_id);
  renderPeople();
  // курсоры и рамки ушедших
  const alive = new Set(B.people.map((p) => p.u));
  for (const [u, c] of cursors) if (!alive.has(u)) { c.node.remove(); cursors.delete(u); }
  for (const [id, hd] of B.holds) if (!alive.has(hd.u)) { B.holds.delete(id); renderEl(id); }
  if (B.follow && !alive.has(B.follow)) stopFollow();
}

function renderPeople() {
  $('people').innerHTML = B.people.map((p, i) => `
    <button class="label av${B.follow === p.u ? ' on' : ''}" data-u="${esc(p.u)}" style="--c:${esc(p.c)};--r:${i % 2 ? 2 : -2}deg"
      title="Смотреть глазами: ${esc(p.n)}">${esc(p.n)}</button>`).join('');
  $('people').onclick = (e) => {
    const b = e.target.closest('[data-u]');
    if (!b) return;
    B.follow === b.dataset.u ? stopFollow() : startFollow(b.dataset.u);
  };
}

function startFollow(u) {
  B.follow = u;
  const p = B.people.find((x) => x.u === u);
  $('followBar').hidden = false;
  $('followBar').innerHTML = `<span>Смотрю глазами: <b style="color:${esc(p?.c)}">${esc(p?.n || 'Гость')}</b></span><button class="minibtn" data-stop>Хватит</button>`;
  $('followBar').querySelector('[data-stop]').onclick = stopFollow;
  renderPeople();
  B.live.askViewport();
}

function stopFollow() {
  if (!B.follow) return;
  B.follow = null;
  $('followBar').hidden = true;
  renderPeople();
}

// Чужая камера: если я за ним слежу, плавно еду туда же
function onViewport({ u, x, y, s }) {
  if (B.follow !== u) return;
  flyTo(x, y, s, 250);
}

// Кто-то зовёт всех к себе
function onSummon({ u, x, y, s }) {
  if (u === B.me.user_id) return;
  stopFollow();
  flyTo(x, y, s, 700);
  ripple(x, y, memberColor(u));
  toast(`${memberName(u)} зовёт всех сюда`);
}

function summon() {
  const c = toWorld(innerWidth / 2, innerHeight / 2);
  B.live.summon(c.x, c.y, B.cam.s);
  ripple(c.x, c.y, memberColor(B.me.user_id));
  toast('Позвали всех сюда');
}

function ripple(x, y, color) {
  const r = document.createElement('div');
  r.className = 'ripple';
  r.style.setProperty('--c', color);
  r.style.left = x + 'px';
  r.style.top = y + 'px';
  $('world').append(r);
  setTimeout(() => r.remove(), 4300);
}

// ---------- Камера и пробка ----------

function fitCamera() {
  const live = [...B.els.values()].filter((e) => !e.deleted_at && e.type !== 'link');
  if (!live.length) {
    B.cam = { x: innerWidth / 2, y: innerHeight / 2, s: 1 };
  } else {
    const x1 = Math.min(...live.map((e) => e.x)), y1 = Math.min(...live.map((e) => e.y));
    const x2 = Math.max(...live.map((e) => e.x + e.w)), y2 = Math.max(...live.map((e) => e.y + e.h));
    const mx = Math.min(160, innerWidth * 0.12), my = Math.min(260, innerHeight * 0.3);
    const s = Math.min(1, (innerWidth - mx) / (x2 - x1 + 1), (innerHeight - my) / (y2 - y1 + 1));
    const sc = Math.max(0.3, s);
    B.cam = { s: sc, x: innerWidth / 2 - ((x1 + x2) / 2) * sc, y: innerHeight / 2 - ((y1 + y2) / 2) * sc };
  }
  applyCamera();
}

function applyCamera() {
  const { x, y, s } = B.cam;
  $('world').style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  $('world').style.setProperty('--inv', 1 / s);
  corkOn($('app'), B.cam);
  for (const c of cursors.values()) placeCursor(c);
  if (!$('seltools').hidden) placeSelTools();
  const c = toWorld(innerWidth / 2, innerHeight / 2);
  B.live?.viewport(c.x, c.y, s);
}

function toWorld(sx, sy) {
  return { x: (sx - B.cam.x) / B.cam.s, y: (sy - B.cam.y) / B.cam.s };
}

function zoomAt(sx, sy, k) {
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, B.cam.s * k));
  const w = toWorld(sx, sy);
  B.cam = { s, x: sx - w.x * s, y: sy - w.y * s };
  applyCamera();
}

// Плавный перелёт: точка (x, y) мира в центр экрана с масштабом s
let flight = 0;
function flyTo(x, y, s, ms) {
  s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  const from = { ...B.cam };
  const to = { s, x: innerWidth / 2 - x * s, y: innerHeight / 2 - y * s };
  const t0 = performance.now();
  const id = ++flight;
  const step = (t) => {
    if (id !== flight) return;
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    B.cam = { s: from.s + (to.s - from.s) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
    applyCamera();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Ручное движение камеры отменяет перелёт и слежение
function manualCamera() {
  flight++;
  stopFollow();
}

// ---------- Отрисовка элементов ----------

// Что показывать для элемента: текущая строка или снимок из прошлого
function viewOf(id) {
  if (B.past) {
    const s = B.past.get(id);
    return s ? { ...s, id, created_by: B.els.get(id)?.created_by } : null;
  }
  const r = B.els.get(id);
  return r && !r.deleted_at ? r : null;
}

function renderAll() {
  const ids = new Set([...B.els.keys(), ...(B.past ? B.past.keys() : [])]);
  for (const id of B.nodes.keys()) ids.add(id);
  for (const id of ids) renderEl(id);
  reorder();
  queueStrings();
}

function renderEl(id) {
  const v = viewOf(id);
  let node = B.nodes.get(id);
  queueStrings();
  if (!v || v.type === 'link') {
    if (node) { node.remove(); B.nodes.delete(id); }
    if (!v && B.sel.delete(id)) placeSelTools();
    if (!v && B.editing?.id === id) { B.editing.ta.blur(); B.editing = null; }
    if (!v && B.linkFrom === id) cancelLink();
    return;
  }
  if (!node) {
    node = document.createElement('div');
    node.dataset.id = id;
    node.innerHTML = '<div class="body"></div>';
    B.nodes.set(id, node);
    $('world').append(node);
    node.style.zIndex = 1e6;
    queueReorder();
  }
  const note = v.type === 'note';
  const sel = B.sel.has(id);
  const color = v.data.color || (note ? 'yellow' : 'ink');
  node.className = `el ${v.type} c-${color}${sel ? ' sel' : ''}${sel && B.sel.size === 1 ? ' one' : ''}${B.past ? ' past' : ''}${B.linkFrom === id ? ' linking' : ''}`;
  node.style.setProperty('--rot', tilt(id) + 'deg');
  node.style.left = v.x + 'px';
  node.style.top = v.y + 'px';
  if (note) {
    node.style.width = v.w + 'px';
    node.style.height = v.h + 'px';
  } else {
    // надпись: размер по тексту
    node.style.fontSize = (v.data.size || 44) + 'px';
  }
  if (node.dataset.z !== String(v.z)) { node.dataset.z = v.z; queueReorder(); }

  const body = node.querySelector('.body');
  const editing = B.editing?.id === id;
  body.style.visibility = editing ? 'hidden' : '';
  body.dataset.ph = note ? 'пустая заметка' : 'надпись';
  if (!editing) body.textContent = v.data.text || '';

  // кнопка цвета автора и подпись
  let pin = node.querySelector('.pin');
  if (note) {
    if (!pin) { pin = document.createElement('i'); pin.className = 'pin'; node.append(pin); }
    pin.style.setProperty('--p', v.created_by ? memberColor(v.created_by) : '#b3261e');
    node.title = v.created_by ? memberName(v.created_by) : '';
  } else pin?.remove();

  let grip = node.querySelector('.grip');
  if (!grip && canEdit()) { grip = document.createElement('div'); grip.className = 'grip'; node.append(grip); }

  // чужая рамка: кто двигает или правит
  const hold = B.past ? null : B.holds.get(id);
  let tag = node.querySelector('.tag');
  node.classList.toggle('held', !!hold && !sel);
  if (hold) {
    node.style.setProperty('--hc', hold.color);
    if (!tag) { tag = document.createElement('div'); tag.className = 'tag'; node.append(tag); }
    tag.textContent = `${hold.name} ${hold.mode === 'edit' ? 'пишет' : 'двигает'}`;
    tag.style.transform = 'scale(var(--inv))';
  } else if (tag) tag.remove();

  renderVotes(id);
}

// Быстрый путь для перетаскивания: только координаты и размер
function moveNode(id) {
  const node = B.nodes.get(id);
  const r = B.els.get(id);
  if (!node || !r || B.past) return renderEl(id);
  node.style.left = r.x + 'px';
  node.style.top = r.y + 'px';
  if (r.type === 'note') {
    node.style.width = r.w + 'px';
    node.style.height = r.h + 'px';
  }
  queueStrings();
}

let reorderQueued = false;
function queueReorder() {
  if (reorderQueued) return;
  reorderQueued = true;
  queueMicrotask(() => { reorderQueued = false; reorder(); });
}

// Порядок наложения: по полю z, в CSS идёт номер по порядку
function reorder() {
  const list = [...B.nodes.entries()].sort((a, b) => Number(a[1].dataset.z) - Number(b[1].dataset.z));
  list.forEach(([, n], i) => { n.style.zIndex = i + 1; });
}

// ---------- Нитки ----------

// Куда крепится нитка: к кнопке заметки или к середине надписи, с учётом наклона
function anchor(id) {
  const v = viewOf(id);
  if (!v || v.type === 'link') return null;
  const node = B.nodes.get(id);
  const w = v.type === 'note' ? v.w : node?.offsetWidth || v.w;
  const h = v.type === 'note' ? v.h : node?.offsetHeight || v.h;
  const cx = v.x + w / 2, cy = v.y + h / 2;
  if (v.type !== 'note') return { x: cx, y: cy };
  const a = (Number(tilt(id)) * Math.PI) / 180;
  const dx = 0, dy = -h / 2 + 3;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

// Провисающая нитка между двумя точками
function sagPath(a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const sag = Math.min(120, d * 0.12);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + sag;
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

let stringsQueued = false;
function queueStrings() {
  if (stringsQueued) return;
  stringsQueued = true;
  requestAnimationFrame(() => { stringsQueued = false; renderStrings(); });
}

let tempEnd = null; // куда тянется нитка, пока её ведут
const strings = new Map(); // id нитки -> её SVG-узлы
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

function renderStrings() {
  const svg = $('strings');
  const seen = new Set();
  const ids = B.past ? [...B.past.keys()] : [...B.els.keys()];
  for (const id of ids) {
    const v = viewOf(id);
    if (!v || v.type !== 'link') continue;
    const a = anchor(v.data.from), b = anchor(v.data.to);
    if (!a || !b) continue;
    seen.add(id);
    let st = strings.get(id);
    if (!st) {
      const g = svgEl('g', { 'data-link': id });
      st = {
        g,
        sh: svgEl('path', { class: 'sh', transform: 'translate(1 3)' }),
        path: svgEl('path', { class: 's' }),
        c1: svgEl('circle', { r: 4 }),
        c2: svgEl('circle', { r: 4 }),
        hit: svgEl('path', { class: 'hit' }),
      };
      g.append(st.sh, st.path, st.c1, st.c2, st.hit);
      svg.append(g);
      strings.set(id, st);
    }
    const d = sagPath(a, b);
    if (st.d !== d) {
      st.d = d;
      st.sh.setAttribute('d', d);
      st.path.setAttribute('d', d);
      st.hit.setAttribute('d', d);
      st.c1.setAttribute('cx', a.x); st.c1.setAttribute('cy', a.y);
      st.c2.setAttribute('cx', b.x); st.c2.setAttribute('cy', b.y);
    }
    const col = STRING[v.data.color] || STRING.red;
    if (st.col !== col) {
      st.col = col;
      st.path.setAttribute('stroke', col);
      st.c1.setAttribute('fill', col);
      st.c2.setAttribute('fill', col);
    }
    st.g.classList.toggle('sel', B.sel.has(id));
    st.hit.style.display = B.past ? 'none' : '';
  }
  for (const [id, st] of strings) if (!seen.has(id)) { st.g.remove(); strings.delete(id); }

  // нитка, которую сейчас тянут
  let temp = svg.querySelector('.temp');
  const from = B.linkFrom && tempEnd && anchor(B.linkFrom);
  if (from) {
    if (!temp) { temp = svgEl('path', { class: 's temp', stroke: STRING.red, opacity: '.7' }); svg.append(temp); }
    temp.setAttribute('d', sagPath(from, tempEnd));
  } else temp?.remove();
}

function startLink(id) {
  B.linkFrom = id;
  renderEl(id);
}

function cancelLink() {
  const id = B.linkFrom;
  B.linkFrom = null;
  tempEnd = null;
  if (id) renderEl(id);
  queueStrings();
}

async function finishLink(to) {
  const from = B.linkFrom;
  cancelLink();
  if (!from || !to || from === to) return;
  const exists = [...B.els.values()].some((r) => r.type === 'link' && !r.deleted_at
    && ((r.data.from === from && r.data.to === to) || (r.data.from === to && r.data.to === from)));
  if (exists) return toast('Эти элементы уже связаны');
  const id = uuid();
  const row = {
    id, board_id: B.id, type: 'link', x: 0, y: 0, w: 20, h: 20, z: Date.now(), data: { from, to, color: 'red' },
    version: 0, locked: false, created_by: B.me.user_id, updated_by: B.me.user_id, deleted_at: null,
  };
  B.els.set(id, row);
  queueStrings();
  await Promise.all([B.els.get(from)?._creating, B.els.get(to)?._creating]);
  try {
    const saved = await call('el_create', { p_board: B.id, p_type: 'link', p_x: 0, p_y: 0, p_w: 20, p_h: 20, p_data: row.data, p_id: id });
    applyRemote(saved);
  } catch (err) {
    toast(err.message, true);
    B.els.delete(id);
    queueStrings();
  }
}

// ---------- Голосование ----------

const roundActive = () => !!B.round?.until && new Date(B.round.until) > Date.now();
const myVotes = () => [...B.votes.values()].filter((v) => B.round && v.round === B.round.round && !v.removed && v.user_id === B.me.user_id).length;

function renderVotes(id) {
  const node = B.nodes.get(id);
  if (!node) return;
  let box = node.querySelector('.votes');
  const list = B.past || !B.round || B.hideResults === B.round.round ? []
    : [...B.votes.values()].filter((v) => v.element_id === id && v.round === B.round.round && !v.removed);
  if (!list.length) { box?.remove(); return; }
  if (!box) { box = document.createElement('div'); box.className = 'votes'; node.append(box); }
  box.style.transform = `rotate(${-tilt(id)}deg)`;
  box.innerHTML = list.slice(0, 9).map((v) => `<i class="pinhead${v.user_id === B.me.user_id && roundActive() ? ' mine' : ''}" data-unvote="${id}"
    style="--p:${esc(memberColor(v.user_id))}" title="${esc(memberName(v.user_id))}"></i>`).join('') + `<b>${list.length}</b>`;
}

function renderVotesAll() {
  for (const id of B.nodes.keys()) renderVotes(id);
}

let voteTimer = 0;
function updateVoteBar() {
  clearInterval(voteTimer);
  const bar = $('voteBar');
  const has = B.round && [...B.votes.values()].some((v) => v.round === B.round.round && !v.removed);
  if (roundActive()) {
    const draw = () => {
      const left = Math.max(0, Math.round((new Date(B.round.until) - Date.now()) / 1000));
      if (!left) return updateVoteBar();
      const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0');
      bar.querySelector('.time').textContent = `${mm}:${ss}`;
    };
    bar.hidden = false;
    bar.innerHTML = `<span><span class="lbl-long">Голосование </span><span class="time"></span></span><span>кнопок: ${MAX_VOTES - myVotes()}</span>
      <button class="minibtn${B.tool === 'vote' ? ' go' : ''}" data-v="tool">${B.tool === 'vote' ? 'втыкаю' : 'голосовать'}</button>
      ${canEdit() ? '<button class="minibtn" data-v="stop">стоп</button>' : ''}`;
    draw();
    voteTimer = setInterval(draw, 1000);
  } else if (has && B.hideResults !== B.round.round) {
    if (B.tool === 'vote') setTool(null);
    bar.hidden = false;
    bar.innerHTML = '<span>Итоги голосования</span><button class="minibtn" data-v="hide">убрать</button>';
  } else {
    if (B.tool === 'vote') setTool(null);
    bar.hidden = true;
  }
  bar.onclick = async (e) => {
    const a = e.target.closest('[data-v]')?.dataset.v;
    if (a === 'tool') { setTool(B.tool === 'vote' ? null : 'vote'); updateVoteBar(); }
    if (a === 'stop') { try { await call('vote_stop', { p_board: B.id }); } catch (err) { toast(err.message, true); } }
    if (a === 'hide') { B.hideResults = B.round.round; updateVoteBar(); renderVotesAll(); }
  };
}

function voteAction() {
  if (roundActive()) {
    setTool(B.tool === 'vote' ? null : 'vote');
    updateVoteBar();
    if (B.tool === 'vote') toast(`Нажимайте на элементы, у вас ${MAX_VOTES - myVotes()} кнопки`);
    return;
  }
  if (!canEdit()) return toast('Голосование начинает тот, кто может править доску');
  const { root, close } = openModal(`
    <span class="tape"></span>
    <h3>Голосование кнопками</h3>
    <p>У каждого будет ${MAX_VOTES} кнопки: втыкайте в заметки, которые нравятся. Таймер видят все.</p>
    <div class="row" style="justify-content:flex-start">${[1, 3, 5, 10].map((m) => `<button class="minibtn" data-m="${m}">${m} мин</button>`).join('')}</div>
    <div class="row"><button class="minibtn" data-close>Отмена</button></div>`);
  root.onclick = async (e) => {
    if (e.target.closest('[data-close]')) return close();
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    close();
    try {
      B.round = await call('vote_start', { p_board: B.id, p_seconds: m * 60 });
      B.hideResults = null;
      setTool('vote');
      updateVoteBar();
      renderVotesAll();
    } catch (err) { toast(err.message, true); }
  };
}

async function vote(id, delta) {
  if (!roundActive()) return;
  if (delta > 0 && myVotes() >= MAX_VOTES) return toast('Кнопки закончились: выньте одну, чтобы воткнуть в другое место');
  try {
    await call('vote', { p_element: id, p_delta: delta });
  } catch (err) { toast(err.code === 'no_votes_left' ? 'Кнопки закончились' : err.message, true); }
}

// ---------- Изменения с сервера ----------

function applyRemote(row) {
  const cur = B.els.get(row.id);
  if (cur && cur.version > row.version) return;
  if (cur && B.myDrag.has(row.id)) { row = { ...row, x: cur.x, y: cur.y, w: cur.w, h: cur.h }; }
  B.els.set(row.id, row);
  if (B.editing?.id === row.id) mergeIntoEditor(row);
  if (!B.past) renderEl(row.id);
  placeSelTools();
}

function onDrag(items) {
  if (B.past) return;
  for (const [id, x, y, w, h] of items) {
    const r = B.els.get(id);
    if (!r || B.myDrag.has(id)) continue;
    Object.assign(r, { x, y, w, h });
    moveNode(id);
  }
}

// После переподключения подтянуть всё, что могли пропустить
async function resync() {
  try {
    const [els, members, rounds, votes] = await Promise.all([
      select('elements', B.id), select('members', B.id), select('rounds', B.id), select('votes', B.id),
    ]);
    for (const e of els) applyRemote(e);
    for (const m of members) onMember(m);
    B.round = rounds[0] || null;
    for (const v of votes) B.votes.set(v.id, v);
    updateVoteBar();
    renderVotesAll();
  } catch { /* повторим при следующем подключении */ }
}

// Кто-то взял или отпустил элементы
function onHold({ u, ids, m }) {
  if (u === B.me.user_id) return;
  const changed = new Set(ids);
  for (const [id, hd] of B.holds) if (hd.u === u) { B.holds.delete(id); changed.add(id); }
  const who = B.members.get(u);
  for (const id of ids) B.holds.set(id, { u, name: who?.name || 'Гость', color: who?.color || '#7a6a55', mode: m });
  for (const id of changed) renderEl(id);
}

// ---------- Создание, удаление, правка ----------

async function createEl(type, wx, wy) {
  const note = type === 'note';
  const w = note ? 200 : 300, h = note ? 170 : 50;
  const id = uuid();
  const row = {
    id, board_id: B.id, type, x: Math.round(wx - (note ? w / 2 : 12)), y: Math.round(wy - (note ? h / 2 : 25)), w, h,
    z: Date.now(), data: note ? { text: '', color: B.lastColor || 'yellow' } : { text: '', size: 44, color: 'ink' },
    version: 0, locked: false, created_by: B.me.user_id, updated_by: B.me.user_id, deleted_at: null,
  };
  B.els.set(id, row);
  B.sel = new Set([id]);
  renderEl(id);
  row._creating = call('el_create', {
    p_board: B.id, p_type: type, p_x: row.x, p_y: row.y, p_w: w, p_h: h, p_data: row.data, p_id: id,
  }).then((saved) => {
    const cur = B.els.get(id);
    if (cur && cur.version < saved.version) {
      // текст мог уже поменяться локально, его досохранит редактор
      B.els.set(id, { ...saved, data: { ...saved.data, text: cur.data.text } });
    }
    if (B.editing?.id === id && B.editing.version < saved.version) B.editing.version = saved.version;
  }).catch((err) => {
    toast(err.message, true);
    B.els.delete(id);
    renderEl(id);
  });
  startEdit(id);
  return id;
}

async function deleteSel() {
  const ids = [...B.sel];
  if (!ids.length || !canEdit()) return;
  finishEdit();
  for (const id of ids) {
    const r = B.els.get(id);
    if (r) { B.els.set(id, { ...r, deleted_at: new Date().toISOString() }); renderEl(id); }
  }
  B.sel.clear();
  placeSelTools();
  queueStrings();
  try {
    await call('el_delete', { p_ids: ids });
    toast(ids.length > 1 ? `Снято: ${ids.length}. Вернуть можно через историю` : 'Снято. Вернуть можно через историю');
  } catch (err) {
    toast(err.message, true);
    resync();
  }
}

async function patchEl(id, patch) {
  const r = B.els.get(id);
  if (!r) return;
  await r._creating;
  try {
    const res = await call('el_update', { p_id: id, p_base_version: B.els.get(id).version, p_patch: patch });
    if (res.ok) applyRemote(res.element);
  } catch (err) {
    toast(err.message, true);
    resync();
  }
}

function setColor(color) {
  for (const id of B.sel) {
    const r = B.els.get(id);
    if (!r) continue;
    const ok = (r.type === 'note' && NOTE_COLORS.includes(color)) || (r.type === 'text' && TEXT_COLORS.includes(color))
      || (r.type === 'link' && LINK_COLORS.includes(color));
    if (!ok) continue;
    if (r.type === 'note') B.lastColor = color;
    B.els.set(id, { ...r, data: { ...r.data, color } });
    renderEl(id);
    patchEl(id, { data: { color } });
  }
  placeSelTools(true);
}

function setSize(k) {
  for (const id of B.sel) {
    const r = B.els.get(id);
    if (r?.type !== 'text') continue;
    const size = Math.max(16, Math.min(160, Math.round((r.data.size || 44) * k)));
    B.els.set(id, { ...r, data: { ...r.data, size } });
    renderEl(id);
    patchEl(id, { data: { size } }).then(() => syncTextBox(id));
  }
  placeSelTools(true);
}

function bringFront() {
  for (const id of B.sel) {
    const r = B.els.get(id);
    if (!r || r.type === 'link') continue;
    B.els.set(id, { ...r, z: Date.now() });
    renderEl(id);
    patchEl(id, { z: 1 });
  }
}

// ---------- Правка текста ----------

function startEdit(id) {
  if (!canEdit()) return;
  if (B.editing?.id === id) return;
  finishEdit();
  const row = B.els.get(id);
  const node = B.nodes.get(id);
  if (!row || !node || row.type === 'link') return;
  const ta = document.createElement('textarea');
  ta.value = row.data.text || '';
  ta.maxLength = 5000;
  ta.spellcheck = true;
  ta.setAttribute('aria-label', 'Текст');
  node.append(ta);
  const ed = { id, base: ta.value, version: row.version, ta, timer: 0, saving: false, again: false };
  B.editing = ed;
  B.sel = new Set([id]);
  renderEl(id);
  sizeTextEl(ed);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('input', () => {
    sizeTextEl(ed);
    clearTimeout(ed.timer);
    ed.timer = setTimeout(() => flushText(ed), 350);
  });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') finishEdit();
  });
  ta.addEventListener('blur', () => setTimeout(() => { if (B.editing === ed && document.activeElement !== ta) finishEdit(); }, 0));
  B.live.hold([id], 'edit');
  placeSelTools();
}

// Размер надписи растёт вместе с текстом
function sizeTextEl(ed) {
  const node = B.nodes.get(ed.id);
  const row = B.els.get(ed.id);
  if (!node || row?.type !== 'text') return;
  node.querySelector('.body').textContent = ed.ta.value + '​';
  queueStrings();
}

function setEditorText(ed, text) {
  const ta = ed.ta;
  if (ta.value === text) return;
  const a = mapCaret(ta.value, text, ta.selectionStart);
  const b = mapCaret(ta.value, text, ta.selectionEnd);
  ta.value = text;
  if (document.activeElement === ta) ta.setSelectionRange(a, b);
  sizeTextEl(ed);
}

// Пришла чужая правка, пока я печатаю: сливаем тексты
function mergeIntoEditor(row) {
  const ed = B.editing;
  if (row.version <= ed.version) return;
  const theirs = row.data.text || '';
  if (theirs !== ed.base) {
    const merged = merge3(ed.base, ed.ta.value, theirs);
    setEditorText(ed, merged);
    ed.base = theirs;
    if (merged !== theirs) { clearTimeout(ed.timer); ed.timer = setTimeout(() => flushText(ed), 150); }
  }
  ed.version = row.version;
}

async function flushText(ed) {
  clearTimeout(ed.timer);
  if (ed.saving) { ed.again = true; return; }
  const text = ed.ta.value;
  if (text === ed.base) return;
  ed.saving = true;
  try {
    await B.els.get(ed.id)?._creating;
    const res = await call('el_update', { p_id: ed.id, p_base_version: ed.version, p_patch: { data: { text } } });
    const el = res.element;
    if (res.ok) {
      ed.base = text;
      ed.version = el.version;
    } else {
      // кто-то успел раньше: сливаем и отправляем ещё раз
      const theirs = el.data.text || '';
      setEditorText(ed, merge3(ed.base, ed.ta.value, theirs));
      ed.base = theirs;
      ed.version = el.version;
      ed.again = true;
    }
    const cur = B.els.get(ed.id);
    if (!cur || cur.version <= el.version) {
      B.els.set(ed.id, el);
      if (B.editing !== ed) renderEl(ed.id);
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    ed.saving = false;
    if (ed.again) { ed.again = false; flushText(ed); }
  }
}

function finishEdit() {
  const ed = B.editing;
  if (!ed) return;
  B.editing = null;
  const text = ed.ta.value;
  const row = B.els.get(ed.id);
  if (row) B.els.set(ed.id, { ...row, data: { ...row.data, text } });
  ed.ta.remove();
  flushText(ed);
  B.live.hold([], null);
  if (row?.type === 'text' && !text.trim()) {
    B.sel = new Set([ed.id]);
    deleteSel();
    return;
  }
  renderEl(ed.id);
  if (row?.type === 'text') syncTextBox(ed.id);
  placeSelTools();
}

// Запомнить размер надписи на сервере, чтобы другие считали её границы так же
function syncTextBox(id, quiet) {
  const node = B.nodes.get(id);
  const r = B.els.get(id);
  if (!node || !r || !canEdit()) return;
  const w = Math.max(20, Math.ceil(node.offsetWidth)), h = Math.max(20, Math.ceil(node.offsetHeight));
  if (Math.abs(w - r.w) > 2 || Math.abs(h - r.h) > 2) {
    if (quiet && r.created_by !== B.me.user_id) return;
    B.els.set(id, { ...r, w, h });
    patchEl(id, { w, h });
  }
}

// ---------- Полоска у выделения ----------

function placeSelTools(force) {
  const box = $('seltools');
  if (!B || !B.sel.size || B.past || !canEdit()) { box.hidden = true; return; }
  const rows = [...B.sel].map((id) => B.els.get(id)).filter((r) => r && !r.deleted_at);
  if (!rows.length) { box.hidden = true; return; }
  const types = new Set(rows.map((r) => r.type));
  const key = rows.map((r) => r.id + r.data.color + r.data.size).join();
  if (force || box.dataset.key !== key) {
    box.dataset.key = key;
    const palette = types.size === 1 ? { note: NOTE_COLORS, text: TEXT_COLORS, link: LINK_COLORS }[rows[0].type] : null;
    const cur = rows.every((r) => r.data.color === rows[0].data.color) ? rows[0].data.color : null;
    box.innerHTML = [
      palette ? palette.map((c) => `<button class="sw${c === cur ? ' on' : ''}" data-color="${c}" style="background:${types.has('link') ? STRING[c] : SWATCH[c]}" aria-label="Цвет"></button>`).join('') + '<span class="vsep"></span>' : '',
      types.size === 1 && types.has('text') ? `<button class="t" data-act="smaller" title="Мельче">${icon('smaller')}</button><button class="t" data-act="bigger" title="Крупнее">${icon('bigger')}</button><span class="vsep"></span>` : '',
      types.has('link') ? '' : `<button class="t" data-act="front" title="Наверх">${icon('front')}</button>`,
      `<button class="t danger" data-act="delete" title="Снять с доски" aria-label="Удалить">${icon('trash')}</button>`,
    ].join('');
    box.onpointerdown = (e) => e.preventDefault(); // не терять фокус редактора
    box.onclick = (e) => {
      const c = e.target.closest('[data-color]');
      if (c) return setColor(c.dataset.color);
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a === 'delete') deleteSel();
      if (a === 'front') bringFront();
      if (a === 'bigger') setSize(1.25);
      if (a === 'smaller') setSize(0.8);
    };
  }
  box.hidden = false;
  // над выделением, по центру
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rows) {
    if (r.type === 'link') {
      const a = anchor(r.data.from), b = anchor(r.data.to);
      if (!a || !b) continue;
      x1 = Math.min(x1, a.x, b.x); x2 = Math.max(x2, a.x, b.x); y1 = Math.min(y1, a.y, b.y); y2 = Math.max(y2, a.y, b.y);
      continue;
    }
    const n = B.nodes.get(r.id);
    const w = n ? n.offsetWidth : r.w, h = n ? n.offsetHeight : r.h;
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + w); y2 = Math.max(y2, r.y + h);
  }
  if (x1 === Infinity) { box.hidden = true; return; }
  const { x, y, s } = B.cam;
  const bw = box.offsetWidth, bh = box.offsetHeight;
  let left = (x1 + x2) / 2 * s + x - bw / 2;
  let top = y1 * s + y - bh - 24;
  if (top < 80) top = y2 * s + y + 24;
  left = Math.max(24, Math.min(innerWidth - bw - 24, left));
  top = Math.max(24, Math.min(innerHeight - bh - 24, top));
  box.style.left = left + 'px';
  box.style.top = top + 'px';
}

function setSelection(ids) {
  const old = B.sel;
  B.sel = new Set(ids);
  for (const id of new Set([...old, ...B.sel])) renderEl(id);
  placeSelTools();
}

// ---------- Курсоры ----------

const cursors = new Map(); // uid -> { node, x, y, t }

function drawCursor({ u, x, y }) {
  if (u === B.me.user_id) return;
  let c = cursors.get(u);
  if (!c) {
    const node = document.createElement('div');
    node.className = 'cur';
    node.innerHTML = `${CURSOR_SVG}<b></b>`;
    $('cursors').append(node);
    c = { node };
    cursors.set(u, c);
  }
  const m = B.members.get(u);
  c.node.style.setProperty('--c', m?.color || '#7a6a55');
  c.node.querySelector('b').textContent = m?.name || 'Гость';
  Object.assign(c, { x, y, t: Date.now() });
  c.node.style.opacity = 1;
  placeCursor(c);
}

function placeCursor(c) {
  c.node.style.transform = `translate(${c.x * B.cam.s + B.cam.x}px, ${c.y * B.cam.s + B.cam.y}px)`;
}

setInterval(() => {
  for (const c of cursors.values()) if (Date.now() - c.t > 10000) c.node.style.opacity = 0;
}, 2000);

// ---------- История: просмотр прошлого и откат ----------

function setPast(snap) {
  if (snap) { finishEdit(); cancelLink(); }
  B.past = snap;
  B.sel.clear();
  renderAll();
  placeSelTools();
  buildLedge();
}

async function rollback(historyId) {
  try {
    const n = await call('rollback_to', { p_board: B.id, p_history_id: historyId });
    toast(n ? `Доска возвращена, изменений: ${n}` : 'Доска уже в этом состоянии');
    return true;
  } catch (err) {
    toast(err.message, true);
    return false;
  }
}

// ---------- Круговое меню ----------

function openRadial(sx, sy, target) {
  const w = toWorld(sx, sy);
  const id = target?.id, kind = target?.kind;
  let items;
  if (kind === 'link') items = canEdit() ? [['Снять', 'del', true]] : [];
  else if (kind === 'el') {
    items = canEdit() ? [['Писать', 'edit'], ['Нитка', 'link'], ['Наверх', 'front'], ['Снять', 'del', true]] : [];
    if (roundActive()) items.push(['Голос', 'vote']);
  } else {
    items = canEdit() ? [['Заметка', 'note'], ['Надпись', 'text'], ['Сюда!', 'summon'], ['Голосо-вание', 'voting']] : [['Сюда!', 'summon']];
  }
  if (!items.length) return;
  const box = $('radial');
  const R = items.length > 3 ? 72 : 62;
  box.innerHTML = '<span class="c"></span>' + items.map(([label, act, danger], i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / items.length;
    return `<button class="s${danger ? ' danger' : ''}" data-act="${act}" style="left:${(Math.cos(a) * R).toFixed(0)}px;top:${(Math.sin(a) * R).toFixed(0)}px">${label.replace('-', '-<br>')}</button>`;
  }).join('');
  box.style.left = Math.max(110, Math.min(innerWidth - 110, sx)) + 'px';
  box.style.top = Math.max(110, Math.min(innerHeight - 110, sy)) + 'px';
  box.hidden = false;
  box.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    closeRadial();
    if (act === 'note' || act === 'text') createEl(act, w.x, w.y);
    if (act === 'summon') summon();
    if (act === 'voting') voteAction();
    if (act === 'edit') startEdit(id);
    if (act === 'link') { setTool('link'); startLink(id); }
    if (act === 'front') { setSelection([id]); bringFront(); }
    if (act === 'del') { setSelection([id]); deleteSel(); }
    if (act === 'vote') vote(id, 1);
  };
}

function closeRadial() {
  $('radial').hidden = true;
}

// ---------- Ввод: мышь, пальцы, колесо, клавиши ----------

function bindInput() {
  const stage = $('stage');
  const pts = new Map(); // активные касания
  let g = null;          // текущий жест
  let lastTap = { id: null, t: 0 };
  let longPress = 0;

  const targetOf = (e) => {
    const link = e.target.closest('[data-link]');
    if (link) return { kind: 'link', id: link.dataset.link };
    const node = e.target.closest('.el');
    if (node) return { kind: 'el', id: node.dataset.id };
    return null;
  };

  stage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (B.past) return;
    clearTimeout(longPress);
    g = null;
    openRadial(e.clientX, e.clientY, targetOf(e));
  });

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    if (e.target.tagName === 'TEXTAREA') return;
    closeRadial();
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);
    clearTimeout(longPress);

    if (pts.size === 2) {
      // два пальца: масштаб и сдвиг; начатое перетаскивание откатываем к началу
      if (g?.mode === 'drag' || g?.mode === 'resize') endGesture(true);
      manualCamera();
      const [a, b] = [...pts.values()];
      g = { mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (pts.size > 2) return;

    const t = targetOf(e);
    const id = t?.kind === 'el' ? t.id : null;
    const w = toWorld(e.clientX, e.clientY);
    const panBtn = e.button === 1 || B.past;

    // долгое нажатие пальцем открывает круговое меню
    if (e.pointerType !== 'mouse' && !B.past) {
      longPress = setTimeout(() => {
        if (g && !g.moved) {
          if (g.mode === 'drag' || g.mode === 'press') endGesture(true);
          g = null;
          openRadial(e.clientX, e.clientY, t);
        }
      }, 550);
    }

    if (!panBtn && !t && (B.tool === 'note' || B.tool === 'text') && canEdit()) {
      e.preventDefault();
      const tool = B.tool;
      setTool(null);
      createEl(tool, w.x, w.y);
      g = null;
      return;
    }

    if (B.editing && B.editing.id !== id) finishEdit();

    // голосование: тык в элемент втыкает кнопку, тык в свою кнопку вынимает
    if (!panBtn && B.tool === 'vote') {
      const un = e.target.closest('[data-unvote]');
      if (un) { vote(un.dataset.unvote, -1); g = null; return; }
      if (id) { vote(id, 1); g = null; return; }
    }

    // нитка: от первого элемента ко второму
    if (!panBtn && B.tool === 'link' && canEdit()) {
      if (id && !B.linkFrom) { startLink(id); g = { mode: 'link', sx: e.clientX, sy: e.clientY, moved: false }; return; }
      if (id && B.linkFrom) { finishLink(id); setTool(null); g = null; return; }
      if (!t) { cancelLink(); }
    }

    if (!panBtn && t?.kind === 'link' && canEdit()) {
      setSelection([t.id]);
      g = null;
      return;
    }

    if (!panBtn && id && canEdit()) {
      if (B.editing?.id === id) return;
      e.preventDefault();
      if (e.target.closest('.grip')) {
        const r = B.els.get(id);
        g = { mode: 'resize', id, sx: e.clientX, sy: e.clientY, w0: r.w, h0: r.h, moved: false };
        return;
      }
      const wasSel = B.sel.has(id);
      if (e.shiftKey) {
        const s = new Set(B.sel);
        s.has(id) ? s.delete(id) : s.add(id);
        setSelection(s);
      } else if (!wasSel) setSelection([id]);
      const start = new Map([...B.sel].filter((i) => B.els.get(i)?.type !== 'link').map((i) => [i, { x: B.els.get(i).x, y: B.els.get(i).y }]));
      g = { mode: 'press', id, wasSel, sx: e.clientX, sy: e.clientY, start, moved: false };
      return;
    }

    if (!panBtn && id && !canEdit()) setSelection([]);
    g = { mode: 'pan', sx: e.clientX, sy: e.clientY, cx: B.cam.x, cy: B.cam.y, moved: false, empty: !t };
  });

  stage.addEventListener('pointermove', (e) => {
    const w = toWorld(e.clientX, e.clientY);
    B.live.cursor(w.x, w.y);
    if (B.linkFrom) { tempEnd = w; queueStrings(); }
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!g) return;

    if (g.mode === 'pinch' && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      B.cam.x += cx - g.cx;
      B.cam.y += cy - g.cy;
      zoomAt(cx, cy, d / g.d);
      Object.assign(g, { d, cx, cy });
      return;
    }

    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 6) return;
    g.moved = true;
    clearTimeout(longPress);

    if (g.mode === 'pan') {
      manualCamera();
      stage.classList.add('panning');
      B.cam.x = g.cx + dx;
      B.cam.y = g.cy + dy;
      applyCamera();
    } else if (g.mode === 'press' || g.mode === 'drag') {
      if (g.mode === 'press') {
        g.mode = 'drag';
        for (const id of g.start.keys()) B.myDrag.add(id);
        B.live.hold([...g.start.keys()], 'move');
      }
      const items = [];
      for (const [id, p] of g.start) {
        const r = B.els.get(id);
        if (!r) continue;
        r.x = Math.round(p.x + dx / B.cam.s);
        r.y = Math.round(p.y + dy / B.cam.s);
        moveNode(id);
        items.push([id, r.x, r.y, r.w, r.h]);
      }
      B.live.drag(items);
      placeSelTools();
    } else if (g.mode === 'resize') {
      const r = B.els.get(g.id);
      if (!g.held) { g.held = true; B.myDrag.add(g.id); B.live.hold([g.id], 'move'); }
      r.w = Math.max(120, Math.round(g.w0 + dx / B.cam.s));
      r.h = Math.max(90, Math.round(g.h0 + dy / B.cam.s));
      moveNode(g.id);
      B.live.drag([[g.id, r.x, r.y, r.w, r.h]]);
      placeSelTools();
    }
  });

  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    clearTimeout(longPress);
    if (g?.mode === 'pinch') {
      if (pts.size === 0) g = null;
      else {
        const [p] = [...pts.values()];
        g = { mode: 'pan', sx: p.x, sy: p.y, cx: B.cam.x, cy: B.cam.y, moved: true };
      }
      return;
    }
    if (pts.size) return;
    if (g?.mode === 'link') {
      // отпустили над другим элементом: нитка готова; над тем же: ждём второго касания
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.el');
      if (el && el.dataset.id !== B.linkFrom) { finishLink(el.dataset.id); setTool(null); }
      g = null;
      return;
    }
    if (g?.mode === 'press' && !g.moved) {
      // касание по элементу: второй раз подряд открывает правку
      const now = Date.now();
      if ((g.wasSel && !e.shiftKey && B.sel.size === 1) || (lastTap.id === g.id && now - lastTap.t < 400)) startEdit(g.id);
      lastTap = { id: g.id, t: now };
    }
    if (g?.mode === 'pan' && !g.moved && g.empty) {
      finishEdit();
      setSelection([]);
      if (B.tool === 'link') cancelLink();
    }
    endGesture(false);
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);

  function endGesture(cancel) {
    stage.classList.remove('panning');
    if (!g) return;
    const cur = g;
    g = null;
    if (cur.mode === 'drag') {
      const moves = [];
      for (const [id, p] of cur.start) {
        const r = B.els.get(id);
        if (!r) continue;
        if (cancel) { r.x = p.x; r.y = p.y; renderEl(id); }
        moves.push({ id, x: r.x, y: r.y });
      }
      B.live.drag(moves.map((m) => [m.id, m.x, m.y, B.els.get(m.id).w, B.els.get(m.id).h]));
      B.live.hold([], null);
      const ids = [...cur.start.keys()];
      if (!cancel) {
        Promise.all(ids.map((id) => B.els.get(id)?._creating))
          .then(() => call('el_move', { p_moves: moves }))
          .catch((err) => { toast(err.message, true); resync(); })
          .finally(() => ids.forEach((id) => B.myDrag.delete(id)));
      } else ids.forEach((id) => B.myDrag.delete(id));
    }
    if (cur.mode === 'resize' && cur.held) {
      const r = B.els.get(cur.id);
      B.live.hold([], null);
      if (cancel) { r.w = cur.w0; r.h = cur.h0; renderEl(cur.id); B.myDrag.delete(cur.id); }
      else patchEl(cur.id, { w: r.w, h: r.h }).finally(() => B.myDrag.delete(cur.id));
    }
    placeSelTools();
  }

  // колесо: прокрутка, с Ctrl (и щипок на тачпаде) масштаб
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    manualCamera();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    else {
      B.cam.x -= e.deltaX;
      B.cam.y -= e.deltaY;
      applyCamera();
    }
  }, { passive: false });

  // Safari: жесты тачпада
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // клик мимо кругового меню закрывает его
  addEventListener('pointerdown', (e) => { if (!e.target.closest('#radial')) closeRadial(); }, true);

  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || !$('modal').hidden) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && B.sel.size) { e.preventDefault(); deleteSel(); }
    else if (e.key === 'Escape') {
      closeRadial();
      if (B.past) B.history.close();
      else if (B.tool) setTool(null);
      else setSelection([]);
    } else if (e.key === 'Enter' && B.sel.size === 1) { e.preventDefault(); startEdit([...B.sel][0]); }
    else if (e.key === '+' || e.key === '=') zoomAt(innerWidth / 2, innerHeight / 2, 1.25);
    else if (e.key === '-') zoomAt(innerWidth / 2, innerHeight / 2, 0.8);
    else if (e.key === '0') zoomAt(innerWidth / 2, innerHeight / 2, 1 / B.cam.s);
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && canEdit()) {
      const k = { n: 'note', t: 'text', l: 'link' }[e.key.toLowerCase()];
      if (k) setTool(B.tool === k ? null : k);
    }
  });

  addEventListener('resize', applyCamera);
}
