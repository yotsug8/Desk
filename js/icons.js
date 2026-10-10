// Иконки тонкой линией, 24x24
const P = {
  select: '<path d="M5 3l14 8-6 2-3 6z"/>',
  hand: '<path d="M9 11V5a2 2 0 0 1 4 0v5M13 10V4a2 2 0 0 1 4 0v8M9 11a2 2 0 0 0-4 0v2c0 4 3 8 8 8s7-3 7-7v-4a2 2 0 0 0-4 0"/>',
  note: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  front: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  bigger: '<path d="M4 18L9 6l5 12M5.8 14h6.4M17 9v6M14 12h6"/>',
  smaller: '<path d="M4 18L9 6l5 12M5.8 14h6.4M14 12h6"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c2.8 0 5 2.2 5 5"/>',
  list: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8l1.5 1.5L12 7M8 14l1.5 1.5L12 13M14 8.5h3M14 14.5h3"/>',
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  connect: '<circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8 8.5c5 1 3 6 8 7"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  thumb: '<path d="M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 3 2l-1 4h6a2 2 0 0 1 2 2l-2 6a2 2 0 0 1-2 2H7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  install: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7v7M9 11l3 3 3-3"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
};

export function icon(name, small = false) {
  return `<svg class="i${small ? ' s' : ''}" viewBox="0 0 24 24" aria-hidden="true">${P[name]}</svg>`;
}

export const CURSOR_SVG = '<svg viewBox="0 0 18 18"><path d="M1 1l15 6-6 2-2 6z"/></svg>';
