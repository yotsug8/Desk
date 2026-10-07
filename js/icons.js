// Иконки тонкой линией, 24x24
const P = {
  select: '<path d="M5 3l14 8-6 2-3 6z"/>',
  hand: '<path d="M9 11V5a2 2 0 0 1 4 0v5M13 10V4a2 2 0 0 1 4 0v8M9 11a2 2 0 0 0-4 0v2c0 4 3 8 8 8s7-3 7-7v-4a2 2 0 0 0-4 0"/>',
  note: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  front: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  bigger: '<path d="M4 18L9 6l5 12M5.8 14h6.4M17 9v6M14 12h6"/>',
  smaller: '<path d="M4 18L9 6l5 12M5.8 14h6.4M14 12h6"/>',
};

export function icon(name, small = false) {
  return `<svg class="i${small ? ' s' : ''}" viewBox="0 0 24 24" aria-hidden="true">${P[name]}</svg>`;
}

export const CURSOR_SVG = '<svg viewBox="0 0 18 18"><path d="M1 1l15 6-6 2-2 6z"/></svg>';
