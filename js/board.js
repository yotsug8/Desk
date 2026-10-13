// Доска: состояние, отрисовка элементов и ниток, камера, мышь и пальцы
import { rpc, select, sb } from './api.js';
import { SERVER } from './config.js';
import { icon, toolArt, CURSOR_SVG } from './icons.js';
import { merge3, mapCaret } from './merge.js';
import { toast, esc, openModal, copyText } from './ui.js';
import { connectLive } from './live.js';
import { initHistory } from './history.js';
import { corkOn } from './cork.js';
import { initExtras, openFind, closeFind, findOpen, refreshFind, drawMinimap, exportDialog } from './extras.js';
import { canInstall, installApp } from './pwa.js';
import { initClip, duplicateSel } from './clip.js';
import { initUndo, snap, commit, justCreated, refreshTop, undo, redo, canUndo } from './undo.js';
import { initTimer, onTimer, onTimerAsk, timerDialog } from './timer.js';

const $ = (id) => document.getElementById(id);
const NOTE_COLORS = ['yellow', 'pink', 'green', 'blue', 'white'];
const TEXT_COLORS = ['ink', 'white', 'red'];
const LINK_COLORS = ['red', 'ink', 'blue', 'white'];
const DRAW_COLORS = ['white', 'ink', 'red', 'blue', 'yellow'];
const LIST_COLORS = ['white', 'yellow', 'blue'];
const FRAME_COLORS = ['white', 'yellow', 'green', 'blue', 'pink'];
const DRAW = { white: '#fdf3df', ink: '#2a1f14', red: '#b3261e', blue: '#2f5d8a', yellow: '#f6d860' };
const WIDTHS = [3, 6, 12];
const SWATCH = {
  yellow: '#f1e2a4', pink: '#efc9c4', green: '#cfe0c8', blue: '#c9dbe8', white: '#fbf9f4',
  ink: '#26221f', red: '#b8412e',
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
  return ((Math.abs(h) % 11) / 10 - 0.5).toFixed(1);
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

  const [els, members, votes, requests] = await Promise.all([
    select('elements', B.id), select('members', B.id), select('votes', B.id), select('requests', B.id),
  ]);
  B.requests = new Map(requests.filter((r) => r.status === 'pending').map((r) => [r.id, r]));
  for (const m of members) B.members.set(m.user_id, m);
  for (const e of els) B.els.set(e.id, e);
  for (const v of votes) B.votes.set(v.id, v);
  fitCamera();
  renderAll();
  bindInput();
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
    onKick: () => location.reload(),
    onVote: (v) => { B.votes.set(v.id, v); renderVotes(v.element_id); },
    onRequest: (r) => {
      if (r.status === 'pending') B.requests.set(r.id, r);
      else {
        if (B.requests.has(r.id) && r.user_id === B.me.user_id) toast(r.status === 'approved' ? 'Ваш запрос одобрен' : 'Ваш запрос отклонён');
        B.requests.delete(r.id);
      }
      renderRequests();
    },
    onStatus: (ok) => { B.online = ok; updateStatus(); },
    onResync: resync,
    onTimer,
    onTimerAsk,
  });
  B.history = initHistory(B, { setPast, rollback, memberName, memberColor, setTitle });
  initUndo(B, {
    call, applyRemote, resync,
    // дождаться, пока уйдут все начатые сохранения: отмена должна видеть итог на сервере
    idle: async () => { for (let i = 0; i < 100 && B.pending > 0; i++) await new Promise((r) => setTimeout(r, 50)); },
    refetch: async (ids) => {
      const { data } = await sb.from('elements').select('*').in('id', ids);
      (data || []).forEach(applyRemote);
    },
    local: (id, patch) => { const r = B.els.get(id); if (r) { B.els.set(id, { ...r, ...patch }); renderEl(id); } } });
  initClip(B, { toWorld, uuid, call, applyRemote, setSelection, resync, canEdit, deleteSel: (q) => deleteSel(q), snap, commit });
  initTimer(B, { openModal, myName: () => B.members.get(B.me.user_id)?.name || B.me.name || '' });
  initExtras(B, { viewOf, flyTo, applyCamera, manualCamera, openModal, anchor, smoothPath, parsePoints, imageURL, SWATCH, DRAW, STRING });

  B.loaded = true;
  renderRequests();
  setInterval(updateStatus, 30000);
  if (opts.fresh && TEMPLATES[opts.template] && canEdit()) seedBoard(opts.template).then(() => opts.template !== 'tips' && inviteDialog());
  else if (opts.fresh) inviteDialog();
}

// Заготовки новой доски
const N = (x, y, color, text, w = 210, h = 170) => ({ type: 'note', x, y, w, h, data: { text, color } });
const T = (x, y, text, size = 36) => ({ type: 'text', x, y, w: 300, h: 50, data: { text, size, color: 'ink' } });
const L = (x, y, text, color = 'white') => ({ type: 'list', x, y, w: 250, h: 160, data: { text, color } });
const TEMPLATES = {
  tips: {
    items: [
      T(-330, -330, 'Наша доска', 44),
      N(-360, -200, 'yellow', 'Дважды нажми, чтобы писать'),
      N(-90, -170, 'pink', 'Тяни заметку. Доску двигай пустым местом'),
      N(190, -210, 'green', 'Правый клик или долгое нажатие: меню'),
      N(-300, 90, 'blue', 'Зови друзей кнопкой «Пригласить»'),
      N(80, 110, 'white', 'Ctrl+Z отменит, «История» вернёт любой момент'),
    ],
    links: [[1, 2], [2, 3], [4, 5]],
  },
  kanban: {
    items: [
      T(-520, -300, 'Надо сделать'), T(-150, -300, 'В работе'), T(220, -300, 'Готово'),
      N(-520, -220, 'yellow', 'Первая задача'), N(-520, -20, 'yellow', 'Вторая задача'),
      N(-150, -220, 'blue', 'То, чем занят'), N(220, -220, 'green', 'Готовое'),
    ],
  },
  retro: {
    items: [
      T(-520, -300, 'Что было хорошо'), T(-150, -300, 'Что мешало'), T(220, -300, 'Что попробуем'),
      N(-520, -220, 'green', ''), N(-150, -220, 'pink', ''), N(220, -220, 'blue', ''),
      N(-150, 20, 'white', 'Голосуйте за важное', 210, 120),
    ],
  },
  trip: {
    items: [
      T(-420, -320, 'Поездка', 44),
      L(-420, -220, 'Взять с собой\n[ ] документы\n[ ] зарядки\n[ ] аптечка\n[ ] '),
      L(-120, -220, 'До выезда\n[ ] билеты\n[ ] жильё\n[ ] '),
      N(180, -220, 'yellow', 'Даты и место'),
      N(180, 0, 'blue', 'Кто едет'),
    ],
  },
};

async function seedBoard(name) {
  const tpl = TEMPLATES[name];
  if (!tpl) return;
  const ids = [];
  for (const it of tpl.items) {
    try {
      const saved = await call('el_create', { p_board: B.id, p_type: it.type, p_x: it.x, p_y: it.y, p_w: it.w, p_h: it.h, p_data: it.data, p_id: uuid() });
      applyRemote(saved);
      ids.push(saved.id);
      await new Promise((r) => setTimeout(r, 120));
    } catch (err) { toast(err.message, true); return; }
  }
  for (const [a, b] of tpl.links || []) {
    try {
      const saved = await call('el_create', { p_board: B.id, p_type: 'link', p_x: 0, p_y: 0, p_w: 20, p_h: 20, p_data: { from: ids[a], to: ids[b], color: 'red' }, p_id: uuid() });
      applyRemote(saved);
    } catch { /* без нитки тоже можно */ }
  }
  fitCamera(true);
}

// ---------- Верхняя строка, меню доски, панель инструментов ----------

function buildChrome() {
  $('boardTitle').textContent = B.title;
  document.title = `${B.title} · Доска`;
  $('titleLabel').classList.toggle('can', isOwner());
  $('titleLabel').onclick = () => isOwner() && renameDialog();
  $('btnInvite').innerHTML = `${icon('link', true)}<span class="lbl">Пригласить</span>`;
  $('btnInvite').onclick = inviteDialog;
  buildZoom();
  $('btnHistory').innerHTML = `${icon('clock', true)}<span class="lbl">История</span>`;
  $('btnHistory').onclick = () => B.history.toggle();
  $('btnMenu').innerHTML = icon('menu');
  $('btnMenu').onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  buildLedge();
  updateStatus();
}

