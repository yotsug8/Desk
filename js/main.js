// Точка входа: стартовый экран, вход на доску по ссылке, запуск доски
import { sb, ensureUser, rpc } from './api.js';
import { esc, toast } from './ui.js';
import { startBoard } from './board.js';
import { corkOn } from './cork.js';
import './pwa.js';
import { transferIn, transferOut, claimFromHash } from './transfer.js';

// все модули загрузились: сторож загрузки в index.html больше не нужен
window.__deskBooted = true;
try { sessionStorage.removeItem('desk-reboot'); } catch { /* приватный режим */ }

const gate = document.getElementById('gate');
const PEOPLE_COLORS = ['#e4572e', '#2a9d8f', '#7b61ff', '#d17a00', '#c2185b', '#1e88e5', '#43a047', '#6d4c41'];

const store = {
  get(k, def = null) {
    try { const v = localStorage.getItem('desk-' + k); return v === null ? def : JSON.parse(v); } catch { return def; }
  },
  set(k, v) {
    try { localStorage.setItem('desk-' + k, JSON.stringify(v)); } catch { /* приватный режим */ }
  },
};

function myColor() {
  let c = store.get('color');
  if (!c) {
    c = PEOPLE_COLORS[Math.floor(Math.random() * PEOPLE_COLORS.length)];
    store.set('color', c);
  }
  return c;
}

function rememberBoard(id, title) {
  const list = store.get('boards', []).filter((b) => b.id !== id);
  list.unshift({ id, title, at: Date.now() });
  store.set('boards', list.slice(0, 12));
}

function boardUrl(id, secret) {
  const u = new URL(location.pathname, location.origin);
  u.searchParams.set('b', id);
  if (secret) u.searchParams.set('owner', secret);
  return u.toString();
}

function showGate(html) {
  document.getElementById('app').hidden = true;
  gate.hidden = false;
  corkOn(gate);
  gate.innerHTML = `<div class="card">${html}</div>`;
  return gate.querySelector('.card');
}

const HEAD = `<h1><svg viewBox="0 0 512 512" aria-hidden="true"><defs><clipPath id="over"><rect x="266" y="166" width="80" height="80"/></clipPath></defs><rect width="512" height="512" rx="114" fill="#1f1a17"/><rect x="106" y="106" width="200" height="200" rx="38" fill="none" stroke="#e0533a" stroke-width="40"/><rect x="206" y="206" width="200" height="200" rx="38" fill="none" stroke="#1f1a17" stroke-width="60"/><rect x="206" y="206" width="200" height="200" rx="38" fill="none" stroke="#f4ecdc" stroke-width="40"/><g clip-path="url(#over)"><rect x="106" y="106" width="200" height="200" rx="38" fill="none" stroke="#1f1a17" stroke-width="60"/><rect x="106" y="106" width="200" height="200" rx="38" fill="none" stroke="#e0533a" stroke-width="40"/></g></svg>Доска</h1>`;

// Заготовки новой доски: значение, название, пояснение
const TEMPLATES = [
  ['tips', 'Подсказки', 'как пользоваться'],
  ['empty', 'Пусто', 'чистая доска'],
  ['kanban', 'Задачи', 'сделать, в работе, готово'],
  ['retro', 'Обсуждение', 'хорошо, мешало, идеи'],
  ['trip', 'Поездка', 'списки вещей и дел'],
];


// Стартовый экран: создать доску
function landing() {
  const recent = store.get('boards', []);
  const root = showGate(`${HEAD}
    <p class="lead">Общая доска по ссылке.</p>
    <form id="f">
      <label for="name">Ваше имя</label>
      <input id="name" class="field" maxlength="40" autocomplete="nickname" required>
      <label for="title">Название доски</label>
      <input id="title" class="field" maxlength="80" placeholder="Новая доска">
      <label>С чего начать</label>
      <div class="tpls" role="radiogroup">${TEMPLATES.map(([v, t, d], i) => `
        <label class="tpl"><input type="radio" name="tpl" value="${v}"${i === 0 ? ' checked' : ''}><b>${t}</b><small>${d}</small></label>`).join('')}
      </div>
      <button class="bigbtn" type="submit">Создать доску</button>
      <div class="err" id="err" hidden></div>
    </form>
    ${recent.length ? `<div class="recent"><h2>Недавние доски</h2>${recent
      .map((b) => `<a href="?b=${esc(b.id)}">${esc(b.title)}</a>`).join('')}</div>` : ''}
    <div class="tlinks">
      ${recent.length ? '<button type="button" class="linkbtn" data-tout>Перенести доски на другой компьютер</button>' : ''}
      <button type="button" class="linkbtn" data-tin>У меня есть код с другого компьютера</button>
    </div>`);
  root.querySelector('[data-tin]').onclick = () => transferIn(() => landing());
  root.querySelector('[data-tout]')?.addEventListener('click', () => transferOut());
  const name = root.querySelector('#name');
  name.value = store.get('name', '');
  (name.value ? root.querySelector('#title') : name).focus();
  root.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const btn = root.querySelector('.bigbtn');
    btn.disabled = true;
    btn.textContent = 'Создаю…';
    try {
      await ensureUser();
      const n = name.value.trim();
      store.set('name', n);
      const tpl = root.querySelector('[name=tpl]:checked').value;
      // пустое название берём из заготовки
      const title = root.querySelector('#title').value.trim() || ({ kanban: 'Задачи', retro: 'Обсуждение', trip: 'Поездка' }[tpl] ?? '');
      const res = await rpc('create_board', { p_title: title, p_name: n, p_color: myColor() });
      store.set('owner-' + res.id, res.secret);
      history.replaceState(null, '', boardUrl(res.id));
      route({ fresh: true, template: tpl });
    } catch (err) {
      const el = root.querySelector('#err');
      el.textContent = err.message;
      el.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Создать доску';
    }
  };
}

