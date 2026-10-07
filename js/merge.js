// Слияние двух правок одного текста относительно общей основы.
// Каждая правка сводится к замене одного участка (общее начало и конец отбрасываются).
// Если участки не пересекаются, применяются обе. Если пересекаются, к чужому тексту
// добавляется моя вставка, чтобы ничего не потерялось.

function change(base, text) {
  let a = 0;
  const max = Math.min(base.length, text.length);
  while (a < max && base[a] === text[a]) a++;
  let b = 0;
  while (b < max - a && base[base.length - 1 - b] === text[text.length - 1 - b]) b++;
  return { from: a, to: base.length - b, ins: text.slice(a, text.length - b) };
}

export function merge3(base, mine, theirs) {
  if (mine === base) return theirs;
  if (theirs === base || theirs === mine) return mine;
  const m = change(base, mine);
  const t = change(base, theirs);
  // моя правка целиком до чужой
  if (m.to <= t.from && !(m.to === t.from && m.from === m.to && t.from === t.to)) {
    return base.slice(0, m.from) + m.ins + base.slice(m.to, t.from) + t.ins + base.slice(t.to);
  }
  // моя правка целиком после чужой
  if (t.to <= m.from) {
    return base.slice(0, t.from) + t.ins + base.slice(t.to, m.from) + m.ins + base.slice(m.to);
  }
  // пересечение: берём чужой текст и вставляем мой новый кусок после чужого участка
  const at = t.from + t.ins.length;
  return theirs.slice(0, at) + m.ins + theirs.slice(at);
}

// Куда сдвинется позиция курсора pos в тексте before после замены на after
export function mapCaret(before, after, pos) {
  const c = change(before, after);
  if (pos <= c.from) return pos;
  if (pos >= c.to) return pos + c.ins.length - (c.to - c.from);
  return c.from + c.ins.length;
}
