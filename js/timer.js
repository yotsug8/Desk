// Общий таймер доски: виден всем, кто сейчас на доске
import { icon } from './icons.js';
import { toast } from './ui.js';

const $ = (id) => document.getElementById(id);
let B, A;
let end = 0, total = 0, by = '', tick = 0;

export function initTimer(board, api) {
  B = board;
  A = api;
  $('timer').onclick = (e) => { if (e.target.closest('[data-stop]')) stop(true); };
}

// Сообщение от другого участника: сколько осталось и кто запустил
export function onTimer(p) {
  if (!p.left) { if (end) { toast(`${p.by || 'Кто-то'} остановил таймер`); } clear(); return; }
  run(p.left, p.total, p.by);
}

// Новичок спрашивает, идёт ли таймер: отвечает тот, кто его видит
export function onTimerAsk() {
  const left = end - Date.now();
  if (left > 1000) B.live.timer({ left, total, by });
}

export function timerDialog() {
  const { root, close } = A.openModal(`
    <h3>Таймер</h3>
    <p>Виден всем на доске.</p>
    <div class="mins">${[1, 3, 5, 10, 15, 25].map((m) => `<button class="minibtn" data-m="${m}">${m} мин</button>`).join('')}</div>
    <div class="row">
      ${end ? '<button class="minibtn danger" data-stop>Остановить</button>' : ''}
      <button class="minibtn" data-close>Закрыть</button>
    </div>`);
  root.querySelector('[data-close]').onclick = close;
  root.onclick = (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m) { close(); start(Number(m) * 60e3); }
    if (e.target.closest('[data-stop]')) { close(); stop(true); }
  };
}

function start(ms) {
  by = A.myName();
  run(ms, ms, by);
  B.live.timer({ left: ms, total: ms, by });
}

function stop(share) {
  if (share) B.live.timer({ left: 0, by: A.myName() });
  clear();
}

function run(left, t, who) {
  end = Date.now() + left;
  $('timer').classList.remove('done');
  total = t || left;
  by = who || '';
  clearInterval(tick);
  tick = setInterval(draw, 250);
  draw();
}

function clear() {
  end = 0;
  clearInterval(tick);
  $('timer').hidden = true;
}

function draw() {
  const box = $('timer');
  const left = Math.max(0, end - Date.now());
  const sec = Math.ceil(left / 1000);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0'), ss = String(sec % 60).padStart(2, '0');
  box.hidden = false;
  box.classList.toggle('soon', sec <= 10);
  box.title = by ? `Запустил: ${by}` : '';
  const html = `${icon('clock', true)}<b>${mm}:${ss}</b><button class="ib sm" data-stop title="Остановить" aria-label="Остановить таймер">${icon('close', true)}</button>`;
  if (box.dataset.t !== mm + ss) { box.dataset.t = mm + ss; box.innerHTML = html; }
  box.style.setProperty('--p', total ? (1 - left / total).toFixed(3) : 0);
  if (!left) {
    clearInterval(tick);
    end = 0;
    box.classList.add('done');
    beep();
    toast('Время вышло');
    setTimeout(() => { if (!end) { box.hidden = true; box.classList.remove('done'); } }, 6000);
  }
}

// Короткий сигнал из трёх нот, без звуковых файлов
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.22, 0.44].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = [660, 880, 990][i];
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.22);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch { /* без звука */ }
}
