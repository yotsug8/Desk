// Связь с сервером: вход, вызовы функций базы, понятные тексты ошибок
import { SERVER } from './config.js';

export const sb = SERVER.url
  ? window.supabase.createClient(SERVER.url, SERVER.key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'desk-auth' },
      realtime: { params: { eventsPerSecond: 30 } },
    })
  : null;

const MESSAGES = {
  no_access: 'Нет прав менять эту доску',
  banned: 'Владелец закрыл вам доступ к доске',
  board_not_found: 'Доска не найдена',
  not_found: 'Элемент не найден',
  deleted: 'Элемент уже удалён',
  too_many_boards: 'Слишком много новых досок, попробуйте через час',
  board_full: 'На доске слишком много элементов',
  bad_text: 'Слишком длинный текст',
  not_signed_in: 'Нет входа, обновите страницу',
  locked: 'Элемент закреплён: менять его могут автор и владелец',
  too_new: 'Первые 5 минут на доске можно только добавлять своё',
  mass_limit: 'Слишком много чужих элементов за минуту, нужно одобрение',
  too_many_requests: 'У вас уже 3 запроса ждут одобрения',
  bad_link: 'Связать можно два разных элемента',
};

export class ApiError extends Error {}

function fail(error) {
  const code = error?.message || '';
  const text = MESSAGES[code] || (/fetch|network/i.test(code) ? 'Нет связи с сервером' : 'Ошибка сервера');
  const e = new ApiError(text);
  e.code = code;
  throw e;
}

// Анонимный вход: почта не нужна, письма не отправляются
export async function ensureUser() {
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session.user;
  const r = await sb.auth.signInAnonymously();
  if (r.error) fail(r.error);
  return r.data.user;
}

export async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) fail(error);
  return data;
}

export async function select(table, boardId, opts = {}) {
  let q = sb.from(table).select('*').eq('board_id', boardId);
  if (opts.order) q = q.order(opts.order, { ascending: !opts.desc });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) fail(error);
  return data;
}

// для тестов из консоли
window.__deskApi = { sb };
