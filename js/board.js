// Доска: состояние, отрисовка элементов, камера, мышь и пальцы
import { rpc, select } from './api.js';
import { icon, CURSOR_SVG } from './icons.js';
import { merge3, mapCaret } from './merge.js';
import { toast, esc, openModal, copyText } from './ui.js';
import { connectLive } from './live.js';
import { initHistory } from './history.js';

const $ = (id) => document.getElementById(id);
const NOTE_COLORS = ['yellow', 'pink', 'green', 'blue'];
const SWATCH = { yellow: '#fde68a', pink: '#fbcfe8', green: '#bbf7d0', blue: '#bfdbfe' };
const GRID = 24;
const MIN_SCALE = 0.1;
const MAX_SCALE = 4;

let B; // состояние открытой доски

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
    tool: 'select',
    cam: { x: 0, y: 0, s: 1 },
    editing: null,
    holds: new Map(),      // id элемента -> { name, color, mode } от других людей
    myDrag: new Set(),     // что я сейчас тащу: чужие координаты для них не применяем
    past: null,            // снимок прошлого при просмотре истории
    pending: 0,
    online: null,          // null: ещё подключаемся
  };
  window.__desk = B; // для тестов и отладки

  $('app').hidden = false;
  buildChrome();

  const [els, members] = await Promise.all([select('elements', B.id), select('members', B.id)]);
  for (const m of members) B.members.set(m.user_id, m);
  for (const e of els) B.els.set(e.id, e);
  fitCamera();
  renderAll();
  bindInput();

  B.live = connectLive(B, {
    onElement: applyRemote,
    onMember,
    onHistory: (row) => B.history.onRow(row),
    onDrag,
    onPresence,
    onHold,
    onCursor: drawCursor,
    onStatus: (ok) => { B.online = ok; updateStatus(); },
    onResync: resync,
  });
  B.history = initHistory(B, { setPast, rollback, memberName, memberColor, setTitle });

  if (opts.fresh) inviteDialog();
}

// ---------- Верхняя панель и инструменты ----------

function buildChrome() {
  $('boardTitle').textContent = B.title;
  $('boardTitle').classList.toggle('can', isOwner());
  $('boardTitle').onclick = () => isOwner() && renameDialog();
  $('btnHistory').innerHTML = `${icon('clock', true)}<span class="lbl">История</span>`;
  $('btnInvite').innerHTML = `<span class="lbl">Пригласить</span>${icon('link', true)}`;
  $('btnInvite').onclick = inviteDialog;
  $('btnHistory').onclick = () => B.history.toggle();
  $('zoomIn').innerHTML = icon('plus');
  $('zoomOut').innerHTML = icon('minus');
  $('zoomIn').onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1.25);
  $('zoomOut').onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 0.8);
  $('zoomReset').onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1 / B.cam.s);
  buildTools();
  updateStatus();
}

function buildTools() {
  const tools = canEdit()
    ? [['select', 'Выбор'], ['hand', 'Рука'], ['note', 'Заметка'], ['text', 'Текст']]
    : [['select', 'Выбор'], ['hand', 'Рука']];
  $('tools').innerHTML = tools
    .map(([t, label]) => `<button class="t${B.tool === t ? ' on' : ''}" data-tool="${t}" title="${label}" aria-label="${label}">${icon(t)}</button>`)
    .join('');
  $('tools').onclick = (e) => {
    const b = e.target.closest('[data-tool]');
    if (b) setTool(b.dataset.tool);
  };
}