// Меню доски: всё, что относится к доске целиком
function toggleMenu(force) {
  const box = $('menu');
  const open = force ?? box.hidden;
  if (!open) { box.hidden = true; return; }
  const items = [
    '#Эта доска',
    ['find', 'search', 'Найти', 'Ctrl+F'],
    ['fit', 'fit', 'Показать всю доску', ''],
    ['export', 'download', 'Скачать', ''],
    ['trash', 'trash', 'Корзина', ''],
    isOwner() ? ['rename', 'pencil', 'Переименовать', ''] : null,
    '#Вместе',
    ['summon', 'bell', 'Позвать всех сюда', ''],
    canEdit() ? ['timer', 'timer', 'Таймер', ''] : null,
    ['people', 'users', 'Участники', ''],
    '#Ещё',
    ['keys', 'keyboard', 'Горячие клавиши', ''],
    ['boards', 'grid', 'Все доски', ''],
    canInstall() ? ['install', 'install', 'Установить приложение', ''] : null,
  ].filter(Boolean);
  box.innerHTML = items.map((it) => (typeof it === 'string' ? `<div class="mh">${it.slice(1)}</div>` : `<button class="mi" data-m="${it[0]}">${icon(it[1], true)}<span>${it[2]}</span>${it[3] ? `<kbd>${it[3]}</kbd>` : ''}</button>`)).join('');
  box.hidden = false;
  box.onclick = (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    box.hidden = true;
    if (m === 'summon') summon();
    if (m === 'fit') fitCamera(true);
    if (m === 'find') openFind();
    if (m === 'timer') timerDialog();
    if (m === 'export') exportDialog();
    if (m === 'install') installApp();
    if (m === 'rename') renameDialog();
    if (m === 'keys') keysDialog();
    if (m === 'trash') trashDialog();
    if (m === 'people') peopleDialog();
    if (m === 'boards') location.href = './';
  };
}

// Корзина: снятое за 30 дней, вернуть одним нажатием
async function trashDialog() {
  let list = [];
  try { list = await call('trash_list', { p_board: B.id }); } catch (err) { return toast(err.message, true); }
  const kinds = { note: 'Заметка', text: 'Текст', list: 'Список', draw: 'Рисунок', image: 'Фото', frame: 'Область' };
  const when = (iso) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const { root, close } = openModal(`
    <h3>Корзина</h3>
    <p>Удалённое за 30 дней.</p>
    <div class="trash">${list.length ? list.map((r) => `
      <div class="tr" data-id="${r.id}">
        <span class="k">${kinds[r.type] || 'Элемент'}</span>
        <span class="tx">${esc((r.data.text || '').replace(/\[( |x)\] ?/g, '').slice(0, 60)) || '<i>без текста</i>'}</span>
        <span class="muted">${esc(memberName(r.updated_by))}, ${when(r.deleted_at)}</span>
        ${canEdit() ? '<button class="minibtn" data-back>Вернуть</button>' : ''}
      </div>`).join('') : '<div class="muted">Корзина пуста</div>'}</div>
    <div class="row"><button class="minibtn go" data-close>Закрыть</button></div>`);
  root.querySelector('[data-close]').onclick = close;
  root.onclick = async (e) => {
    const b = e.target.closest('[data-back]');
    if (!b) return;
    const row = b.closest('[data-id]');
    try {
      await call('el_restore', { p_ids: [row.dataset.id] });
      row.remove();
      toast('Возвращено');
    } catch (err) { toast(err.message, true); }
  };
}

// Участники: владелец меняет права, выгоняет и откатывает действия человека
async function peopleDialog() {
  let members = [], board = null;
  try {
    members = await select('members', B.id);
    const { data } = await sb.from('boards').select('readonly_for_new').eq('id', B.id).single();
    board = data;
  } catch (err) { return toast(err.message, true); }
  const own = isOwner();
  const online = new Set(B.people.map((p) => p.u));
  const draw = () => `
    <h3>Участники</h3>
    ${own ? `<label class="switch"><input type="checkbox" data-ro ${board?.readonly_for_new ? 'checked' : ''}> Новые гости только смотрят</label>` : ''}
    <div class="members">${members.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.joined_at.localeCompare(b.joined_at))).map((m) => `
      <div class="mr${m.banned ? ' banned' : ''}" data-u="${m.user_id}">
        <span class="av" style="--c:${esc(m.color)}">${esc((m.name || '?')[0].toUpperCase())}</span>
        <span class="nm">${esc(m.name)}${m.user_id === B.me.user_id ? ' (вы)' : ''}<small>${m.role === 'owner' ? 'владелец' : m.banned ? 'выгнан' : m.role === 'viewer' ? 'только смотрит' : 'может править'}${online.has(m.user_id) ? ', в сети' : ''}</small></span>
        ${own && m.role !== 'owner' ? `
          <button class="minibtn" data-a="role">${m.role === 'viewer' ? 'Разрешить править' : 'Только смотреть'}</button>
          <button class="minibtn" data-a="undo" title="Откатить всё, что человек сделал за сутки">Откатить</button>
          <button class="minibtn${m.banned ? '' : ' danger'}" data-a="ban">${m.banned ? 'Вернуть' : 'Выгнать'}</button>` : ''}
      </div>`).join('')}</div>
    <div class="row"><button class="minibtn go" data-close>Закрыть</button></div>`;
  const { root, close } = openModal(draw());
  root.onclick = async (e) => {
    if (e.target.closest('[data-close]')) return close();
    const ro = e.target.closest('[data-ro]');
    if (ro) {
      try { await call('set_readonly_new', { p_board: B.id, p_on: ro.checked }); board.readonly_for_new = ro.checked; } catch (err) { toast(err.message, true); ro.checked = !ro.checked; }
      return;
    }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const m = members.find((x) => x.user_id === b.closest('[data-u]').dataset.u);
    try {
      if (b.dataset.a === 'role') {
        m.role = m.role === 'viewer' ? 'editor' : 'viewer';
        await call('set_member', { p_board: B.id, p_user: m.user_id, p_role: m.role, p_banned: m.banned });
      }
      if (b.dataset.a === 'ban') {
        m.banned = !m.banned;
        await call('set_member', { p_board: B.id, p_user: m.user_id, p_role: m.role, p_banned: m.banned });
        if (m.banned) B.live.kick(m.user_id);
        toast(m.banned ? `${m.name} больше не может зайти на доску` : `${m.name} снова может зайти`);
      }
      if (b.dataset.a === 'undo') {
        if (!confirm(`Откатить все действия участника «${m.name}» за сутки? Правки других людей поверх них останутся.`)) return;
        const n = await call('undo_user', { p_board: B.id, p_user: m.user_id, p_hours: 24 });
        toast(n ? `Откатено изменений: ${n}` : 'Откатывать нечего');
      }
      root.innerHTML = draw();
    } catch (err) { toast(err.message, true); }
  };
}

function keysDialog() {
  const rows = [
    ['N', 'заметка'], ['K', 'список'], ['T', 'текст'], ['D', 'рисунок'], ['L', 'связь'], ['F', 'область'], ['P', 'фото'],
    ['Delete', 'удалить выделенное'], ['Enter', 'править выделенное'], ['Esc', 'отмена'],
    ['+  -  0', 'масштаб'], ['Shift + клик', 'выделить несколько'], ['Shift + протянуть', 'выделить рамкой'], ['Ctrl + A', 'выделить всё'], ['Ctrl + F', 'найти на доске'], ['Ctrl + Z', 'отменить'], ['Ctrl + Shift + Z', 'повторить'], ['Ctrl + C, V', 'копировать и вставить'], ['Ctrl + D', 'дублировать'], ['Стрелки', 'сдвинуть выделенное'], ['Правый клик', 'меню элемента'],
  ];
  const { root, close } = openModal(`
    <h3>Горячие клавиши</h3>
    <div class="keys">${rows.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('')}</div>
    <div class="row"><button class="minibtn go" data-close>Понятно</button></div>`);
  root.querySelector('[data-close]').onclick = close;
}

