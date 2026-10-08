// Точка входа: стартовый экран, вход на доску по ссылке, запуск доски
import { sb, ensureUser, rpc } from './api.js';
import { esc, toast } from './ui.js';
import { startBoard } from './board.js';

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
  gate.innerHTML = `<div class="card"><span class="tape"></span>${html}</div>`;
  return gate.firstElementChild;
}

const HEAD = '<h1>Доска</h1>';

// Стартовый экран: создать доску
function landing() {
  const recent = store.get('boards', []);
  const root = showGate(`${HEAD}
    <p class="lead">Пробковая доска по ссылке. Прикалывайте заметки вместе, ничего не потеряется.</p>
    <form id="f">
      <label for="name">Ваше имя</label>
      <input id="name" class="field" maxlength="40" autocomplete="nickname" required>
      <label for="title">Название доски</label>
      <input id="title" class="field" maxlength="80" placeholder="Новая доска">
      <button class="bigbtn" type="submit">Создать доску</button>
      <div class="err" id="err" hidden></div>
    </form>
    ${recent.length ? `<div class="recent"><h2>Недавние доски</h2>${recent
      .map((b) => `<a href="?b=${esc(b.id)}">${esc(b.title)}</a>`).join('')}</div>` : ''}`);
  const name = root.querySelector('#name');
  name.value = store.get('name', '');
  (name.value ? root.querySelector('#title') : name).focus();
  root.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const btn = root.querySelector('.bigbtn');
    btn.disabled = true;
    try {
      await ensureUser();
      const n = name.value.trim();
      store.set('name', n);
      const res = await rpc('create_board', { p_title: root.querySelector('#title').value, p_name: n, p_color: myColor() });
      store.set('owner-' + res.id, res.secret);
      history.replaceState(null, '', boardUrl(res.id));
      route({ fresh: true });
    } catch (err) {
      const el = root.querySelector('#err');
      el.textContent = err.message;
      el.hidden = false;
      btn.disabled = false;
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
    showGate(`${HEAD}<p class="lead">Доска не найдена. Проверьте ссылку.</p><a class="bigbtn" style="display:block;text-align:center;text-decoration:none" href="./">Создать новую</a>`);
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
      toast('Ссылка владельца устарела или неверна', true);
    }
    info = await rpc('board_info', { p_board: id });
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
    me: info.me,
    fresh: opts.fresh,
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
    showGate(`${HEAD}<p class="lead">Сервер ещё не подключён. Загляните чуть позже.</p>`);
    return;
  }
  const id = new URLSearchParams(location.search).get('b');
  if (!id) return landing();
  try {
    await enter(id.toLowerCase(), opts);
  } catch (err) {
    showGate(`${HEAD}<p class="lead">${esc(err.message)}</p><button class="bigbtn" onclick="location.reload()">Повторить</button>`);
  }
}

route();