function setTool(t) {
  B.tool = t;
  for (const b of $('tools').children) b.classList.toggle('on', b.dataset.tool === t);
  $('stage').className = 'stage tool-' + t;
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
    <h3>Пригласить на доску</h3>
    <p>Все, у кого есть ссылка, смогут войти и править доску вместе с вами.</p>
    <div class="copyrow"><input class="field" readonly value="${esc(B.opts.inviteLink)}"><button class="btn" data-copy="0">Копировать</button></div>
    ${owner ? `
      <h3 style="margin-top:18px">Ссылка владельца</h3>
      <p class="note-small">Сохраните её для себя и никому не отправляйте: по ней вы вернёте права владельца с другого устройства или после очистки браузера.</p>
      <div class="copyrow"><input class="field" readonly value="${esc(owner)}"><button class="btn" data-copy="1">Копировать</button></div>` : ''}
    <div class="row"><button class="btn" data-close>Готово</button></div>`);
  root.onclick = (e) => {
    if (e.target.closest('[data-close]')) close();
    const c = e.target.closest('[data-copy]');
    if (c) copyText(c.dataset.copy === '1' ? owner : B.opts.inviteLink);
  };
}

function renameDialog() {
  const { root, close } = openModal(`
    <h3>Название доски</h3>
    <form><input class="field" maxlength="80" required value="${esc(B.title)}">
    <div class="row" style="margin-top:14px"><button type="button" class="btn" data-close>Отмена</button><button class="btn pri">Сохранить</button></div></form>`);
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

// ---------- Участники ----------

function memberName(uid) { return B.members.get(uid)?.name ?? 'Гость'; }
function memberColor(uid) { return B.members.get(uid)?.color ?? '#8a857a'; }

function onMember(m) {
  B.members.set(m.user_id, m);
  if (m.user_id === B.me.user_id) {
    const was = B.me.role;
    B.me = m;
    if (m.banned) location.reload();
    if (was !== m.role) { buildTools(); updateStatus(); }
  }
  for (const [id, row] of B.els) if (row.created_by === m.user_id) renderEl(id);
}

function onPresence(people) {
  // кто в сети
  const box = $('people');
  const list = people.filter((p) => p.u !== B.me.user_id);
  box.hidden = list.length === 0;
  const shown = list.slice(0, 4);
  box.innerHTML = shown.map((p) => `<div class="av" style="background:${esc(p.c)}" title="${esc(p.n)}">${esc((p.n || '?')[0].toUpperCase())}</div>`).join('')
    + (list.length > 4 ? `<div class="av more" style="background:#8a857a">+${list.length - 4}</div>` : '');

  // курсоры и рамки ушедших
  const alive = new Set(list.map((p) => p.u));
  for (const [u, c] of cursors) if (!alive.has(u)) { c.node.remove(); cursors.delete(u); }
  for (const [id, hd] of B.holds) if (!alive.has(hd.u)) { B.holds.delete(id); renderEl(id); }
}

// Кто-то взял или отпустил элементы
function onHold({ u, ids, m }) {
  if (u === B.me.user_id) return;
  const changed = new Set(ids);
  for (const [id, hd] of B.holds) if (hd.u === u) { B.holds.delete(id); changed.add(id); }
  const who = B.members.get(u);
  for (const id of ids) B.holds.set(id, { u, name: who?.name || 'Гость', color: who?.color || '#8a857a', mode: m });
  for (const id of changed) renderEl(id);
}

// ---------- Камера и сетка ----------

function fitCamera() {
  const live = [...B.els.values()].filter((e) => !e.deleted_at);
  if (!live.length) {
    B.cam = { x: innerWidth / 2, y: innerHeight / 2, s: 1 };
  } else {
    const x1 = Math.min(...live.map((e) => e.x)), y1 = Math.min(...live.map((e) => e.y));
    const x2 = Math.max(...live.map((e) => e.x + e.w)), y2 = Math.max(...live.map((e) => e.y + e.h));
    const s = Math.min(1, (innerWidth - 120) / (x2 - x1 + 1), (innerHeight - 160) / (y2 - y1 + 1));
    const sc = Math.max(0.25, s);
    B.cam = { s: sc, x: innerWidth / 2 - ((x1 + x2) / 2) * sc, y: innerHeight / 2 - ((y1 + y2) / 2) * sc };
  }
  applyCamera();
}

let gridQueued = false;
function applyCamera() {
  const { x, y, s } = B.cam;
  $('world').style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  $('world').style.setProperty('--inv', 1 / s);
  $('zoomReset').textContent = Math.round(s * 100) + '%';
  for (const c of cursors.values()) placeCursor(c);
  placeSelTools();
  if (!gridQueued) {
    gridQueued = true;
    requestAnimationFrame(() => { gridQueued = false; drawGrid(); });
  }
}

function drawGrid() {
  const cv = $('grid');
  const dpr = devicePixelRatio || 1;
  const w = innerWidth, h = innerHeight;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  let step = GRID * B.cam.s;
  while (step < 12) step *= 2;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--dot');
  const ox = ((B.cam.x % step) + step) % step, oy = ((B.cam.y % step) + step) % step;
  const r = Math.min(1.3, Math.max(0.8, B.cam.s * 1.2));
  for (let px = ox; px < w; px += step) {
    for (let py = oy; py < h; py += step) {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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

// ---------- Отрисовка элементов ----------

// Что показывать для элемента: текущая строка или снимок из прошлого
function viewOf(id) {
  if (B.past) {
    const s = B.past.get(id);
    return s ? { ...s, created_by: B.els.get(id)?.created_by } : null;
  }
  const r = B.els.get(id);
  return r && !r.deleted_at ? r : null;
}

function renderAll() {
  const ids = new Set([...B.els.keys(), ...(B.past ? B.past.keys() : [])]);
  for (const id of B.nodes.keys()) ids.add(id);
  for (const id of ids) renderEl(id);
  reorder();
}

function renderEl(id) {
  const v = viewOf(id);
  let node = B.nodes.get(id);
  if (!v) {
    if (node) { node.remove(); B.nodes.delete(id); }
    if (B.sel.delete(id)) placeSelTools();
    if (B.editing?.id === id) { B.editing.ta.blur(); B.editing = null; }
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
  node.className = `el ${v.type}${note ? ' c-' + (v.data.color || 'yellow') : ''}${sel ? ' sel' : ''}${sel && B.sel.size === 1 ? ' one' : ''}${B.past ? ' past' : ''}`;
  node.style.left = v.x + 'px';
  node.style.top = v.y + 'px';
  if (note) {
    node.style.width = v.w + 'px';
    node.style.height = v.h + 'px';
  } else {
    // надпись: размер по тексту
    node.style.fontSize = (v.data.size || 28) + 'px';
  }
  if (node.dataset.z !== String(v.z)) { node.dataset.z = v.z; queueReorder(); }

  const body = node.querySelector('.body');
  const editing = B.editing?.id === id;
  body.style.visibility = editing ? 'hidden' : '';
  body.dataset.ph = note ? 'Пустая заметка' : 'Текст';
  if (!editing) body.textContent = v.data.text || '';

  let meta = node.querySelector('.meta');
  if (note) {
    if (!meta) { meta = document.createElement('div'); meta.className = 'meta'; node.append(meta); }
    meta.textContent = v.created_by ? memberName(v.created_by) : '';
  } else if (meta) meta.remove();

  let grip = node.querySelector('.grip');
  if (!grip && canEdit()) { grip = document.createElement('div'); grip.className = 'grip'; node.append(grip); }

  // чужая рамка: кто двигает или правит
  const hold = B.past ? null : B.holds.get(id);
  let tag = node.querySelector('.tag');
  node.classList.toggle('held', !!hold && !sel);
  if (hold) {
    node.style.setProperty('--hc', hold.color);
    if (!tag) { tag = document.createElement('div'); tag.className = 'tag'; node.append(tag); }
    tag.textContent = `${hold.name} ${hold.mode === 'edit' ? 'правит' : 'двигает'}`;
    tag.style.transform = 'scale(var(--inv))';
  } else if (tag) tag.remove();
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
    renderEl(id);
  }
}

// После переподключения подтянуть всё, что могли пропустить
async function resync() {
  try {
    const els = await select('elements', B.id);
    for (const e of els) applyRemote(e);
    const members = await select('members', B.id);
    for (const m of members) onMember(m);
  } catch { /* повторим при следующем подключении */ }
}

// ---------- Создание, удаление, правка ----------

async function createEl(type, wx, wy) {
  const note = type === 'note';
  const w = note ? 200 : 320, h = note ? 170 : 40;
  const id = crypto.randomUUID();
  const row = {
    id, board_id: B.id, type, x: Math.round(wx - (note ? w / 2 : 12)), y: Math.round(wy - (note ? h / 2 : 20)), w, h,
    z: Date.now(), data: note ? { text: '', color: B.lastColor || 'yellow' } : { text: '', size: 28 },
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
  try {
    await call('el_delete', { p_ids: ids });
    toast(ids.length > 1 ? `Удалено: ${ids.length}. Вернуть можно через историю` : 'Удалено. Вернуть можно через историю');
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
  B.lastColor = color;
  for (const id of B.sel) {
    const r = B.els.get(id);
    if (r?.type !== 'note') continue;
    B.els.set(id, { ...r, data: { ...r.data, color } });
    renderEl(id);
    patchEl(id, { data: { color } });
  }
  placeSelTools();
}

function setSize(k) {
  for (const id of B.sel) {
    const r = B.els.get(id);
    if (r?.type !== 'text') continue;
    const size = Math.max(12, Math.min(160, Math.round((r.data.size || 28) * k)));
    B.els.set(id, { ...r, data: { ...r.data, size } });
    renderEl(id);
    patchEl(id, { data: { size } }).then(() => syncTextBox(id));
  }
  placeSelTools();
}

function bringFront() {
  for (const id of B.sel) {
    const r = B.els.get(id);
    if (!r) continue;
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
  if (!row || !node) return;
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

// Высота текстового элемента растёт вместе с текстом
function sizeTextEl(ed) {
  const node = B.nodes.get(ed.id);
  const row = B.els.get(ed.id);
  if (!node || row?.type !== 'text') return;
  node.querySelector('.body').textContent = ed.ta.value + '​';
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
function syncTextBox(id) {
  const node = B.nodes.get(id);
  const r = B.els.get(id);
  if (!node || !r) return;
  const w = Math.max(20, Math.ceil(node.offsetWidth)), h = Math.max(20, Math.ceil(node.offsetHeight));
  if (Math.abs(w - r.w) > 1 || Math.abs(h - r.h) > 1) {
    B.els.set(id, { ...r, w, h });
    patchEl(id, { w, h });
  }
}

// ---------- Панель у выделения ----------

function placeSelTools() {
  const box = $('seltools');
  if (!B || !B.sel.size || B.past || !canEdit()) { box.hidden = true; return; }
  const rows = [...B.sel].map((id) => B.els.get(id)).filter(Boolean);
  if (!rows.length) { box.hidden = true; return; }
  const notes = rows.filter((r) => r.type === 'note');
  const texts = rows.filter((r) => r.type === 'text');
  const key = rows.map((r) => r.id + r.data.color + r.data.size).join();
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    const color = notes.length && notes.every((n) => n.data.color === notes[0].data.color) ? notes[0].data.color : null;
    box.innerHTML = [
      notes.length ? NOTE_COLORS.map((c) => `<button class="sw${c === color ? ' on' : ''}" data-color="${c}" style="background:${SWATCH[c]}" aria-label="Цвет"></button>`).join('') + '<span class="vsep"></span>' : '',
      texts.length ? `<button class="t" data-act="smaller" title="Мельче">${icon('smaller')}</button><button class="t" data-act="bigger" title="Крупнее">${icon('bigger')}</button><span class="vsep"></span>` : '',
      `<button class="t" data-act="front" title="Наверх">${icon('front')}</button>`,
      `<button class="t danger" data-act="delete" title="Удалить" aria-label="Удалить">${icon('trash')}</button>`,
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
    const n = B.nodes.get(r.id);
    const h = n ? n.offsetHeight : r.h;
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + h);
  }
  const { x, y, s } = B.cam;
  const bw = box.offsetWidth, bh = box.offsetHeight;
  let left = (x1 + x2) / 2 * s + x - bw / 2;
  let top = y1 * s + y - bh - 16;
  if (top < 64) top = y2 * s + y + 16;
  left = Math.max(8, Math.min(innerWidth - bw - 8, left));
  top = Math.max(8, Math.min(innerHeight - bh - 8, top));
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
  c.node.style.setProperty('--c', m?.color || '#8a857a');
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
  if (snap) finishEdit();
  B.past = snap;
  B.sel.clear();
  renderAll();
  placeSelTools();
  buildTools();
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

// ---------- Ввод: мышь, пальцы, колесо, клавиши ----------

function bindInput() {
  const stage = $('stage');
  const pts = new Map(); // активные касания
  let g = null;          // текущий жест
  let lastTap = { id: null, t: 0 };

  stage.addEventListener('pointerdown', (e) => {
    if (e.button > 0 && e.pointerType === 'mouse' && e.button !== 1) return;
    if (e.target.tagName === 'TEXTAREA') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);

    if (pts.size === 2) {
      // два пальца: масштаб и сдвиг; начатое перетаскивание откатываем к началу
      if (g?.mode === 'drag' || g?.mode === 'resize') endGesture(true);
      const [a, b] = [...pts.values()];
      g = { mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (pts.size > 2) return;

    const node = e.target.closest('.el');
    const id = node?.dataset.id;
    const w = toWorld(e.clientX, e.clientY);
    const panBtn = e.button === 1 || B.tool === 'hand' || B.past;

    if (!panBtn && !node && (B.tool === 'note' || B.tool === 'text') && canEdit()) {
      e.preventDefault();
      const t = B.tool;
      setTool('select');
      createEl(t, w.x, w.y);
      g = null;
      return;
    }

    if (B.editing && B.editing.id !== id) finishEdit();

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
      const start = new Map([...B.sel].map((i) => [i, { x: B.els.get(i).x, y: B.els.get(i).y }]));
      g = { mode: 'press', id, wasSel, sx: e.clientX, sy: e.clientY, start, moved: false };
      return;
    }

    if (!panBtn && id && !canEdit()) setSelection([]);
    g = { mode: 'pan', sx: e.clientX, sy: e.clientY, cx: B.cam.x, cy: B.cam.y, moved: false, empty: !id };
  });

  stage.addEventListener('pointermove', (e) => {
    const w = toWorld(e.clientX, e.clientY);
    B.live.cursor(w.x, w.y);
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
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;

    if (g.mode === 'pan') {
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
        renderEl(id);
        items.push([id, r.x, r.y, r.w, r.h]);
      }
      B.live.drag(items);
      placeSelTools();
    } else if (g.mode === 'resize') {
      const r = B.els.get(g.id);
      if (!g.held) { g.held = true; B.myDrag.add(g.id); B.live.hold([g.id], 'move'); }
      r.w = Math.max(r.type === 'note' ? 80 : 40, Math.round(g.w0 + dx / B.cam.s));
      r.h = Math.max(60, Math.round(g.h0 + dy / B.cam.s));
      renderEl(g.id);
      B.live.drag([[g.id, r.x, r.y, r.w, r.h]]);
      placeSelTools();
    }
  });

  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (g?.mode === 'pinch') {
      if (pts.size === 0) g = null;
      else {
        const [p] = [...pts.values()];
        g = { mode: 'pan', sx: p.x, sy: p.y, cx: B.cam.x, cy: B.cam.y, moved: true };
      }
      return;
    }
    if (pts.size) return;
    if (g?.mode === 'press' && !g.moved) {
      // касание по элементу: второй раз подряд открывает правку
      const now = Date.now();
      if ((g.wasSel && !e.shiftKey && B.sel.size === 1) || (lastTap.id === g.id && now - lastTap.t < 400)) startEdit(g.id);
      lastTap = { id: g.id, t: now };
    }
    if (g?.mode === 'pan' && !g.moved && g.empty && B.tool === 'select') {
      finishEdit();
      setSelection([]);
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
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    else {
      B.cam.x -= e.deltaX;
      B.cam.y -= e.deltaY;
      applyCamera();
    }
  }, { passive: false });

  // Safari: жесты тачпада
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || !$('modal').hidden) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && B.sel.size) { e.preventDefault(); deleteSel(); }
    else if (e.key === 'Escape') { if (B.past) B.history.close(); else setSelection([]); }
    else if (e.key === 'Enter' && B.sel.size === 1) { e.preventDefault(); startEdit([...B.sel][0]); }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = { v: 'select', h: 'hand', n: 'note', t: 'text' }[e.key.toLowerCase()];
      if (k && (canEdit() || k === 'select' || k === 'hand')) setTool(k);
    }
  });

  addEventListener('resize', applyCamera);
}
