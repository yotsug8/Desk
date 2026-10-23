// Меню команд (Ctrl+K): одно поле, в нём действия доски и переход к заметкам и областям по тексту.
// Стрелки выбирают, Enter выполняет, Esc закрывает.
import { icon } from './icons.js';
import { esc } from './ui.js';

const KIND = { note: 'Заметка', list: 'Список', text: 'Текст', frame: 'Область', image: 'Фото' };
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');

export function openPalette({ commands, items, goTo }) {
  document.getElementById('palette')?.remove();
  const back = document.createElement('div');
  back.id = 'palette';
  back.className = 'palette-back';
  back.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Меню команд">
    <input class="pinput" placeholder="Команда или текст на доске" aria-label="Команда или текст на доске" autocomplete="off" spellcheck="false">
    <div class="plist" role="listbox"></div></div>`;
  document.body.append(back);
  const input = back.querySelector('input'), list = back.querySelector('.plist');
  const before = document.activeElement;
  let shown = [], cur = 0;

  const close = () => { back.remove(); before?.focus?.({ preventScroll: true }); };

  function render() {
    const q = norm(input.value.trim());
    const cmds = commands.filter((c) => !q || norm(c.label).includes(q));
    // элементы ищем по тексту, только когда что-то набрано
    const els = q.length < 2 ? [] : items().filter((r) => norm(r.data.text).includes(q)).slice(0, 8)
      .map((r) => ({ icon: r.type === 'image' ? 'image' : r.type, label: r.data.text.split('\n')[0].replace(/^\[[ x]\]\s*/, '').slice(0, 80), kbd: KIND[r.type] || '', run: () => goTo(r), el: true }));
    shown = [...cmds, ...els];
    cur = Math.min(cur, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length
      ? shown.map((c, i) => `<button type="button" class="pi${i === cur ? ' on' : ''}${c.el ? ' hit' : ''}" data-i="${i}" role="option" aria-selected="${i === cur}">${icon(c.icon, true)}<span>${esc(c.label)}</span>${c.kbd ? `<kbd>${esc(c.kbd)}</kbd>` : ''}</button>`).join('')
      : '<div class="pempty">Ничего не нашлось</div>';
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }

  const run = (i) => { const c = shown[i]; if (!c) return; close(); c.run(); };

  input.addEventListener('input', () => { cur = 0; render(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // горячие клавиши доски здесь не работают
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = (cur + 1) % Math.max(1, shown.length); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = (cur - 1 + shown.length) % Math.max(1, shown.length); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(cur); }
    else if (e.key === 'Escape' || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); close(); }
    else if (e.key === 'Tab') e.preventDefault();
  });
  list.addEventListener('pointermove', (e) => {
    const b = e.target.closest('[data-i]');
    if (b && Number(b.dataset.i) !== cur) { cur = Number(b.dataset.i); render(); }
  });
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) run(Number(b.dataset.i)); });
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  render();
  input.focus();
}