// Вход на доску по ссылке: спросить имя, если человек здесь впервые
async function enter(id, opts) {
  await ensureUser();
  const url = new URL(location.href);
  const secret = url.searchParams.get('owner');
  if (secret) {
    url.searchParams.delete('owner');
    history.replaceState(null, '', url);
  }

  let info = await rpc('board_info', { p_board: id });
  if (!info) {
    showGate(`${HEAD}<p class="lead">Доска не найдена.</p><a class="bigbtn" style="display:block;text-align:center;text-decoration:none" href="./">Создать новую</a>`);
    return;
  }

  if (secret && (!info.me || info.me.role !== 'owner')) {
    if (!info.me) {
      const n = store.get('name') || 'Владелец';
      await rpc('join_board', { p_board: id, p_name: n, p_color: myColor() });
    }
    if (await rpc('claim_owner', { p_board: id, p_secret: secret })) {
      store.set('owner-' + id, secret);
      toast('Вы снова владелец доски');
    } else {
      toast('Ссылка владельца неверна', true);
    }
    info = await rpc('board_info', { p_board: id });
  }

  // перенесённая с другого компьютера ссылка владельца: права владельца переходят сюда молча
  const kept = !secret && store.get('owner-' + id);
  if (kept && info.me && !info.me.banned && info.me.role !== 'owner') {
    if (await rpc('claim_owner', { p_board: id, p_secret: kept }).catch(() => false)) info = await rpc('board_info', { p_board: id });
  }

  if (info.me?.banned) {
    showGate(`${HEAD}<p class="lead">Владелец закрыл вам доступ к доске «${esc(info.title)}».</p>`);
    return;
  }

  if (!info.me) {
    const root = showGate(`${HEAD}
      <p class="lead">Вас пригласили на доску «${esc(info.title)}»${info.readonly_for_new ? '. Новые гости могут только смотреть.' : '.'}</p>
      <form id="f">
        <label for="name">Как вас называть</label>
        <input id="name" class="field" maxlength="40" autocomplete="nickname" required>
        <button class="bigbtn" type="submit">Войти на доску</button>
        <div class="err" id="err" hidden></div>
      </form>`);
    const name = root.querySelector('#name');
    name.value = store.get('name', '');
    name.focus();
    await new Promise((resolve) => {
      root.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const n = name.value.trim();
          store.set('name', n);
          await rpc('join_board', { p_board: id, p_name: n, p_color: myColor() });
          resolve();
        } catch (err) {
          const el = root.querySelector('#err');
          el.textContent = err.message;
          el.hidden = false;
        }
      };
    });
    info = await rpc('board_info', { p_board: id });
  }

  rememberBoard(id, info.title);
  gate.hidden = true;
  await startBoard({
    id,
    title: info.title,
    bg: info.bg,
    me: info.me,
    fresh: opts.fresh,
    template: opts.template,
    ownerLink: () => {
      const s = store.get('owner-' + id);
      return s ? boardUrl(id, s) : null;
    },
    inviteLink: boardUrl(id),
    onTitle: (t) => rememberBoard(id, t),
  });
}

async function route(opts = {}) {
  if (!sb) {
    showGate(`${HEAD}<p class="lead">Сервер недоступен.</p>`);
    return;
  }
  await claimFromHash();
  const id = new URLSearchParams(location.search).get('b');
  if (!id) return landing();
  try {
    await enter(id.toLowerCase(), opts);
  } catch (err) {
    if (!navigator.onLine) {
      // без сети доску не открыть: ждём связь и пробуем сами
      showGate(`${HEAD}<p class="lead">Нет интернета. Доска откроется, когда связь вернётся.</p>`);
      addEventListener('online', () => location.reload(), { once: true });
      return;
    }
    showGate(`${HEAD}<p class="lead">${esc(err.message)}</p><button class="bigbtn" onclick="location.reload()">Повторить</button>`);
  }
}

route();