const LEDGE = [
  { tool: 'note', art: 'note', label: 'Заметка', icon: 'note', edit: true, key: 'N' },
  { tool: 'list', art: 'list', label: 'Список', icon: 'list', edit: true, key: 'K' },
  { tool: 'text', art: 'text', label: 'Текст', icon: 'text', edit: true, key: 'T' },
  { tool: 'draw', art: 'draw', label: 'Рисунок', icon: 'pencil', edit: true, key: 'D' },
  { tool: 'link', art: 'link', label: 'Связь', icon: 'connect', edit: true, key: 'L' },
  { tool: 'frame', art: 'frame', label: 'Область', icon: 'frame', edit: true, key: 'F' },
  { act: 'photo', art: 'photo', label: 'Фото', icon: 'image', edit: true, key: 'P' },
];

function buildLedge() {
  const items = LEDGE.filter((t) => !t.edit || canEdit());
  $('ledge').hidden = !items.length;
  $('ledge').innerHTML = items.map((t) => `
    <button class="tool${t.tool && B.tool === t.tool ? ' on' : ''}" type="button" ${t.tool ? `data-tool="${t.tool}"` : `data-act="${t.act}"`}
      title="${t.label} (${t.key})" aria-label="${t.label}">${toolArt(t.art)}<span>${t.label}</span></button>`).join('');
  $('ledge').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) setTool(B.tool === b.dataset.tool ? null : b.dataset.tool);
    if (b.dataset.act === 'photo') pickPhoto();
  };
}

function setTool(t) {
  B.tool = t;
  if (t !== 'link') cancelLink();
  for (const b of $('ledge').children) b.classList.toggle('on', !!t && b.dataset.tool === t);
  $('stage').className = 'stage' + (t ? ' tool-' + t : '');
  if (t === 'link') toast('Выберите два элемента');
  buildPens();
}

// ---------- Мелок ----------

const pen = (() => {
  try { return { color: 'white', width: 6, ...JSON.parse(localStorage.getItem('desk-pen') || '{}'), eraser: false }; } catch { return { color: 'white', width: 6, eraser: false }; }
})();

function buildPens() {
  const box = $('pens');
  document.body.classList.toggle('pens-open', B.tool === 'draw');
  if (B.tool !== 'draw') { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = DRAW_COLORS.map((c) => `<button class="sw${!pen.eraser && pen.color === c ? ' on' : ''}" data-pc="${c}" style="background:${DRAW[c]}" aria-label="Цвет"></button>`).join('')
    + '<span class="vsep"></span>'
    + WIDTHS.map((w) => `<button class="pw${!pen.eraser && pen.width === w ? ' on' : ''}" data-pw="${w}" aria-label="Толщина"><i style="width:${w + 2}px;height:${w + 2}px"></i></button>`).join('')
    + '<span class="vsep"></span>'
    + `<button class="minibtn${pen.eraser ? ' go' : ''}" data-er>ластик</button>`;
  box.onclick = (e) => {
    const c = e.target.closest('[data-pc]')?.dataset.pc;
    const w = e.target.closest('[data-pw]')?.dataset.pw;
    if (c) { pen.color = c; pen.eraser = false; }
    if (w) { pen.width = Number(w); pen.eraser = false; }
    if (e.target.closest('[data-er]')) pen.eraser = !pen.eraser;
    try { localStorage.setItem('desk-pen', JSON.stringify({ color: pen.color, width: pen.width })); } catch { /* не важно */ }
    buildPens();
  };
}

const parsePoints = (str) => (str || '').split(' ').map((p) => p.split(',').map(Number));

// Плавная линия через середины отрезков
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length < 3) {
    const [a, b = a] = pts;
    return `M${a[0]} ${a[1]} L${b[0] + 0.01} ${b[1]}`;
  }
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0]} ${pts[i][1]} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l[0]} ${l[1]}`;
}

// Упрощение линии (Рамер, Дуглас, Пекер): меньше точек при том же виде
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let max = 0, idx = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

// Готовую линию сохраняем отдельным элементом: её можно двигать, снимать и откатывать
async function saveStroke(raw) {
  let pts = simplify(raw, 0.8 / B.cam.s);
  if (pts.length > 1500) pts = pts.filter((_, i) => i % Math.ceil(pts.length / 1500) === 0);
  const pad = pen.width + 2;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.floor(Math.min(...xs) - pad), y = Math.floor(Math.min(...ys) - pad);
  const w = Math.max(20, Math.ceil(Math.max(...xs) + pad - x)), h = Math.max(20, Math.ceil(Math.max(...ys) + pad - y));
  const points = pts.map(([px, py]) => `${Math.round(px - x)},${Math.round(py - y)}`).join(' ');
  const id = uuid();
  const data = { points, color: pen.color, width: pen.width };
  B.els.set(id, {
    id, board_id: B.id, type: 'draw', x, y, w, h, z: Date.now(), data,
    version: 0, locked: false, created_by: B.me.user_id, updated_by: B.me.user_id, deleted_at: null,
  });
  B.quiet = true; renderEl(id); B.quiet = false;
  try {
    applyRemote(await call('el_create', { p_board: B.id, p_type: 'draw', p_x: x, p_y: y, p_w: w, p_h: h, p_data: data, p_id: id }));
    commit(new Map([[id, null]]));
  } catch (err) {
    toast(err.message, true);
    B.els.delete(id);
    renderEl(id);
  }
}

// ---------- Фото ----------

function pickPhoto() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;
  document.body.append(input);
  input.onchange = () => { if (input.files[0]) addPhoto(input.files[0]); input.remove(); };
  input.addEventListener('cancel', () => input.remove());
  input.click();
}

// Сжимаем до 1400 px по длинной стороне и кладём в хранилище доски
async function addPhoto(file, at) {
  if (!canEdit() || !file.type.startsWith('image/')) return;
  const pos = at || toWorld(innerWidth / 2, innerHeight / 2);
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k);
    cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.82));
    const src = `${B.id}/${uuid()}.jpg`;
    B.pending++; updateStatus();
    const up = await sb.storage.from('images').upload(src, blob, { contentType: 'image/jpeg', upsert: false });
    B.pending--; updateStatus();
    if (up.error) throw new Error('Не удалось загрузить фото');
    const w = 260, h = Math.round(260 * cv.height / cv.width) + 64;
    const saved = await call('el_create', {
      p_board: B.id, p_type: 'image', p_x: Math.round(pos.x - w / 2), p_y: Math.round(pos.y - h / 2), p_w: w, p_h: h,
      p_data: { src, text: '' }, p_id: uuid(),
    });
    applyRemote(saved);
    commit(new Map([[saved.id, null]]));
    setSelection([saved.id]);
  } catch (err) {
    toast(err instanceof DOMException ? 'Не получилось открыть картинку' : err.message || 'Не удалось добавить фото', true);
  }
}

// ---------- Списки ----------

// Галочка: переключаем строку; если кто-то успел поменять список, переключаем в свежем
async function toggleItem(id, idx) {
  const flip = (text) => {
    const ls = text.split('\n');
    if (ls[idx]?.startsWith('[x]')) ls[idx] = '[ ]' + ls[idx].slice(3);
    else if (ls[idx]?.startsWith('[ ]')) ls[idx] = '[x]' + ls[idx].slice(3);
    return ls.join('\n');
  };
  const r = B.els.get(id);
  if (!r || !canEdit()) return;
  const text = flip(r.data.text || '');
  const before = snap([id]);
  B.els.set(id, { ...r, data: { ...r.data, text } });
  commit(before);
  renderEl(id);
  await r._creating;
  try {
    let res = await call('el_update', { p_id: id, p_base_version: r.version, p_patch: { data: { text } } });
    if (!res.ok) res = await call('el_update', { p_id: id, p_base_version: res.element.version, p_patch: { data: { text: flip(res.element.data.text || '') } } });
    if (res.ok) applyRemote(res.element);
  } catch (err) { toast(err.message, true); resync(); }
}

const isOwner = () => B.me.role === 'owner';
// Новичок: первые 5 минут на доске можно только добавлять своё
const newbieLeft = () => (isOwner() ? 0 : Math.max(0, Math.ceil((new Date(B.me.joined_at).getTime() + 5 * 60e3 - Date.now()) / 60e3)));
// Можно ли трогать элемент: свой, или владелец, или не закреплён и не новичок
function mayTouch(r) {
  if (!r || isOwner() || r.created_by === B.me.user_id) return true;
  if (r.locked) { toast('Элемент закреплён'); return false; }
  if (newbieLeft()) { toast(`Новичкам первые 5 минут можно только добавлять своё, осталось ${newbieLeft()} мин`); return false; }
  return true;
}
const canEdit = () => ['owner', 'editor'].includes(B.me.role) && !B.past;

function updateStatus() {
  const el = $('status');
  el.classList.toggle('bad', B.online === false);
  el.classList.toggle('busy', B.online !== false && (B.online === null || B.pending > 0));
  if (B.online === null) el.textContent = 'подключаюсь';
  else if (!B.online) el.textContent = 'нет связи';
  else if (B.me.role === 'viewer') el.textContent = 'только просмотр';
  else if (newbieLeft() && !B.pending) el.textContent = `новичок, ещё ${newbieLeft()} мин`;
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
    <div class="copyrow"><input class="field" readonly value="${esc(B.opts.inviteLink)}"><button class="minibtn" data-copy="0">Копировать</button></div>
    ${owner ? `
      <h3 style="margin-top:16px">Ссылка владельца</h3>
      <p class="note-small">Только для вас: возвращает права владельца.</p>
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
  document.title = `${t} · Доска`;
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
  const before = new Set(B.people.map((p) => p.u));
  B.people = people.filter((p) => p.u !== B.me.user_id);
  const fresh = B.seenPresence ? B.people.filter((p) => !before.has(p.u)) : [];
  B.seenPresence = true;
  renderPeople(new Set(fresh.map((p) => p.u)));
  for (const p of fresh) toast(`${p.n} теперь здесь`);
  // курсоры и рамки ушедших
  const alive = new Set(B.people.map((p) => p.u));
  for (const [u, c] of cursors) if (!alive.has(u)) { c.node.remove(); cursors.delete(u); }
  for (const [id, hd] of B.holds) if (!alive.has(hd.u)) { B.holds.delete(id); renderEl(id); }
  if (B.follow && !alive.has(B.follow)) stopFollow();
}

