// Уведомления и окна
const toasts = document.getElementById('toasts');
const modal = document.getElementById('modal');

export function toast(text, bad = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  if (bad) el.setAttribute('role', 'alert');
  el.textContent = text;
  toasts.append(el);
  setTimeout(() => el.remove(), bad ? 5000 : 2500);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Открыть окно с готовой разметкой. Возвращает корневую карточку и функцию закрытия.
// Escape закрывает, Tab ходит только внутри окна, после закрытия фокус возвращается.
export function openModal(html) {
  const prev = document.activeElement;
  modal.innerHTML = `<div class="card" role="dialog" aria-modal="true" tabindex="-1">${html}</div>`;
  modal.hidden = false;
  const root = modal.firstElementChild;
  const h = root.querySelector('h3');
  if (h) { h.id = 'modal-title'; root.setAttribute('aria-labelledby', 'modal-title'); }
  const close = () => {
    modal.hidden = true;
    modal.innerHTML = '';
    modal.onkeydown = null;
    if (prev?.isConnected) prev.focus({ preventScroll: true });
  };
  modal.onclick = (e) => { if (e.target === modal) close(); };
  modal.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...root.querySelectorAll('button, input, select, textarea, a[href]')].filter((x) => !x.disabled && x.offsetParent);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  // фокус в окно: на поле ввода, если есть, иначе на само окно (без случайного нажатия кнопки)
  requestAnimationFrame(() => {
    const field = root.querySelector('input:not([readonly]), textarea');
    (field || root).focus({ preventScroll: true });
  });
  return { root, close };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Ссылка скопирована');
  } catch {
    toast('Не удалось скопировать', true);
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
