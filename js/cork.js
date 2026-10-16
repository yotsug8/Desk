// Пробка: плитка рисуется один раз и ставится фоном.
// При движении поля меняется только смещение и размер фона, без перерисовки.
let url = null;

// Детерминированный шум, чтобы пробка везде была одинаковой
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function tileURL() {
  if (url) return url;
  const size = 192;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#b48a5e';
  g.fillRect(0, 0, size, size);
  const r = rng(7);
  // спокойные гранулы с низким контрастом
  for (let i = 0; i < 260; i++) {
    const x = r() * size, y = r() * size, rad = 1.5 + r() * 3;
    g.fillStyle = r() > 0.5 ? `rgba(206,160,110,${0.18 + r() * 0.14})` : `rgba(130,90,52,${0.08 + r() * 0.1})`;
    for (const [dx, dy] of [[0, 0], [size, 0], [0, size], [-size, 0], [0, -size]]) {
      g.beginPath();
      g.arc(x + dx, y + dy, rad, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(90,55,25,${0.06 + r() * 0.12})`;
    g.fillRect(r() * size, r() * size, 1, 1);
  }
  url = `url(${c.toDataURL('image/png')})`;
  return url;
}

// Лист тетради: клетка 24 точки или линейка 32, светлая бумага.
// Та же плитка 192, поэтому сдвиг и масштаб работают так же, как у пробки.
function paperURL(kind) {
  const size = 192;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#fbfaf4';
  g.fillRect(0, 0, size, size);
  if (kind !== 'plain') {
    g.fillStyle = kind === 'grid' ? '#c4d6e8' : '#b9cde2';
    const step = kind === 'grid' ? 24 : 32;
    for (let p = 0; p < size; p += step) {
      g.fillRect(0, p, size, 1);
      if (kind === 'grid') g.fillRect(p, 0, 1, size);
    }
  }
  return `url(${c.toDataURL('image/png')})`;
}

// Картинки фона живут в таблице стилей, а не в style элемента: иначе при каждом сдвиге
// браузер заново собирает длинный атрибут style с картинкой внутри, и движение тормозит
let sheet = false;
function useTile(el, kind = 'cork') {
  if (!sheet) {
    sheet = true;
    const st = document.createElement('style');
    st.textContent = `.cork-tile { background-image: ${tileURL()}; }
.bg-grid .cork-tile, .cork-tile.bg-grid { background-image: ${paperURL('grid')}; }
.bg-lines .cork-tile, .cork-tile.bg-lines { background-image: ${paperURL('lines')}; }
.bg-plain .cork-tile, .cork-tile.bg-plain { background-image: none; }`;
    document.head.append(st);
  }
  el.classList.add('cork-tile');
}

// Поставить пробку фоном элемента; cam сдвигает и масштабирует её вместе с полем
export function corkOn(el, cam) {
  useTile(el);
  if (!cam) return;
  const s = Math.max(0.5, cam.s) * 192;
  el.style.backgroundSize = `${s}px ${s}px`;
  el.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
}

// Пробка доски отдельным слоем: при движении меняется только transform, без перерисовки.
// Плитка растрируется под масштаб t0; пока масштаб меняется, слой просто растягивается,
// а когда масштаб успокоился, плитка пересобирается под новый размер.
let rebuild = 0;
// размер окна запоминаем по событию: чтение innerWidth на каждом кадре заставляет браузер
// тут же пересчитать стили и раскладку
export const view = { w: innerWidth, h: innerHeight };
addEventListener('resize', () => { view.w = innerWidth; view.h = innerHeight; });
export function corkLayer(el, cam) {
  useTile(el);
  const t = Math.max(0.5, cam.s) * 192;
  const vp = `${view.w}x${view.h}`;
  let ratio = el._t0 ? t / el._t0 : 0;
  if (!el._t0 || el._vp !== vp || ratio < 0.5 || ratio > 2) {
    setBase(el, t, vp);
    ratio = 1;
  } else if (ratio < 0.8 || ratio > 1.25) {
    // пересборка перерисовывает весь большой слой; немного растянутая пробка незаметна,
    // поэтому пересобираем только при заметной разнице и только когда масштаб успокоился
    clearTimeout(rebuild);
    rebuild = setTimeout(() => { setBase(el, t, vp); place(el, cam, t, 1); }, 250);
  } else clearTimeout(rebuild);
  place(el, cam, t, ratio);
}

function setBase(el, t, vp) {
  el._t0 = t;
  el._vp = vp;
  el.style.transformOrigin = '0 0';
  el.style.backgroundSize = `${t}px ${t}px`;
  // с запасом: при растяжении до двух раз слой всё равно закрывает экран
  el.style.width = view.w * 2 + 2 * t + 'px';
  el.style.height = view.h * 2 + 2 * t + 'px';
}

function place(el, cam, t, ratio) {
  const dx = (((cam.x % t) + t) % t) - t, dy = (((cam.y % t) + t) % t) - t;
  el.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${ratio})`;
}