function renderPeople(popped = new Set()) {
  $('people').innerHTML = B.people.map((p, i) => `
    <button class="av${B.follow === p.u ? ' on' : ''}${popped.has(p.u) ? ' arrive' : ''}" data-u="${esc(p.u)}" style="--c:${esc(p.c)}"
      title="${esc(p.n)}: смотреть доску глазами участника">${esc((p.n || '?')[0].toUpperCase())}</button>`).join('');
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
  toast('Все позваны');
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

function fitCamera(animated) {
  const live = [...B.els.values()].filter((e) => !e.deleted_at && e.type !== 'link');
  if (!live.length) {
    B.cam = { x: innerWidth / 2, y: innerHeight / 2, s: 1 };
    return applyCamera();
  }
  const x1 = Math.min(...live.map((e) => e.x)), y1 = Math.min(...live.map((e) => e.y));
  const x2 = Math.max(...live.map((e) => e.x + e.w)), y2 = Math.max(...live.map((e) => e.y + e.h));
  // место под верхнюю строку и полку
  const top = 70, bottom = innerHeight < 520 ? 60 : 96, side = Math.min(48, innerWidth * 0.06);
  const fit = Math.min(1, (innerWidth - side * 2) / (x2 - x1 + 1), (innerHeight - top - bottom) / (y2 - y1 + 1));
  // на телефоне мельче не уходим, иначе текст не прочесть: показываем начало доски
  const small = innerWidth < 640 || innerHeight < 520;
  const sc = Math.max(small ? 0.7 : 0.3, fit);
  let cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 + (bottom - top) / 2 / sc;
  if (sc > fit) {
    if ((x2 - x1) * sc > innerWidth - side * 2) cx = x1 - side / sc + innerWidth / 2 / sc;
    if ((y2 - y1) * sc > innerHeight - top - bottom) cy = y1 - (top + 20) / sc + innerHeight / 2 / sc;
  }
  if (animated) return flyTo(cx, cy, sc, 700);
  B.cam = { s: sc, x: innerWidth / 2 - cx * sc, y: innerHeight / 2 - cy * sc };
  applyCamera();
}

// Кнопки масштаба: минус, проценты (нажатие показывает всю доску), плюс
function buildZoom() {
  $('zoom').innerHTML = `<button class="ib minus" data-z="out" title="Мельче (−)" aria-label="Мельче">${icon('minus', true)}</button>
    <button class="pct" data-z="fit" title="Показать всю доску (0 для 100%)"></button>
    <button class="ib plus" data-z="in" title="Крупнее (+)" aria-label="Крупнее">${icon('plus', true)}</button>`;
  $('zoom').onclick = (e) => {
    const z = e.target.closest('[data-z]')?.dataset.z;
    manualCamera();
    if (z === 'in') zoomAt(innerWidth / 2, innerHeight / 2, 1.25);
    if (z === 'out') zoomAt(innerWidth / 2, innerHeight / 2, 0.8);
    if (z === 'fit') fitCamera(true);
  };
}

function applyCamera() {
  const { x, y, s } = B.cam;
  const pct = $('zoom').querySelector('.pct');
  if (pct) pct.textContent = Math.round(s * 100) + '%';
  $('world').style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  $('world').style.setProperty('--inv', 1 / s);
  corkOn($('app'), B.cam);
  for (const c of cursors.values()) placeCursor(c);
  if (!$('seltools').hidden) placeSelTools();
  const c = toWorld(innerWidth / 2, innerHeight / 2);
  B.live?.viewport(c.x, c.y, s);
  drawMinimap();
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
  B.quiet = true; // массовая перерисовка без анимаций
  for (const id of ids) renderEl(id);
  B.quiet = false;
  reorder();
  queueStrings();
}

function renderEl(id) {
  const v = viewOf(id);
  let node = B.nodes.get(id);
  queueStrings();
  if (!v || v.type === 'link') {
    if (node) {
      B.nodes.delete(id);
      if (B.quiet || B.past) node.remove();
      else {
        // снятая заметка падает с доски
        node.classList.add('fall');
        node.querySelector('.tag')?.remove();
        setTimeout(() => node.remove(), 450);
      }
    }
    if (!v && B.sel.delete(id)) placeSelTools();
    if (!v && B.editing?.id === id) { B.editing.ta.blur(); B.editing = null; }
    if (!v && B.linkFrom === id) cancelLink();
    return;
  }
  if (!node) {
    node = document.createElement('div');
    node.dataset.id = id;
    node.innerHTML = SKELETON[v.type] || '<div class="body"></div>';
    B.nodes.set(id, node);
    $('world').append(node);
    node.style.zIndex = 1e6;
    if (B.loaded && !B.quiet && !B.past) {
      node.classList.add('drop');
      node.addEventListener('animationend', () => node.classList.remove('drop'), { once: true });
    }
    queueReorder();
  }
  const t = v.type;
  const sel = B.sel.has(id);
  const color = v.data.color || DEFAULT_COLOR[t] || 'ink';
  const keep = (node.classList.contains('drop') ? ' drop' : '') + (B.myDrag.has(id) ? ' lift' : '');
  node.className = `el ${t} c-${color}${sel ? ' sel' : ''}${sel && B.sel.size === 1 ? ' one' : ''}${B.past ? ' past' : ''}${B.linkFrom === id ? ' linking' : ''}${keep}`;
  if (t !== 'draw' && t !== 'frame') node.style.setProperty('--rot', tilt(id) + 'deg');
  node.style.left = v.x + 'px';
  node.style.top = v.y + 'px';
  if (t === 'note' || t === 'draw' || t === 'frame') {
    node.style.width = v.w + 'px';
    node.style.height = v.h + 'px';
  } else if (t === 'list' || t === 'image') {
    node.style.width = v.w + 'px';
  } else {
    // надпись: размер по тексту
    node.style.fontSize = (v.data.size || 36) + 'px';
  }
  if (node.dataset.z !== String(v.z)) { node.dataset.z = v.z; queueReorder(); }

  if (t === 'draw') {
    // рисунок: путь меняем, только если поменялись точки
    const key = `${v.data.points}|${v.w}|${v.h}`;
    if (node.dataset.key !== key) {
      node.dataset.key = key;
      const svg = node.querySelector('svg');
      svg.setAttribute('viewBox', `0 0 ${v.w} ${v.h}`);
      const d = smoothPath(parsePoints(v.data.points));
      for (const p of svg.querySelectorAll('path')) p.setAttribute('d', d);
    }
    const path = node.querySelector('path.ink');
    path.setAttribute('stroke', DRAW[color] || DRAW.white);
    path.setAttribute('stroke-width', v.data.width || 6);
  } else {
    if (t === 'image') {
      const img = node.querySelector('img');
      const src = imageURL(v.data.src);
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    }
    const body = node.querySelector('.body');
    const editing = B.editing?.id === id;
    body.style.visibility = editing ? 'hidden' : '';
    body.dataset.ph = PLACEHOLDER[t] || '';
    if (!editing) {
      if (t === 'list') renderList(body, v.data.text || '');
      else body.textContent = v.data.text || '';
    }
  }

  // кнопка цвета автора
  let pin = node.querySelector('.pin');
  if (t === 'note' || t === 'list') {
    if (!pin) { pin = document.createElement('i'); pin.className = 'pin'; node.append(pin); }
    pin.style.setProperty('--p', v.created_by ? memberColor(v.created_by) : '#b3261e');
  } else pin?.remove();
  node.title = v.created_by ? memberName(v.created_by) + (v.locked ? ', закреплено' : '') : '';
  node.classList.toggle('locked', !!v.locked);
  let lockMark = node.querySelector('.lockmark');
  if (v.locked && t !== 'draw') {
    if (!lockMark) { lockMark = document.createElement('i'); lockMark.className = 'lockmark'; lockMark.innerHTML = icon('lock', true); node.append(lockMark); }
  } else lockMark?.remove();

  let grip = node.querySelector('.grip');
  if (!grip && canEdit() && (t === 'note' || t === 'list' || t === 'image' || t === 'frame')) {
    grip = document.createElement('div'); grip.className = 'grip'; node.append(grip);
  }

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

// Заготовки разметки для типов элементов
const SKELETON = {
  draw: '<svg class="ink-svg"><path class="hit"/><path class="ink"/></svg>',
  list: '<div class="body list-body"></div>',
  frame: '<div class="ftitle edit-host"><div class="body"></div></div>',
  image: '<span class="tape"></span><img alt="" draggable="false"><div class="cap edit-host"><div class="body"></div></div>',
};
const DEFAULT_COLOR = { note: 'yellow', text: 'ink', list: 'white', draw: 'white', frame: 'white' };
const PLACEHOLDER = { note: 'пустая заметка', text: 'надпись', list: 'список', image: 'подпись', frame: 'область' };

// Список: строки «[ ] дело» и «[x] дело» становятся галочками, остальные заголовками
function renderList(body, text) {
  body.innerHTML = text.split('\n').map((line, i) => {
    const m = line.match(/^\[( |x)\] ?(.*)$/);
    if (!m) return line.trim() ? `<div class="lh">${esc(line)}</div>` : '';
    return `<div class="li${m[1] === 'x' ? ' done' : ''}"><i class="box" data-li="${i}"></i><span>${esc(m[2]) || '&nbsp;'}</span></div>`;
  }).join('');
}

const imageURL = (src) => `${SERVER.url}/storage/v1/object/public/images/${src}`;

// Быстрый путь для перетаскивания: только координаты и размер
function moveNode(id) {
  const node = B.nodes.get(id);
  const r = B.els.get(id);
  if (!node || !r || B.past) return renderEl(id);
  node.style.left = r.x + 'px';
  node.style.top = r.y + 'px';
  if (r.type === 'note' || r.type === 'frame') {
    node.style.width = r.w + 'px';
    node.style.height = r.h + 'px';
  } else if (r.type === 'list' || r.type === 'image') node.style.width = r.w + 'px';
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
  const under = (n) => (n.classList.contains('frame') ? 0 : 1);
  const list = [...B.nodes.entries()].sort((a, b) => under(a[1]) - under(b[1]) || Number(a[1].dataset.z) - Number(b[1].dataset.z));
  list.forEach(([, n], i) => { n.style.zIndex = i + 1; });
}

// ---------- Нитки ----------

// Куда крепится нитка: к кнопке заметки или к середине надписи, с учётом наклона
function anchor(id) {
  const v = viewOf(id);
  if (!v || v.type === 'link') return null;
  const node = B.nodes.get(id);
  const w = v.type === 'note' || v.type === 'draw' ? v.w : node?.offsetWidth || v.w;
  const h = v.type === 'note' || v.type === 'draw' ? v.h : node?.offsetHeight || v.h;
  const cx = v.x + w / 2, cy = v.y + h / 2;
  if (!['note', 'list', 'image'].includes(v.type)) return { x: cx, y: cy };
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
  requestAnimationFrame(() => { stringsQueued = false; renderStrings(); drawMinimap(); refreshFind(); });
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

  // пустая доска: подсказка мелом к полочке
  const empty = !B.past && canEdit() && ![...B.els.values()].some((r) => !r.deleted_at && r.type !== 'link');
  $('hint').hidden = !empty;

  // нитка, которую сейчас тянут
  let temp = svg.querySelector('.temp');
  const from = B.linkFrom && tempEnd && anchor(B.linkFrom);
  if (from) {
    if (!temp) { temp = svgEl('path', { class: 's temp', stroke: STRING.red, opacity: '.7' }); svg.append(temp); }
    temp.setAttribute('d', sagPath(from, tempEnd));
  } else temp?.remove();
}

// Линия мелка, пока её ведут: рисуем в слое ниток, без сохранения
function drawTemp(pts) {
  const svg = $('strings');
  let p = svg.querySelector('.temp-ink');
  if (!pts) { p?.remove(); return; }
  if (!p) { p = svgEl('path', { class: 'ink temp-ink' }); svg.append(p); }
  p.setAttribute('stroke', DRAW[pen.color] || DRAW.white);
  p.setAttribute('stroke-width', pen.width);
  p.setAttribute('d', smoothPath(pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])));
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
    commit(new Map([[id, null]]));
  } catch (err) {
    toast(err.message, true);
    B.els.delete(id);
    queueStrings();
  }
}

