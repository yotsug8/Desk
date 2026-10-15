// Перенос досок на другой компьютер без почты: короткий код на 10 минут.
// На втором компьютере человек становится участником тех же досок с теми же правами.
import { rpc, ensureUser } from './api.js';
import { openModal, toast, copyText } from './ui.js';

const KEY = 'desk-';
const get = (k, def) => { try { const v = localStorage.getItem(KEY + k); return v === null ? def : JSON.parse(v); } catch { return def; } };
const set = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch { /* приватный режим */ } };

const pretty = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;
const linkFor = (c) => `${location.origin}${location.pathname}#t=${c}`;

// Всё, что знает этот компьютер: имя, цвет, список досок и ссылки владельца
function payload() {
  const boards = get('boards', []);
  const secrets = {};
  for (const b of boards) {
    const s = get('owner-' + b.id, null);
    if (s) secrets[b.id] = s;
  }
  return { name: get('name', ''), color: get('color', ''), boards, secrets };
}

// Компьютер А: показать код
export async function transferOut() {
  const { root, close } = openModal(`
    <h3>Перенести доски на другой компьютер</h3>
    <p>Откройте сайт на другом компьютере и введите код или откройте ссылку. Код действует 10 минут, один раз.</p>
    <div class="tcode" aria-live="polite"><span class="spin" aria-label="Загрузка"></span></div>
    <div class="copyrow"><input class="field" readonly aria-label="Ссылка для переноса"><button class="minibtn" data-copy>Копировать</button></div>
    <p class="note-small" data-left></p>
    <div class="row"><button class="minibtn go" data-close>Готово</button></div>`);
  const codeEl = root.querySelector('.tcode'), input = root.querySelector('input'), left = root.querySelector('[data-left]');
  root.querySelector('[data-close]').onclick = close;
  root.querySelector('[data-copy]').onclick = async () => { await copyText(input.value); toast('Ссылка скопирована'); };
  let timer = 0;
  const make = async () => {
    clearInterval(timer);
    codeEl.innerHTML = '<span class="spin" aria-label="Загрузка"></span>';
    try {
      await ensureUser();
      const code = await rpc('transfer_create', { p_payload: payload() });
      codeEl.textContent = pretty(code);
      input.value = linkFor(code);
      const until = Date.now() + 10 * 60e3;
      const tick = () => {
        const s = Math.max(0, Math.round((until - Date.now()) / 1000));
        if (!root.isConnected) return clearInterval(timer);
        if (!s) {
          clearInterval(timer);
          codeEl.classList.add('old');
          left.innerHTML = 'Код устарел. <button class="linkbtn" data-new>Новый код</button>';
          left.querySelector('[data-new]').onclick = () => { codeEl.classList.remove('old'); make(); };
          return;
        }
        left.textContent = `Действует ещё ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      };
      tick();
      timer = setInterval(tick, 1000);
    } catch (err) {
      codeEl.textContent = '';
      left.textContent = err.message;
    }
  };
  make();
}

// Компьютер Б: принять код; возвращает число перенесённых досок или бросает ошибку
export async function claimTransfer(code) {
  await ensureUser();
  const p = await rpc('transfer_claim', { p_code: code });
  if (!p) throw new Error('Код неверный или устарел');
  if (p.name && !get('name', '')) set('name', p.name);
  if (p.color) set('color', p.color);
  for (const [id, s] of Object.entries(p.secrets || {})) set('owner-' + id, s);
  // свои и перенесённые доски вместе, свежие сверху
  const mine = get('boards', []);
  const all = new Map();
  for (const b of [...(p.boards || []), ...mine]) {
    const cur = all.get(b.id);
    if (!cur || (b.at || 0) > (cur.at || 0)) all.set(b.id, b);
  }
  set('boards', [...all.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 30));
  return (p.boards || []).length;
}

// Компьютер Б: окно для кода
export function transferIn(onDone) {
  const { root, close } = openModal(`
    <h3>Получить доски с другого компьютера</h3>
    <p>На том компьютере: меню доски, «Перенести на другой компьютер».</p>
    <form class="copyrow"><input class="field tinput" maxlength="12" placeholder="Код, например ABCD-EF23" autocomplete="off" spellcheck="false" aria-label="Код переноса" required><button class="minibtn go">Перенести</button></form>
    <p class="note-small err" hidden></p>
    <div class="row"><button class="minibtn" data-close>Отмена</button></div>`);
  const input = root.querySelector('input'), err = root.querySelector('.err'), btn = root.querySelector('form button');
  root.querySelector('[data-close]').onclick = close;
  input.focus();
  root.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    btn.disabled = true;
    err.hidden = true;
    try {
      const n = await claimTransfer(input.value);
      close();
      toast(n ? `Перенесено досок: ${n}` : 'Готово');
      onDone?.();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  };
}

// Ссылка вида #t=КОД: принимаем сразу
export async function claimFromHash() {
  const m = location.hash.match(/^#t=([A-Za-z0-9-]{8,12})$/);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const n = await claimTransfer(m[1]);
    toast(n ? `Перенесено досок: ${n}` : 'Готово');
  } catch (ex) { toast(ex.message, true); }
  return true;
}
