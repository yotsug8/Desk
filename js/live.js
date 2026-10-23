// Живая связь: изменения из базы, курсоры, кто что держит
import { sb } from './api.js';

export function connectLive(B, h) {
  const uid = B.me.user_id;
  const filter = `board_id=eq.${B.id}`;
  let hold = { ids: [], mode: null };
  let joined = false;
  let everJoined = false;

  const ch = sb.channel('board:' + B.id, {
    config: { private: true, broadcast: { self: false }, presence: { key: uid } },
  });

  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'elements', filter }, (p) => p.new?.id && h.onElement(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter }, (p) => p.new?.user_id && h.onMember(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'history', filter }, (p) => p.new?.id && h.onHistory(p.new))
    .on('broadcast', { event: 'c' }, ({ payload }) => h.onCursor(payload))
    .on('broadcast', { event: 'd' }, ({ payload }) => h.onDrag(payload.items))
    .on('broadcast', { event: 'h' }, ({ payload }) => h.onHold(payload))
    .on('broadcast', { event: 'v' }, ({ payload }) => h.onViewport(payload))
    .on('broadcast', { event: 's' }, ({ payload }) => h.onSummon(payload))
    .on('broadcast', { event: 'kick' }, ({ payload }) => payload.u === uid && h.onKick())
    .on('broadcast', { event: 'ask' }, () => sendViewport())
    .on('broadcast', { event: 't' }, ({ payload }) => h.onTimer?.(payload))
    .on('broadcast', { event: 'tq' }, () => h.onTimerAsk?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter }, (p) => p.new?.id && h.onVote(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'requests', filter }, (p) => p.new?.id && h.onRequest(p.new))
    .on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState();
      h.onPresence(Object.values(state).map((list) => list[list.length - 1]));
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        joined = true;
        h.onStatus(true);
        track();
        sendHold();
        send('tq', {}); // идёт ли у кого-то таймер
        // после переподключения сверяемся сразу; после первого входа чуть позже:
        // сервер начинает слать изменения не мгновенно, и то, что случилось в эти секунды, иначе теряется
        if (everJoined) h.onResync();
        else setTimeout(() => h.onResync(true), 1500);
        everJoined = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        joined = false;
        h.onStatus(false);
      }
    });

  // Присутствие (кто в сети) обновляем редко: у сервера жёсткий лимит на частоту
  function track() {
    if (!joined) return;
    const m = B.members.get(uid) || B.me;
    ch.track({ u: uid, n: m.name, c: m.color });
  }

  // Что я держу: отдельным сообщением, пока держу, повторяем для тех, кто вошёл позже
  function sendHold() {
    send('h', { u: uid, ids: hold.ids, m: hold.mode });
  }
  setInterval(() => { if (hold.ids.length) sendHold(); }, 4000);

  // Не чаще раза в 40 мс на каждый вид сообщений; последнее значение всегда уходит
  function throttle(fn, ms) {
    let last = 0, timer = 0, args = null;
    return (...a) => {
      args = a;
      const wait = last + ms - Date.now();
      if (wait <= 0) { last = Date.now(); fn(...args); }
      else if (!timer) timer = setTimeout(() => { timer = 0; last = Date.now(); fn(...args); }, wait);
    };
  }

  const send = (event, payload) => joined && ch.send({ type: 'broadcast', event, payload });

  // Моя камера: для тех, кто смотрит моими глазами
  let view = null;
  const sendViewport = () => view && send('v', { u: uid, ...view });
  const viewport = throttle(() => sendViewport(), 120);

  addEventListener('online', () => h.onStatus(joined));
  addEventListener('offline', () => h.onStatus(false));

  return {
    cursor: throttle((x, y) => send('c', { u: uid, x: Math.round(x), y: Math.round(y) }), 40),
    drag: throttle((items) => send('d', { items }), 40),
    hold(ids, mode) {
      if (!ids.length && !hold.ids.length) return;
      hold = { ids, mode };
      sendHold();
    },
    retrack: track,
    viewport(x, y, s) {
      view = { x: Math.round(x), y: Math.round(y), s: Math.round(s * 1000) / 1000 };
      viewport();
    },
    askViewport: () => send('ask', {}),
    kick: (u) => send('kick', { u }),
    timer: (p) => send('t', p),
    summon: (x, y, s) => send('s', { u: uid, x: Math.round(x), y: Math.round(y), s }),
  };
}