// ---------- Голосование ----------
// Один голос человека на элемент: «Голос» в меню элемента или нажатие на счётчик

const votesOf = (id) => [...B.votes.values()].filter((v) => v.element_id === id && v.round === 0 && !v.removed);

function renderVotes(id) {
  const node = B.nodes.get(id);
  if (!node) return;
  let box = node.querySelector('.votes');
  const list = B.past ? [] : votesOf(id);
  if (!list.length) { box?.remove(); return; }
  if (!box) { box = document.createElement('button'); box.type = 'button'; box.className = 'votes'; node.append(box); }
  const mine = list.some((v) => v.user_id === B.me.user_id);
  box.dataset.vote = id;
  box.classList.toggle('mine', mine);
  box.title = list.map((v) => memberName(v.user_id)).join(', ');
  box.innerHTML = `${icon('thumb', true)}<b>${list.length}</b>`;
}

function renderVotesAll() {
  for (const id of B.nodes.keys()) renderVotes(id);
}

async function lockEl(id) {
  const r = B.els.get(id);
  if (!r) return;
  try {
    applyRemote(await call('el_lock', { p_id: id, p_locked: !r.locked }));
    toast(r.locked ? 'Откреплено' : 'Закреплено: менять могут только автор и владелец');
  } catch (err) { toast(err.message, true); }
}

