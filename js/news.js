// «Что нового с прошлого раза»: при входе на доску сводка чужих изменений
// с прошлого визита и подсветка изменённых элементов.
// Помним номер последней записи истории, которую человек видел на этом компьютере.
import { sb } from './api.js';
import { esc } from './ui.js';
import { icon } from './icons.js';

const key = (id) => 'desk-seen-' + id;
const getSeen = (id) => { try { return Number(localStorage.getItem(key(id))) || 0; } catch { return 0; } };
const setSeen = (id, n) => { try { localStorage.setItem(key(id), String(n)); } catch { /* приватный режим */ } };

export function initNews(B, A) {
  const box = document.getElementById('news');
  let last = 0; // последняя известная запись истории
  let fresh = new Set();

  const save = () => { if (last) setSeen(B.id, Math.max(last, getSeen(B.id))); };
  addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

  function clear() {
    for (const id of fresh) B.nodes.get(id)?.classList.remove('fresh');
    fresh = new Set();
    box.hidden = true;
    save();
  }

  async function load() {
    const seen = getSeen(B.id);
    const top = await sb.from('history').select('id').eq('board_id', B.id).order('id', { ascending: false }).limit(1);
    last = top.data?.[0]?.id || 0;
    if (!seen) { save(); return; } // первый визит на этом компьютере: сравнивать не с чем
    const { data } = await sb.from('history').select('element_id,user_id,action')
      .eq('board_id', B.id).gt('id', seen).neq('user_id', B.me.user_id).order('id').limit(1000);
    if (!data?.length) { save(); return; }
    // по людям: сколько добавлено, изменено, снято
    const by = new Map();
    const touched = new Set();
    for (const r of data) {
      const k = { create: 'add', restore: 'add', update: 'edit', lock: 'edit', delete: 'del' }[r.action];
      if (!k) continue;
      if (!by.has(r.user_id)) by.set(r.user_id, { add: new Set(), edit: new Set(), del: new Set() });
      by.get(r.user_id)[k].add(r.element_id);
      if (k !== 'del') touched.add(r.element_id);
    }
    // одно и то же добавлено и потом поправлено: считаем добавленным
    for (const s of by.values()) for (const id of s.add) s.edit.delete(id);
    const parts = [...by].map(([u, s]) => {
      const bits = [s.add.size && `добавлено ${s.add.size}`, s.edit.size && `изменено ${s.edit.size}`, s.del.size && `снято ${s.del.size}`].filter(Boolean);
      return bits.length ? `<b>${esc(A.memberName(u))}</b>: ${bits.join(', ')}` : '';
    }).filter(Boolean);
    if (!parts.length) { save(); return; }
    fresh = new Set([...touched].filter((id) => { const r = B.els.get(id); return r && !r.deleted_at && r.type !== 'link'; }));
    for (const id of fresh) B.nodes.get(id)?.classList.add('fresh');
    box.innerHTML = `<span class="nt">С прошлого раза</span><span class="nw">${parts.join('; ')}</span>
      ${fresh.size ? '<button class="minibtn" data-show>Показать</button>' : ''}
      <button class="ib" data-x aria-label="Скрыть">${icon('close', true)}</button>`;
    box.hidden = false;
    box.querySelector('[data-show]')?.addEventListener('click', () => A.fitCamera(true, [...fresh].map((id) => B.els.get(id)).filter(Boolean)));
    box.querySelector('[data-x]').onclick = clear;
    // подсветка гаснет сама через минуту
    setTimeout(clear, 60e3);
  }

  load().catch(() => { /* без сводки доска работает как обычно */ });

  return {
    // запись истории пришла вживую: её человек уже видит
    onHistory(row) { if (row.id > last) last = row.id; },
    // элемент перерисован: подсветка не должна теряться
    isFresh: (id) => fresh.has(id),
  };
}
