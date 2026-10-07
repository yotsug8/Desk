// Уведомления и окна
const toasts = document.getElementById('toasts');
const modal = document.getElementById('modal');

export function toast(text, bad = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = text;
  toasts.append(el);
  setTimeout(() => el.remove(), bad ? 5000 : 2500);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Открыть окно с готовой разметкой. Возвращает корневую карточку и функцию закрытия.
export function openModal(html) {
  modal.innerHTML = `<div class="card" role="dialog">${html}</div>`;
  modal.hidden = false;
  const close = () => { modal.hidden = true; modal.innerHTML = ''; };
  modal.onclick = (e) => { if (e.target === modal) close(); };
  return { root: modal.firstElementChild, close };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Ссылка скопирована');
  } catch {
    toast('Не удалось скопировать, выделите и скопируйте вручную', true);
  }
}

// Время события: сегодня, вчера или дата
export function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 864e5;
  if (diff === 0) return `сегодня, ${hm}`;
  if (diff === 1) return `вчера, ${hm}`;
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${hm}`;
}