async function voteToggle(id) {
  try {
    await call('vote_toggle', { p_element: id });
  } catch (err) { toast(err.message, true); }
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
    const [els, members, votes] = await Promise.all([
      select('elements', B.id), select('members', B.id), select('votes', B.id),
    ]);
    for (const e of els) applyRemote(e);
    for (const m of members) onMember(m);
    for (const v of votes) B.votes.set(v.id, v);
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
  const frame = type === 'frame';
  const note = type === 'note' || type === 'list' || frame;
  const w = frame ? 640 : type === 'list' ? 240 : note ? 200 : 300, h = frame ? 420 : type === 'list' ? 160 : note ? 170 : 50;
  const id = uuid();
  const row = {
    id, board_id: B.id, type, x: Math.round(wx - (note ? w / 2 : 12)), y: Math.round(wy - (note ? h / 2 : 25)), w, h,
    z: Date.now(), data: frame ? { text: '', color: 'white' } : type === 'list' ? { text: 'Список\n[ ] ', color: 'white' }
      : note ? { text: '', color: B.lastColor || 'yellow' } : { text: '', size: 36, color: 'ink' },
    version: 0, locked: false, created_by: B.me.user_id, updated_by: B.me.user_id, deleted_at: null,
  };
  B.els.set(id, row);
  B.sel = new Set([id]);
  renderEl(id);
  // запись об отмене сразу, до ответа сервера: иначе правка текста встанет раньше создания
  commit(new Map([[id, null]]));
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

async function deleteSel(quiet) {
  const ids = [...B.sel];
  if (!ids.length || !canEdit()) return;
  if (!ids.every((id) => mayTouch(B.els.get(id)))) return;
  finishEdit();
  const before = snap(ids);
  for (const id of ids) {
    const r = B.els.get(id);
    if (r) { B.els.set(id, { ...r, deleted_at: new Date().toISOString() }); renderEl(id); }
  }
  B.sel.clear();
  placeSelTools();
  queueStrings();
  commit(before);
  try {
    await call('el_delete', { p_ids: ids });
    if (!quiet) undoChip(ids);
  } catch (err) {
    resync();
    if (err.code === 'mass_limit') askApproval('delete', ids, ids.length);
    else toast(err.message, true);
  }
}

// Выделение плюс всё, что лежит внутри выделенных областей (по центру элемента)
function withContents(ids) {
  const out = new Set(ids);
  for (const id of ids) {
    const f = B.els.get(id);
    if (f?.type !== 'frame' || f.deleted_at) continue;
    for (const r of B.els.values()) {
      if (r.deleted_at || r.type === 'link' || r.type === 'frame' || out.has(r.id) || !mayTouch(r)) continue;
      const n = B.nodes.get(r.id);
      const cx = r.x + (n?.offsetWidth || r.w) / 2, cy = r.y + (n?.offsetHeight || r.h) / 2;
      if (cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h) out.add(r.id);
    }
  }
  return out;
}

// Правка на телефоне: клавиатура съедает низ экрана, сдвигаем доску так,
// чтобы элемент был виден над ней и в читаемом размере
function keepInView(id) {
  const fix = () => {
    const node = B.nodes.get(id);
    if (!node || B.editing?.id !== id) return;
    const vv = window.visualViewport;
    const vh = vv ? vv.height : innerHeight, vt = vv ? vv.offsetTop : 0;
    const r = node.getBoundingClientRect();
    const small = innerWidth < 640;
    const s = small && B.cam.s < 0.9 ? 1 : B.cam.s;
    const k = s / B.cam.s;
    const w = r.width * k, h = r.height * k;
    // куда поставить элемент: под верхней строкой, по центру по горизонтали, если не влезает
    const wantTop = vt + 64;
    const fits = r.top >= vt + 56 && r.top + Math.min(h, 160) <= vt + vh - 12 && r.left >= 4 && r.right <= innerWidth - 4;
    if (fits && k === 1) return;
    const wx = (r.left - B.cam.x) / B.cam.s, wy = (r.top - B.cam.y) / B.cam.s;
    const sx = w < innerWidth - 16 ? (innerWidth - w) / 2 : 8;
    manualCamera();
    B.cam = { s, x: sx - wx * s, y: wantTop - wy * s };
    applyCamera();
  };
  fix();
  // клавиатура выезжает не сразу
  if (matchMedia('(pointer: coarse)').matches) setTimeout(fix, 350);
}

// Сдвиг стрелками: двигаем сразу, сохраняем одной пачкой, когда клавиши отпустили
let nudgeTimer = 0, nudgeFrom = null;
function nudge([dx, dy]) {
  const rows = [...withContents(B.sel)].map((id) => B.els.get(id)).filter((r) => r && !r.deleted_at && r.type !== 'link' && mayTouch(r));
  if (!rows.length) return;
  if (!nudgeFrom) nudgeFrom = snap(rows.map((r) => r.id));
  for (const r of rows) {
    r.x += dx;
    r.y += dy;
    B.myDrag.add(r.id);
    moveNode(r.id);
  }
  placeSelTools();
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => {
    commit(nudgeFrom);
    nudgeFrom = null;
    const moves = rows.map((r) => ({ id: r.id, x: r.x, y: r.y }));
    B.live.drag(rows.map((r) => [r.id, r.x, r.y, r.w, r.h]));
    call('el_move', { p_moves: moves })
      .catch((err) => {
        resync();
        if (err.code === 'mass_limit') askApproval('move', moves, moves.length);
        else toast(err.message, true);
      })
      .finally(() => rows.forEach((r) => B.myDrag.delete(r.id)));
  }, 350);
}

// Крупное действие с чужими элементами: предлагаем отправить на одобрение
function askApproval(kind, payload, n) {
  const { root, close } = openModal(`
    <h3>Нужно одобрение</h3>
    <p>Больше 10 чужих элементов за минуту ${kind === 'delete' ? 'удаляются' : 'двигаются'} только с одобрения участников.</p>
    <div class="row"><button class="minibtn" data-close>Отмена</button><button class="minibtn go" data-send>Запросить</button></div>`);
  root.querySelector('[data-close]').onclick = close;
  root.querySelector('[data-send]').onclick = async () => {
    close();
    try {
      await call('request_mass', { p_board: B.id, p_kind: kind, p_payload: payload });
      toast(`Запрос отправлен: ${n} элементов ждут одобрения`);
    } catch (err) { toast(err.message, true); }
  };
}

// Запросы на одобрение видны всем; решать может владелец или другой участник, не новичок
function renderRequests() {
  const box = $('requests');
  const list = [...B.requests.values()].sort((a, b) => a.id - b.id);
  box.hidden = !list.length || !!B.past;
  if (box.hidden) { box.innerHTML = ''; return; }
  box.innerHTML = list.slice(0, 3).map((r) => {
    const mine = r.user_id === B.me.user_id;
    const canDecide = canEdit() && (isOwner() || (!mine && !newbieLeft()));
    return `<div class="req" data-r="${r.id}">
      ${icon('alert', true)}<span><b>${esc(memberName(r.user_id))}</b> хочет ${r.kind === 'delete' ? 'удалить' : 'сдвинуть'} ${r.n} эл.</span>
      <button class="minibtn" data-ra="show">Показать</button>
      ${canDecide ? '<button class="minibtn go" data-ra="yes">Разрешить</button><button class="minibtn" data-ra="no">Отклонить</button>' : `<span class="muted">${mine ? 'ждёт одобрения' : ''}</span>`}
    </div>`;
  }).join('');
  box.onclick = async (e) => {
    const b = e.target.closest('[data-ra]');
    if (!b) return;
    const r = B.requests.get(Number(b.closest('[data-r]').dataset.r));
    if (!r) return;
    if (b.dataset.ra === 'show') {
      const ids = r.kind === 'delete' ? r.payload : r.payload.map((m) => m.id);
      setSelection(ids.filter((id) => B.els.get(id) && !B.els.get(id).deleted_at));
      const rows = ids.map((id) => B.els.get(id)).filter(Boolean);
      if (rows.length) {
        const x = rows.reduce((a, q) => a + q.x + q.w / 2, 0) / rows.length, y = rows.reduce((a, q) => a + q.y + q.h / 2, 0) / rows.length;
        flyTo(x, y, Math.min(1, B.cam.s), 500);
      }
      return;
    }
    try {
      await call('decide_request', { p_id: r.id, p_approve: b.dataset.ra === 'yes' });
      toast(b.dataset.ra === 'yes' ? 'Разрешено' : 'Отклонено');
    } catch (err) { toast(err.message, true); }
  };
}

// Маленький ярлычок у полочки: снятое можно сразу вернуть
let undoTimer = 0;
function undoChip(ids) {
  const box = $('undo');
  // в общей стопке с уведомлениями, чтобы не ложиться друг на друга
  if (box.parentElement !== $('toasts')) $('toasts').prepend(box);
  box.innerHTML = `<span>${ids.length > 1 ? `снято: ${ids.length}` : 'снято'}</span><button class="minibtn" type="button">вернуть</button>`;
  box.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { box.hidden = true; }, 5000);
  box.querySelector('button').onclick = () => {
    box.hidden = true;
    undo();
  };
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
  const before = snap(B.sel);
  for (const id of B.sel) {
    const r = B.els.get(id);
    if (!r) continue;
    const ok = ({ note: NOTE_COLORS, text: TEXT_COLORS, link: LINK_COLORS, draw: DRAW_COLORS, list: LIST_COLORS, frame: FRAME_COLORS }[r.type] || []).includes(color);
    if (!ok) continue;
    if (r.type === 'note') B.lastColor = color;
    B.els.set(id, { ...r, data: { ...r.data, color } });
    renderEl(id);
    patchEl(id, { data: { color } });
  }
  commit(before);
  placeSelTools(true);
}

