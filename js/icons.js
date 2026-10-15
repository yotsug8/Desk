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
  devices: '<rect x="2" y="4" width="13" height="10" rx="1.5"/><path d="M6 18h5M8.5 14v4"/><rect x="17" y="8" width="5" height="12" rx="1.5"/>',
  row: '<rect x="2.5" y="7" width="5" height="10" rx="1"/><rect x="9.5" y="7" width="5" height="10" rx="1"/><rect x="16.5" y="7" width="5" height="10" rx="1"/>',
  column: '<rect x="7" y="2.5" width="10" height="5" rx="1"/><rect x="7" y="9.5" width="10" height="5" rx="1"/><rect x="7" y="16.5" width="10" height="5" rx="1"/>',
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
  frame: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h6"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2.5h5M12 2.5V5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
};

export function icon(name, small = false) {
  return `<svg class="i${small ? ' s' : ''}" viewBox="0 0 24 24" aria-hidden="true">${P[name]}</svg>`;
}

export const CURSOR_SVG = '<svg viewBox="0 0 18 18"><path d="M1 1l15 6-6 2-2 6z"/></svg>';

// Рисунки инструментов на полке: каждый похож на то, что он создаёт
const ART = {
  note: '<g transform="rotate(-6 20 17)"><rect x="9" y="6" width="22" height="21" rx="1.5" fill="#f1e2a4"/><path d="M13 13h13M13 17h10M13 21h12" stroke="#8a7a45" stroke-width="1.4" stroke-linecap="round"/></g><circle cx="19.5" cy="6.5" r="3" fill="#c4553f"/><circle cx="18.6" cy="5.6" r=".9" fill="#fff" opacity=".7"/>',
  list: '<rect x="9" y="4" width="22" height="25" rx="1.5" fill="#fbf9f4"/><rect x="12.5" y="9" width="4" height="4" rx="1" fill="#c4553f"/><path d="M13.3 11l1 1 1.6-2" stroke="#fff" stroke-width="1" fill="none" stroke-linecap="round"/><path d="M19 11h9" stroke="#9a9086" stroke-width="1.4" stroke-linecap="round"/><rect x="12.5" y="17" width="4" height="4" rx="1" fill="none" stroke="#6b625a" stroke-width="1.2"/><path d="M19 19h7" stroke="#9a9086" stroke-width="1.4" stroke-linecap="round"/><rect x="12.5" y="23" width="4" height="4" rx="1" fill="none" stroke="#6b625a" stroke-width="1.2"/>',
  text: '<text x="20" y="25" text-anchor="middle" font-family="PT Serif, Georgia, serif" font-weight="700" font-size="21" fill="#f3e9d2">Аа</text>',
  draw: '<path d="M6 25c4-6 7 2 11-3s5-8 9-4" stroke="#f6d860" stroke-width="2" fill="none" stroke-linecap="round"/><g transform="rotate(40 26 13)"><rect x="22.5" y="1" width="7" height="20" rx="1.2" fill="#e8a33d"/><rect x="22.5" y="1" width="7" height="4" rx="1.2" fill="#e88c9a"/><path d="M22.5 21l3.5 6 3.5-6z" fill="#f3d8b0"/><path d="M25.2 25.6l.8 1.4.8-1.4z" fill="#2b2724"/></g>',
  link: '<path d="M9 10C15 24 25 24 31 12" stroke="#d8432f" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="9" cy="9" r="3.6" fill="#d8432f"/><circle cx="31" cy="11" r="3.6" fill="#d8432f"/><circle cx="8" cy="8" r="1" fill="#fff" opacity=".7"/><circle cx="30" cy="10" r="1" fill="#fff" opacity=".7"/>',
  frame: '<rect x="6" y="10" width="28" height="18" rx="3" fill="#ffffff1a" stroke="#f3e9d2" stroke-width="1.6" stroke-dasharray="3.5 2.5"/><rect x="6" y="3" width="15" height="5.5" rx="1.6" fill="#f3e9d2"/>',
  photo: '<g transform="rotate(5 20 16)"><rect x="9" y="3" width="22" height="26" rx="1.2" fill="#fbf9f4"/><rect x="11.5" y="5.5" width="17" height="15" fill="#9cc3dc"/><path d="M11.5 20.5l5-6 4 4 3-3 5 5z" fill="#5e8f5a"/><circle cx="24.5" cy="9.5" r="2" fill="#f6d860"/></g>',
};

export function toolArt(name) {
  return `<svg class="art" viewBox="0 0 40 32" aria-hidden="true">${ART[name] || ''}</svg>`;
}
