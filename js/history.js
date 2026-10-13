// Панель истории: список изменений, просмотр доски в прошлом, откат
import { select } from './api.js';
import { icon } from './icons.js';
import { esc, fmtTime } from './ui.js';

const $ = (id) => document.getElementById(id);
const LIMIT = 500;

export function initHistory(B, d) {
  const panel = $('history');
  const bar = $('pastBar');
  let rows = [];         // записи истории, новые первыми
  let loaded = false;
  let groups = [];       // записи, склеенные по пачкам
  let pick = 0;          // выбранная группа, 0 = сейчас

  // Снимок элемента в том же виде, что пишет база
  const snap = (e) => ({
    type: e.type, x: e.x, y: e.y, w: e.w, h: e.h, z: e.z, data: e.data, locked: e.locked, deleted: !!e.deleted_at,
  });

  // Состояние доски сразу после записи targetId: идём от текущего назад
  function stateAt(targetId) {
    const st = new Map();
    for (const e of B.els.values()) st.set(e.id, snap(e));
    for (const r of rows) {
      if (r.id <= targetId) break;
      if (!r.element_id) continue;
      if (r.before) st.set(r.element_id, r.before);
      else st.delete(r.element_id);
    }
    for (const [id, s] of st) if (s.deleted) st.delete(id);
    return st;
  }

  function regroup() {
    groups = [];
    for (const r of rows) {
      const g = groups[groups.length - 1];
      if (g && r.batch_id && g.batch === r.batch_id) g.rows.push(r);
      else groups.push({ batch: r.batch_id, rows: [r], id: r.id, row: r });
    }
  }

  const snip = (s) => {
    const t = (s?.data?.text || '').replace(/\s+/g, ' ').trim();
    return t ? `«${t.length > 28 ? t.slice(0, 28) + '...' : t}»` : '';
  };
  const kind = (s) => ({ text: 'надпись', link: 'связь', draw: 'рисунок', list: 'список', image: 'фото', frame: 'область' }[s?.type] || 'заметка');

  function describe(g) {
    const r = g.row;
    const n = g.rows.length;
    const a = r.after, b = r.before;
    switch (r.action) {
      case 'board': return 'Доска создана';
      case 'join': return 'Вход на доску';
      case 'rename': return `Новое название «${esc(a?.title)}»`;
      case 'rollback': return n > 1 ? `Откат доски, изменений: ${n}` : 'Откат доски';
      case 'create': return a?.type === 'link' ? 'Связь между элементами' : a?.type === 'draw' ? 'Рисунок' : `Добавлено: ${kind(a)} ${esc(snip(a))}`;
      case 'delete': return n > 1 ? `Снято с доски: ${n}` : `Снято: ${esc(snip(b) || kind(b))}`;
      case 'lock': return `${a?.locked ? 'Закреплено' : 'Откреплено'}: ${esc(snip(a) || kind(a))}`;
      case 'restore': return `Возврат ${esc(snip(a) || kind(a))}`;
      case 'update': {
        const what = esc(snip(a) || kind(a));
        if (a?.data?.text !== b?.data?.text) return `Правка текста ${what}`;
        if (a?.data?.color !== b?.data?.color) return `Цвет заметки ${what}`;
        if (a?.data?.size !== b?.data?.size) return `Размер текста ${what}`;
        if (a?.w !== b?.w || a?.h !== b?.h) return `Размер ${what}`;
        if (a?.x !== b?.x || a?.y !== b?.y) return `Перемещение ${what}`;
        if (a?.z !== b?.z) return `Наверх ${what}`;
        return `Изменение ${what}`;
      }
      default: return 'Изменение';
    }
  }

  function render() {
    if (panel.hidden) return;
    const canRoll = ['owner', 'editor'].includes(B.me.role);
    panel.innerHTML = `
      <div class="hist-head">
        <h3>История<span class="sp2"></span>
          ${groups.length > 1 ? `<button type="button" data-play title="Проиграть историю" aria-label="Проиграть">${icon(playing ? 'stop' : 'play', true)}</button>` : ''}
          <button type="button" data-close aria-label="Закрыть">${icon('close', true)}</button></h3>
        <p>Выберите момент</p>
        ${groups.length > 1 ? `<div class="row"><input class="slider" type="range" min="0" max="${groups.length - 1}" value="${groups.length - 1 - pick}" aria-label="Момент в истории"></div>` : ''}
      </div>
      <div class="hist-list">${groups.length ? groups.map((g, i) => `
        <button class="ev${i === pick ? ' cur2' : ''}${i < pick ? ' fut' : ''}" data-i="${i}">
          <span class="who" style="--c:${esc(d.memberColor(g.row.user_id))}">${esc(d.memberName(g.row.user_id))}</span><span class="what">${describe(g)}</span>
          <span class="w">${fmtTime(g.row.created_at)}</span>
        </button>`).join('') : '<div class="hist-empty">Пока пусто</div>'}
      </div>`;
    panel.querySelector('[data-play]')?.addEventListener('click', () => (playing ? stopPlay() : play()));
    panel.querySelector('[data-close]').onclick = close;
    const slider = panel.querySelector('.slider');
    if (slider) slider.oninput = () => choose(groups.length - 1 - Number(slider.value), false);
    panel.querySelector('.hist-list').onclick = (e) => {
      const ev = e.target.closest('[data-i]');
      if (ev) choose(Number(ev.dataset.i), false);
    };
  }

  function choose(i, keepList) {
    pick = i;
    if (i === 0) {
      bar.hidden = true;
      d.setPast(null);
    } else {
      const g = groups[i];
      d.setPast(stateAt(g.id));
      const canRoll = ['owner', 'editor'].includes(B.me.role);
      bar.hidden = false;
      bar.innerHTML = `<span>Доска на ${esc(fmtTime(g.row.created_at))}</span>
        ${canRoll ? `<button class="minibtn go" data-go><span class="lbl-long">вернуть доску к этому моменту</span><span class="lbl-short">вернуть</span></button>` : ''}
        <button class="minibtn" data-now>сейчас</button>`;
      bar.querySelector('[data-now]').onclick = () => choose(0);
      const go = bar.querySelector('[data-go]');
      if (go) go.onclick = async () => {
        go.disabled = true;
        if (await d.rollback(g.id)) choose(0);
        else go.disabled = false;
      };
    }
    if (!keepList) {
      // перерисовать только подсветку, чтобы не сбивать прокрутку и ползунок
      panel.querySelectorAll('.ev').forEach((el) => {
        const k = Number(el.dataset.i);
        el.classList.toggle('cur2', k === pick);
        el.classList.toggle('fut', k < pick);
      });
      const slider = panel.querySelector('.slider');
      if (slider && document.activeElement !== slider) slider.value = groups.length - 1 - pick;
    }
  }

  // Проиграть историю: от самого старого загруженного момента до сейчас
  let playing = 0;
  function play() {
    if (groups.length < 2) return;
    let i = groups.length - 1;
    playing = setInterval(() => {
      i--;
      if (i <= 0) { stopPlay(); choose(0); return; }
      choose(i, false);
      panel.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
    }, Math.max(120, Math.min(500, 8000 / groups.length)));
    choose(i, false);
    render();
  }
  function stopPlay() {
    clearInterval(playing);
    playing = 0;
    render();
  }

  async function open() {
    panel.hidden = false;
    $('btnHistory').classList.add('on');
    if (!loaded) {
      panel.innerHTML = '<div class="hist-empty">Загружаю...</div>';
      const fresh = await select('history', B.id, { order: 'id', desc: true, limit: LIMIT });
      // записи, пришедшие вживую во время загрузки, не теряем
      const byId = new Map(fresh.map((r) => [r.id, r]));
      for (const r of rows) byId.set(r.id, r);
      rows = [...byId.values()].sort((a, b) => b.id - a.id);
      loaded = true;
    }
    regroup();
    pick = 0;
    render();
  }

  function close() {
    if (playing) { clearInterval(playing); playing = 0; }
    panel.hidden = true;
    bar.hidden = true;
    $('btnHistory').classList.remove('on');
    if (B.past) d.setPast(null);
    pick = 0;
  }

  // Новая или обновлённая (склеенная) запись истории
  function onRow(r) {
    if (r.action === 'rename' && r.after?.title) d.setTitle(r.after.title);
    const i = rows.findIndex((x) => x.id === r.id);
    if (i >= 0) rows[i] = r;
    else {
      rows.unshift(r);
      rows.sort((a, b) => b.id - a.id);
    }
    if (panel.hidden) return;
    const pickedId = pick ? groups[pick]?.id : null;
    regroup();
    if (pickedId) {
      pick = Math.max(0, groups.findIndex((g) => g.id === pickedId));
      if (pick) d.setPast(stateAt(pickedId));
    }
    render();
  }

  return {
    toggle: () => (panel.hidden ? open() : close()),
    close,
    onRow,
  };
}