function setSize(k) {
  const before = snap(B.sel);
  for (const id of B.sel) {
    const r = B.els.get(id);
    if (r?.type !== 'text') continue;
    const size = Math.max(16, Math.min(160, Math.round((r.data.size || 44) * k)));
    B.els.set(id, { ...r, data: { ...r.data, size } });
    renderEl(id);
    patchEl(id, { data: { size } }).then(() => syncTextBox(id));
  }
  commit(before);
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
  if (!mayTouch(B.els.get(id))) return;
  finishEdit();
  const row = B.els.get(id);
  const node = B.nodes.get(id);
  if (!row || !node || row.type === 'link') return;
  const ta = document.createElement('textarea');
  ta.value = row.data.text || '';
  ta.maxLength = row.type === 'frame' ? 80 : 5000;
  ta.spellcheck = true;
  ta.setAttribute('aria-label', 'Текст');
  (node.querySelector('.edit-host') || node).append(ta);
  const ed = { id, base: ta.value, version: row.version, ta, timer: 0, saving: false, again: false, before: snap([id]) };
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
    if (e.key === 'Enter' && row.type === 'frame') { e.preventDefault(); finishEdit(); }
    // в списке Enter после пункта сразу начинает новый пункт
    if (e.key === 'Enter' && row.type === 'list' && !e.shiftKey) {
      const before = ta.value.slice(0, ta.selectionStart);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      if (/^\[( |x)\]/.test(line)) {
        e.preventDefault();
        if (line.trim().length <= 3) {
          // пустой пункт: выходим из списка
          ta.setRangeText('', ta.selectionStart - line.length, ta.selectionStart, 'end');
        } else ta.setRangeText('\n[ ] ', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input'));
      }
    }
  });
  ta.addEventListener('blur', () => setTimeout(() => { if (B.editing === ed && document.activeElement !== ta) finishEdit(); }, 0));
  B.live.hold([id], 'edit');
  document.body.classList.add('editing');
  keepInView(id);
  placeSelTools();
}

// Размер надписи растёт вместе с текстом
function sizeTextEl(ed) {
  const node = B.nodes.get(ed.id);
  const row = B.els.get(ed.id);
  if (!node || !['text', 'list', 'image', 'frame'].includes(row?.type)) return;
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
  document.body.classList.remove('editing');
  const text = ed.ta.value;
  const row = B.els.get(ed.id);
  if (row) B.els.set(ed.id, { ...row, data: { ...row.data, text } });
  if (justCreated(ed.id)) refreshTop(ed.id);
  else commit(ed.before);
  ed.ta.remove();
  flushText(ed);
  B.live.hold([], null);
  if (row?.type === 'text' && !text.trim()) {
    B.sel = new Set([ed.id]);
    deleteSel(true);
    return;
  }
  renderEl(ed.id);
  if (['text', 'list', 'image'].includes(row?.type)) syncTextBox(ed.id);
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
    const palette = types.size === 1 ? { note: NOTE_COLORS, text: TEXT_COLORS, link: LINK_COLORS, draw: DRAW_COLORS, list: LIST_COLORS, frame: FRAME_COLORS }[rows[0].type] : null;
    const tone = (c) => (types.has('link') ? STRING[c] : types.has('draw') ? DRAW[c] : SWATCH[c]);
    const cur = rows.every((r) => r.data.color === rows[0].data.color) ? rows[0].data.color : null;
    box.innerHTML = [
      palette ? palette.map((c) => `<button class="sw${c === cur ? ' on' : ''}" data-color="${c}" style="background:${tone(c)}" aria-label="Цвет"></button>`).join('') + '<span class="vsep"></span>' : '',
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

// ---------- Контекстное меню ----------

function openCtx(sx, sy, target) {
  const w = toWorld(sx, sy);
  const id = target?.id, kind = target?.kind;
  let items;
  if (kind === 'link') items = canEdit() ? [['del', 'trash', 'Удалить связь', 'Del']] : [];
  else if (kind === 'el') {
    const voted = votesOf(id).some((v) => v.user_id === B.me.user_id);
    items = [[ 'vote', 'thumb', voted ? 'Убрать голос' : 'Голосовать', '' ]];
    if (canEdit()) {
      items.unshift(['edit', 'pencil', 'Править', 'Enter']);
      const r = B.els.get(id);
      const mayLock = r && (isOwner() || r.created_by === B.me.user_id);
      items.push(['dup', 'copy', 'Дублировать', 'Ctrl+D'], ['link', 'connect', 'Связать с...', 'L']);
      if (mayLock) items.push(['lock', 'lock', r.locked ? 'Открепить' : 'Закрепить', '']);
      items.push('-', ['del', 'trash', 'Удалить', 'Del']);
    }
  } else {
    items = canEdit()
      ? [['note', 'note', 'Заметка', 'N'], ['list', 'list', 'Список', 'K'], ['text', 'text', 'Текст', 'T'], ['photo', 'image', 'Фото', 'P'], ['frame', 'frame', 'Область', 'F'],
        ...(canUndo() ? ['-', ['undo', 'undo', 'Отменить', 'Ctrl+Z']] : [])]
      : [['fit', 'fit', 'Показать всю доску', '']];
  }
  if (!items.length) return;
  const box = $('ctx');
  box.innerHTML = items.map((it) => (it === '-' ? '<hr>'
    : `<button class="mi${it[0] === 'del' ? ' danger' : ''}" data-act="${it[0]}">${icon(it[1], true)}<span>${it[2]}</span>${it[3] ? `<kbd>${it[3]}</kbd>` : ''}</button>`)).join('');
  box.hidden = false;
  const bw = box.offsetWidth, bh = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(innerWidth - bw - 8, sx)) + 'px';
  box.style.top = Math.max(8, Math.min(innerHeight - bh - 8, sy)) + 'px';
  box.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    closeCtx();
    if (act === 'note' || act === 'text' || act === 'list' || act === 'frame') createEl(act, w.x, w.y);
    if (act === 'photo') pickPhoto();
    if (act === 'summon') summon();
    if (act === 'fit') fitCamera(true);
    if (act === 'edit') startEdit(id);
    if (act === 'link') { setTool('link'); startLink(id); }
    if (act === 'front') { setSelection([id]); bringFront(); }
    if (act === 'dup') { if (!B.sel.has(id)) setSelection([id]); duplicateSel(); }
    if (act === 'del') { setSelection([id]); deleteSel(); }
    if (act === 'vote') voteToggle(id);
    if (act === 'lock') lockEl(id);
    if (act === 'undo') undo();
  };
}

