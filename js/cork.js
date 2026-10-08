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
  g.fillStyle = '#c4955f';
  g.fillRect(0, 0, size, size);
  const r = rng(7);
  // спокойные гранулы с низким контрастом
  for (let i = 0; i < 260; i++) {
    const x = r() * size, y = r() * size, rad = 1.5 + r() * 3;
    g.fillStyle = r() > 0.5 ? `rgba(214,170,116,${0.25 + r() * 0.2})` : `rgba(140,96,52,${0.12 + r() * 0.15})`;
    for (const [dx, dy] of [[0, 0], [size, 0], [0, size], [-size, 0], [0, -size]]) {
      g.beginPath();
      g.arc(x + dx, y + dy, rad, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(90,55,25,${0.1 + r() * 0.2})`;
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
