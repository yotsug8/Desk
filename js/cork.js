// Пробка: плитка текстуры рисуется один раз, потом заливает холст со сдвигом камеры
let tile = null;

// Детерминированный шум, чтобы пробка не «дышала» между перерисовками
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function makeTile() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#bf8f59';
  g.fillRect(0, 0, size, size);
  const r = rng(7);
  // крупные гранулы
  for (let i = 0; i < 900; i++) {
    const x = r() * size, y = r() * size, rad = 1.5 + r() * 4.5;
    const light = r() > 0.5;
    g.fillStyle = light ? `rgba(222,178,122,${0.25 + r() * 0.35})` : `rgba(120,78,38,${0.18 + r() * 0.3})`;
    for (const [dx, dy] of [[0, 0], [size, 0], [0, size], [-size, 0], [0, -size]]) {
      g.beginPath();
      g.ellipse(x + dx, y + dy, rad, rad * (0.6 + r() * 0.5), r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
  // мелкие тёмные поры
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(70,40,15,${0.15 + r() * 0.35})`;
    g.fillRect(r() * size, r() * size, 1 + r(), 1 + r());
  }
  return c;
}

export function drawCork(canvas, cam) {
  const dpr = devicePixelRatio || 1;
  const w = innerWidth, h = innerHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  if (!tile) tile = makeTile();
  const pattern = g.createPattern(tile, 'repeat');
  // текстура масштабируется вместе с полем, но не мельче половины, чтобы не рябила
  const s = Math.max(0.5, cam.s);
  pattern.setTransform(new DOMMatrix([s, 0, 0, s, cam.x, cam.y]));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = pattern;
  g.fillRect(0, 0, w, h);
  // затемнение по краям, как у настоящей доски под лампой
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(59,36,15,0)');
  v.addColorStop(1, 'rgba(59,36,15,0.45)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
}