function closeCtx() {
  $('ctx').hidden = true;
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

  // ластик: линии мелка под пальцем помечаются и снимаются разом при отпускании
  const eraseAt = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.el.draw');
    if (!el || el.classList.contains('erasing')) return;
    el.classList.add('erasing');
    g.ids.add(el.dataset.id);
  };

  stage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (B.past) return;
    clearTimeout(longPress);
    g = null;
    openCtx(e.clientX, e.clientY, targetOf(e));
  });

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    if (e.target.tagName === 'TEXTAREA') return;
    closeCtx();
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);
    clearTimeout(longPress);

    if (pts.size === 2) {
      // два пальца: масштаб и сдвиг; начатое перетаскивание откатываем к началу
      if (g?.mode === 'drag' || g?.mode === 'resize') endGesture(true);
      if (g?.mode === 'stroke') drawTemp(null);
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
    if (e.pointerType !== 'mouse' && !B.past && B.tool !== 'draw') {
      longPress = setTimeout(() => {
        if (g && !g.moved) {
          if (g.mode === 'drag' || g.mode === 'press') endGesture(true);
          g = null;
          openCtx(e.clientX, e.clientY, t);
        }
      }, 550);
    }

    // галочка в списке
    const box = e.target.closest('[data-li]');
    if (!panBtn && box && canEdit() && !B.tool) {
      const elId = box.closest('.el').dataset.id;
      if (B.editing?.id !== elId) { toggleItem(elId, Number(box.dataset.li)); g = null; return; }
    }

    // мелок рисует поверх всего, ластик стирает линии мелка
    if (!panBtn && B.tool === 'draw' && canEdit()) {
      e.preventDefault();
      if (B.editing) finishEdit();
      if (pen.eraser) { g = { mode: 'erase', ids: new Set() }; eraseAt(e); return; }
      g = { mode: 'stroke', pts: [[w.x, w.y]] };
      drawTemp(g.pts);
      return;
    }

    if (!panBtn && !t && ['note', 'text', 'list', 'frame'].includes(B.tool) && canEdit()) {
      e.preventDefault();
      const tool = B.tool;
      setTool(null);
      createEl(tool, w.x, w.y);
      g = null;
      return;
    }

    if (B.editing && B.editing.id !== id) finishEdit();

    // голосование: тык в элемент втыкает кнопку, тык в свою кнопку вынимает
    const vb = e.target.closest('[data-vote]');
    if (!panBtn && vb) { voteToggle(vb.dataset.vote); g = null; return; }

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
      if (!mayTouch(B.els.get(id))) { setSelection([id]); g = null; return; }
      const wasSel = B.sel.has(id);
      if (e.shiftKey) {
        const s = new Set(B.sel);
        s.has(id) ? s.delete(id) : s.add(id);
        setSelection(s);
      } else if (!wasSel) setSelection([id]);
      const start = new Map([...withContents(B.sel)].filter((i) => B.els.get(i)?.type !== 'link').map((i) => [i, { x: B.els.get(i).x, y: B.els.get(i).y }]));
      g = { mode: 'press', id, wasSel, sx: e.clientX, sy: e.clientY, start, moved: false };
      return;
    }

    // Shift + протяжка по пустому месту: выделение рамкой
    if (!panBtn && !t && e.shiftKey && !B.tool) {
      e.preventDefault();
      g = { mode: 'box', sx: e.clientX, sy: e.clientY, keep: new Set(B.sel), moved: false };
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

    if (g.mode === 'stroke') {
      // промежуточные точки быстрых движений, чтобы линия была гладкой
      for (const ev of e.getCoalescedEvents?.() || [e]) {
        const q = toWorld(ev.clientX, ev.clientY);
        const last = g.pts[g.pts.length - 1];
        if (Math.hypot(q.x - last[0], q.y - last[1]) * B.cam.s > 1.5) g.pts.push([q.x, q.y]);
      }
      drawTemp(g.pts);
      return;
    }
    if (g.mode === 'erase') { eraseAt(e); return; }

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

    if (g.mode === 'box') {
      let box = $('boxsel');
      if (!box) { box = document.createElement('div'); box.id = 'boxsel'; box.className = 'boxsel'; $('app').append(box); }
      const x1 = Math.min(g.sx, e.clientX), y1 = Math.min(g.sy, e.clientY);
      Object.assign(box.style, { left: x1 + 'px', top: y1 + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
      const a = toWorld(x1, y1), b = toWorld(Math.max(g.sx, e.clientX), Math.max(g.sy, e.clientY));
      const hit = [...B.els.values()].filter((r) => {
        if (r.deleted_at || r.type === 'link') return false;
        const n = B.nodes.get(r.id);
        const w = n?.offsetWidth || r.w, h = n?.offsetHeight || r.h;
        // область выделяется, только если попала целиком, остальное достаточно задеть
        return r.type === 'frame'
          ? r.x >= a.x && r.y >= a.y && r.x + w <= b.x && r.y + h <= b.y
          : r.x < b.x && r.x + w > a.x && r.y < b.y && r.y + h > a.y;
      }).map((r) => r.id);
      setSelection(new Set([...g.keep, ...hit]));
    } else if (g.mode === 'pan') {
      manualCamera();
      stage.classList.add('panning');
      B.cam.x = g.cx + dx;
      B.cam.y = g.cy + dy;
      applyCamera();
    } else if (g.mode === 'press' || g.mode === 'drag') {
      if (g.mode === 'press') {
        g.mode = 'drag';
        for (const id of g.start.keys()) { B.myDrag.add(id); B.nodes.get(id)?.classList.add('lift'); }
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
      const min = r.type === 'frame' ? [200, 140] : [120, 90];
      r.w = Math.min(4000, Math.max(min[0], Math.round(g.w0 + dx / B.cam.s)));
      r.h = Math.min(4000, Math.max(min[1], Math.round(g.h0 + dy / B.cam.s)));
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
    if (g?.mode === 'stroke') {
      const raw = g.pts;
      g = null;
      drawTemp(null);
      saveStroke(raw.length === 1 ? [raw[0], raw[0]] : raw);
      return;
    }
    if (g?.mode === 'erase') {
      const ids = [...g.ids];
      g = null;
      if (ids.length) { B.sel = new Set(ids); deleteSel(); }
      return;
    }
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
    $('boxsel')?.remove();
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
      if (!cancel) commit(new Map(ids.filter((id) => B.els.get(id)).map((id) => [id, { ...B.els.get(id), ...cur.start.get(id) }])));
      if (!cancel) {
        Promise.all(ids.map((id) => B.els.get(id)?._creating))
          .then(() => call('el_move', { p_moves: moves }))
          .catch((err) => {
            resync();
            if (err.code === 'mass_limit') askApproval('move', moves, moves.length);
            else toast(err.message, true);
          })
          .finally(() => ids.forEach((id) => B.myDrag.delete(id)));
      } else ids.forEach((id) => B.myDrag.delete(id));
      ids.forEach((id) => B.nodes.get(id)?.classList.remove('lift'));
    }
    if (cur.mode === 'resize' && cur.held) {
      const r = B.els.get(cur.id);
      B.live.hold([], null);
      if (cancel) { r.w = cur.w0; r.h = cur.h0; renderEl(cur.id); B.myDrag.delete(cur.id); }
      else {
        commit(new Map([[cur.id, { ...r, w: cur.w0, h: cur.h0 }]]));
        patchEl(cur.id, { w: r.w, h: r.h }).finally(() => B.myDrag.delete(cur.id));
      }
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

  // фото из буфера обмена и перетаскиванием файла на доску
  addEventListener('paste', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); addPhoto(f); }
  });
  stage.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  stage.addEventListener('drop', (e) => {
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); addPhoto(f, toWorld(e.clientX, e.clientY)); }
  });

  // Safari: жесты тачпада
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // клик мимо кругового меню закрывает его
  addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#ctx')) closeCtx();
    if (!e.target.closest('#menu, #btnMenu')) $('menu').hidden = true;
  }, true);

  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && $('modal').hidden && !B.editing) {
      e.preventDefault();
      return openFind();
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || !$('modal').hidden) return;
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      if (!canEdit() || B.past) return;
      return e.key.toLowerCase() === 'y' || e.shiftKey ? redo() : undo();
    }
    if (e.key === '/') { e.preventDefault(); openFind(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelection([...B.els.values()].filter((r) => !r.deleted_at && r.type !== 'link').map((r) => r.id));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateSel();
    } else if (e.key.startsWith('Arrow') && B.sel.size && canEdit() && !B.past) {
      e.preventDefault();
      const step = e.shiftKey ? 20 : 2;
      nudge({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && B.sel.size) { e.preventDefault(); deleteSel(); }
    else if (e.key === 'Escape') {
      closeCtx();
      $('menu').hidden = true;
      if (findOpen()) closeFind();
      else if (B.past) B.history.close();
      else if (B.tool) setTool(null);
      else setSelection([]);
    } else if (e.key === 'Enter' && B.sel.size === 1) { e.preventDefault(); startEdit([...B.sel][0]); }
    else if (e.key === '+' || e.key === '=') zoomAt(innerWidth / 2, innerHeight / 2, 1.25);
    else if (e.key === '-') zoomAt(innerWidth / 2, innerHeight / 2, 0.8);
    else if (e.key === '0') zoomAt(innerWidth / 2, innerHeight / 2, 1 / B.cam.s);
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && canEdit()) {
      const key = e.key.toLowerCase();
      if (key === 'p') return pickPhoto();
      const k = { n: 'note', t: 'text', l: 'link', k: 'list', d: 'draw', f: 'frame' }[key];
      if (k) setTool(B.tool === k ? null : k);
    }
  });

  addEventListener('resize', applyCamera);
}
