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

// Поставить пробку фоном элемента; cam сдвигает и масштабирует её вместе с полем
export function corkOn(el, cam) {
  if (!el.style.backgroundImage) el.style.backgroundImage = tileURL();
  if (!cam) return;
  const s = Math.max(0.5, cam.s) * 192;
  el.style.backgroundSize = `${s}px ${s}px`;
  el.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
}

// Пробка доски отдельным слоем: при движении меняется только translate, без перерисовки.
// Слой больше экрана на одну плитку с каждой стороны и сдвигается по модулю плитки.
export function corkLayer(el, cam) {
  if (!el.style.backgroundImage) el.style.backgroundImage = tileURL();
  const t = Math.max(0.5, cam.s) * 192;
  const key = `${t}|${innerWidth}|${innerHeight}`;
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.style.backgroundSize = `${t}px ${t}px`;
    el.style.width = innerWidth + 2 * t + 'px';
    el.style.height = innerHeight + 2 * t + 'px';
  }
  const dx = (((cam.x % t) + t) % t) - t, dy = (((cam.y % t) + t) % t) - t;
  el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
}
