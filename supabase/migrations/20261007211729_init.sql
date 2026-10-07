-- «Доска»: таблицы, история, права и функции изменения.
-- Клиент только читает таблицы. Все изменения идут через функции ниже,
-- в них же все проверки. История пишется триггером, обойти её нельзя.

-- ============================================================
-- Таблицы
-- ============================================================

create table public.boards (
  id                text primary key,
  title             text not null default 'Новая доска' check (char_length(title) between 1 and 80),
  owner_id          uuid not null references auth.users on delete cascade,
  owner_secret_hash text not null,
  readonly_for_new  boolean not null default false,
  created_at        timestamptz not null default now()
);

create table public.members (
  board_id   text not null references public.boards on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  color      text not null check (color ~ '^#[0-9a-f]{6}$'),
  role       text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  banned     boolean not null default false,
  joined_at  timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table public.elements (
  id          uuid primary key default gen_random_uuid(),
  board_id    text not null references public.boards on delete cascade,
  type        text not null check (type in ('note', 'text')),
  x           double precision not null,
  y           double precision not null,
  w           double precision not null,
  h           double precision not null,
  z           bigint not null,
  data        jsonb not null default '{}',
  version     integer not null default 1,
  locked      boolean not null default false,
  created_by  uuid not null references auth.users on delete cascade,
  updated_by  uuid not null references auth.users on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index elements_board_idx on public.elements (board_id);

-- action: create, update, delete, restore, rollback (правки элементов),
-- board (создание доски), join (вход участника), rename (переименование)
create table public.history (
  id          bigserial primary key,
  board_id    text not null references public.boards on delete cascade,
  element_id  uuid,
  user_id     uuid,
  action      text not null,
  before      jsonb,
  after       jsonb,
  batch_id    uuid,
  created_at  timestamptz not null default clock_timestamp()
);
create index history_board_idx on public.history (board_id, id desc);
create index history_element_idx on public.history (element_id, id desc);

-- ============================================================
-- Вспомогательные функции
-- ============================================================

-- Участник доски, не выгнанный
create function public.is_member(b text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members
    where board_id = b and user_id = auth.uid() and not banned
  );
$$;

-- Роль текущего пользователя на доске (null, если не участник или выгнан)
create function public.my_role(b text) returns text
language sql stable security definer set search_path = public as $$
  select role from members
  where board_id = b and user_id = auth.uid() and not banned;
$$;

-- Ошибка, если менять доску нельзя
create function public.require_editor(b text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if coalesce(public.my_role(b), 'none') not in ('owner', 'editor') then
    raise exception 'no_access' using errcode = '42501';
  end if;
end $$;

-- Случайная строка из безопасного алфавита
create function public.random_code(len int) returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet text := 'abcdefghijkmnpqrstuvwxyz23456789';
  bytes bytea := extensions.gen_random_bytes(len);
  out text := '';
begin
  for i in 0 .. len - 1 loop
    out := out || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
  end loop;
  return out;
end $$;

create function public.hash_secret(s text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(s, 'sha256'), 'hex');
$$;

-- Снимок элемента для истории
create function public.el_snapshot(e public.elements) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'type', e.type, 'x', e.x, 'y', e.y, 'w', e.w, 'h', e.h, 'z', e.z,
    'data', e.data, 'locked', e.locked, 'deleted', e.deleted_at is not null
  );
$$;

-- Проверка содержимого элемента
create function public.check_data(t text, d jsonb) returns jsonb
language plpgsql immutable as $$
begin
  if jsonb_typeof(d) <> 'object' then
    raise exception 'bad_data' using errcode = '22023';
  end if;
  if d ? 'text' and (jsonb_typeof(d->'text') <> 'string' or char_length(d->>'text') > 5000) then
    raise exception 'bad_text' using errcode = '22023';
  end if;
  if d ? 'color' and (d->>'color') not in ('yellow', 'pink', 'green', 'blue', 'ink') then
    raise exception 'bad_color' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(d) k where k not in ('text', 'color', 'size')) then
    raise exception 'bad_data' using errcode = '22023';
  end if;
  if d ? 'size' and (jsonb_typeof(d->'size') <> 'number' or (d->>'size')::numeric not between 8 and 200) then
    raise exception 'bad_size' using errcode = '22023';
  end if;
  return d;
end $$;

-- ============================================================
-- История: триггер на elements
-- ============================================================
-- Действие и пачку функции передают через настройки транзакции desk.action / desk.batch.
-- Подряд идущие правки одного элемента одним человеком за 10 секунд склеиваются в одну запись,
-- иначе набор текста засорит историю.

create function public.elements_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  act text := nullif(current_setting('desk.action', true), '');
  batch uuid := nullif(current_setting('desk.batch', true), '')::uuid;
  last history;
begin
  if tg_op = 'INSERT' then
    insert into history (board_id, element_id, user_id, action, before, after, batch_id)
    values (new.board_id, new.id, auth.uid(), coalesce(act, 'create'), null, el_snapshot(new), batch);
    return new;
  end if;

  if el_snapshot(old) = el_snapshot(new) then
    return new;
  end if;

  if act is null then
    act := case
      when old.deleted_at is null and new.deleted_at is not null then 'delete'
      when old.deleted_at is not null and new.deleted_at is null then 'restore'
      else 'update'
    end;
  end if;

  if act = 'update' then
    select * into last from history
    where element_id = new.id order by id desc limit 1;
    if found and last.action = 'update' and last.user_id is not distinct from auth.uid()
       and last.created_at > clock_timestamp() - interval '10 seconds' then
      update history set after = el_snapshot(new), created_at = clock_timestamp()
      where id = last.id;
      return new;
    end if;
  end if;

  insert into history (board_id, element_id, user_id, action, before, after, batch_id)
  values (new.board_id, new.id, auth.uid(), act, el_snapshot(old), el_snapshot(new), batch);
  return new;
end $$;

create trigger elements_history_trg
after insert or update on public.elements
for each row execute function public.elements_history();

-- ============================================================
-- Права: клиент только читает
-- ============================================================

alter table public.boards   enable row level security;
alter table public.members  enable row level security;
alter table public.elements enable row level security;
alter table public.history  enable row level security;

revoke all on public.boards, public.members, public.elements, public.history from anon, authenticated;
revoke all on sequence public.history_id_seq from anon, authenticated;

-- Секрет владельца не отдаём никому
grant select (id, title, owner_id, readonly_for_new, created_at) on public.boards to authenticated;
grant select on public.members, public.elements, public.history to authenticated;

create policy boards_read   on public.boards   for select to authenticated using (public.is_member(id));
create policy members_read  on public.members  for select to authenticated using (public.is_member(board_id));
create policy elements_read on public.elements for select to authenticated using (public.is_member(board_id));
create policy history_read  on public.history  for select to authenticated using (public.is_member(board_id));

-- Служебные функции наружу не нужны
revoke execute on function public.require_editor(text), public.random_code(int), public.hash_secret(text),
  public.el_snapshot(public.elements), public.check_data(text, jsonb), public.elements_history()
  from public, anon, authenticated;
revoke execute on function public.is_member(text), public.my_role(text) from public, anon;

-- ============================================================
-- Доски и участники
-- ============================================================

-- Создать доску. Возвращает код и секрет владельца (он показывается один раз).
create function public.create_board(p_title text, p_name text, p_color text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  code text;
  secret text := public.random_code(24);
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  -- не больше 20 досок в час с одного входа
  if (select count(*) from boards where owner_id = uid and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too_many_boards' using errcode = '54000';
  end if;
  loop
    code := public.random_code(8);
    exit when not exists (select 1 from boards where id = code);
  end loop;
  insert into boards (id, title, owner_id, owner_secret_hash)
  values (code, coalesce(nullif(trim(p_title), ''), 'Новая доска'), uid, public.hash_secret(secret));
  insert into members (board_id, user_id, name, color, role)
  values (code, uid, trim(p_name), p_color, 'owner');
  insert into history (board_id, user_id, action) values (code, uid, 'board');
  return jsonb_build_object('id', code, 'secret', secret);
end $$;

-- Что видно о доске до входа: название и есть ли я в ней
create function public.board_info(p_board text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', b.id, 'title', b.title, 'readonly_for_new', b.readonly_for_new,
    'me', (select to_jsonb(m) - 'board_id' from members m where m.board_id = b.id and m.user_id = auth.uid())
  )
  from boards b where b.id = p_board;
$$;

-- Войти на доску или сменить своё имя
create function public.join_board(p_board text, p_name text, p_color text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  b boards;
  m members;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select * into b from boards where id = p_board;
  if not found then raise exception 'board_not_found' using errcode = 'P0002'; end if;
  select * into m from members where board_id = p_board and user_id = uid;
  if found then
    if m.banned then raise exception 'banned' using errcode = '42501'; end if;
    update members set name = trim(p_name)
    where board_id = p_board and user_id = uid returning * into m;
  else
    -- свой цвет у каждого: если выбранный занят, берём свободный
    if exists (select 1 from members where board_id = p_board and color = p_color) then
      select coalesce(min(c), p_color) into p_color
      from unnest(array['#e4572e', '#2a9d8f', '#7b61ff', '#d17a00', '#c2185b', '#1e88e5', '#43a047', '#6d4c41',
                        '#00897b', '#5e35b1', '#f4511e', '#3949ab']) c
      where c not in (select color from members where board_id = p_board);
    end if;
    insert into members (board_id, user_id, name, color, role)
    values (p_board, uid, trim(p_name), p_color, case when b.readonly_for_new then 'viewer' else 'editor' end)
    returning * into m;
    insert into history (board_id, user_id, action) values (p_board, uid, 'join');
  end if;
  return to_jsonb(m) - 'board_id';
end $$;

-- Стать владельцем по секретной ссылке (если браузер потерял вход)
create function public.claim_owner(p_board text, p_secret text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  b boards;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select * into b from boards where id = p_board;
  if not found or b.owner_secret_hash <> public.hash_secret(coalesce(p_secret, '')) then
    return false;
  end if;
  update members set role = 'editor' where board_id = p_board and user_id = b.owner_id and user_id <> uid;
  update boards set owner_id = uid where id = p_board;
  update members set role = 'owner', banned = false where board_id = p_board and user_id = uid;
  return found;
end $$;

-- Переименовать доску (только владелец)
create function public.rename_board(p_board text, p_title text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if public.my_role(p_board) is distinct from 'owner' then
    raise exception 'no_access' using errcode = '42501';
  end if;
  update boards set title = trim(p_title) where id = p_board;
  insert into history (board_id, user_id, action, after)
  values (p_board, auth.uid(), 'rename', jsonb_build_object('title', trim(p_title)));
end $$;

-- ============================================================
-- Элементы
-- ============================================================

create function public.el_create(p_board text, p_type text, p_x double precision, p_y double precision,
  p_w double precision, p_h double precision, p_data jsonb, p_id uuid default null) returns public.elements
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
begin
  perform public.require_editor(p_board);
  if (select count(*) from elements where board_id = p_board and deleted_at is null) >= 5000 then
    raise exception 'board_full' using errcode = '54000';
  end if;
  insert into elements (id, board_id, type, x, y, w, h, z, data, created_by, updated_by)
  values (coalesce(p_id, gen_random_uuid()), p_board, p_type,
          greatest(least(p_x, 1e6), -1e6), greatest(least(p_y, 1e6), -1e6),
          greatest(least(p_w, 4000), 20), greatest(least(p_h, 4000), 20),
          (extract(epoch from clock_timestamp()) * 1000)::bigint,
          public.check_data(p_type, coalesce(p_data, '{}')), auth.uid(), auth.uid())
  returning * into e;
  return e;
end $$;

-- Изменить элемент. Положение и размер: последнее изменение побеждает.
-- Текст: если p_base_version устарела, правка не применяется, возвращается свежий элемент,
-- клиент сливает тексты и повторяет.
create function public.el_update(p_id uuid, p_base_version int, p_patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
  d jsonb;
begin
  select * into e from elements where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.require_editor(e.board_id);
  if e.deleted_at is not null then raise exception 'deleted' using errcode = 'P0002'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('x', 'y', 'w', 'h', 'z', 'data')) then
    raise exception 'bad_patch' using errcode = '22023';
  end if;

  if p_patch ? 'data' and (p_patch->'data') ? 'text'
     and e.version <> p_base_version and (p_patch->'data'->>'text') is distinct from (e.data->>'text') then
    return jsonb_build_object('ok', false, 'element', to_jsonb(e));
  end if;

  d := e.data;
  if p_patch ? 'data' then
    d := public.check_data(e.type, e.data || (p_patch->'data'));
  end if;

  update elements set
    x = case when p_patch ? 'x' then greatest(least((p_patch->>'x')::float8, 1e6), -1e6) else x end,
    y = case when p_patch ? 'y' then greatest(least((p_patch->>'y')::float8, 1e6), -1e6) else y end,
    w = case when p_patch ? 'w' then greatest(least((p_patch->>'w')::float8, 4000), 20) else w end,
    h = case when p_patch ? 'h' then greatest(least((p_patch->>'h')::float8, 4000), 20) else h end,
    z = case when p_patch ? 'z' then (extract(epoch from clock_timestamp()) * 1000)::bigint else z end,
    data = d,
    version = version + 1,
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_id
  returning * into e;
  return jsonb_build_object('ok', true, 'element', to_jsonb(e));
end $$;

-- Изменить несколько элементов разом (перенос группы). Только положение.
create function public.el_move(p_moves jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  m jsonb;
  b text;
begin
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) > 500 then
    raise exception 'bad_patch' using errcode = '22023';
  end if;
  for m in select * from jsonb_array_elements(p_moves) loop
    select board_id into b from elements where id = (m->>'id')::uuid and deleted_at is null;
    if b is null then continue; end if;
    perform public.require_editor(b);
    update elements set
      x = greatest(least((m->>'x')::float8, 1e6), -1e6),
      y = greatest(least((m->>'y')::float8, 1e6), -1e6),
      version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = (m->>'id')::uuid;
  end loop;
end $$;

-- Удалить элементы (они остаются в базе с отметкой deleted_at)
create function public.el_delete(p_ids uuid[]) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  b text;
  n int := 0;
  i uuid;
begin
  if coalesce(array_length(p_ids, 1), 0) > 500 then raise exception 'bad_patch' using errcode = '22023'; end if;
  perform set_config('desk.batch', gen_random_uuid()::text, true);
  foreach i in array p_ids loop
    select board_id into b from elements where id = i and deleted_at is null;
    if b is null then continue; end if;
    perform public.require_editor(b);
    update elements set deleted_at = now(), version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = i;
    n := n + 1;
  end loop;
  perform set_config('desk.batch', '', true);
  return n;
end $$;

-- Вернуть доску к состоянию сразу после записи истории p_history_id.
-- Сам откат тоже попадает в историю (action = rollback, общий batch_id).
create function public.rollback_to(p_board text, p_history_id bigint) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
  snap jsonb;
  n int := 0;
begin
  perform public.require_editor(p_board);
  if not exists (select 1 from history where id = p_history_id and board_id = p_board) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform set_config('desk.action', 'rollback', true);
  perform set_config('desk.batch', gen_random_uuid()::text, true);

  for e in select * from elements where board_id = p_board for update loop
    select h.after into snap from history h
    where h.element_id = e.id and h.id <= p_history_id
    order by h.id desc limit 1;

    if snap is null then
      -- в тот момент элемента ещё не было
      if e.deleted_at is null then
        update elements set deleted_at = now(), version = version + 1, updated_by = auth.uid(), updated_at = now()
        where id = e.id;
        n := n + 1;
      end if;
    elsif snap <> public.el_snapshot(e) then
      update elements set
        x = (snap->>'x')::float8, y = (snap->>'y')::float8,
        w = (snap->>'w')::float8, h = (snap->>'h')::float8,
        z = (snap->>'z')::bigint, data = snap->'data', locked = (snap->>'locked')::boolean,
        deleted_at = case when (snap->>'deleted')::boolean then coalesce(e.deleted_at, now()) else null end,
        version = version + 1, updated_by = auth.uid(), updated_at = now()
      where id = e.id;
      n := n + 1;
    end if;
  end loop;

  perform set_config('desk.action', '', true);
  perform set_config('desk.batch', '', true);
  return n;
end $$;

revoke execute on function public.create_board(text, text, text), public.board_info(text),
  public.join_board(text, text, text), public.claim_owner(text, text), public.rename_board(text, text),
  public.el_create(text, text, float8, float8, float8, float8, jsonb, uuid), public.el_update(uuid, int, jsonb),
  public.el_move(jsonb), public.el_delete(uuid[]), public.rollback_to(text, bigint)
  from public, anon;
grant execute on function public.create_board(text, text, text), public.board_info(text),
  public.join_board(text, text, text), public.claim_owner(text, text), public.rename_board(text, text),
  public.el_create(text, text, float8, float8, float8, float8, jsonb, uuid), public.el_update(uuid, int, jsonb),
  public.el_move(jsonb), public.el_delete(uuid[]), public.rollback_to(text, bigint)
  to authenticated;

-- ============================================================
-- Realtime
-- ============================================================

-- Рассылка изменений таблиц (с учётом RLS)
alter table public.elements replica identity full;
alter publication supabase_realtime add table public.elements, public.members, public.history;

-- Закрытые каналы доски board:<код>: курсоры и «кто что держит» видят только участники
create policy desk_realtime_read on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and realtime.topic() like 'board:%'
    and public.is_member(substr(realtime.topic(), 7))
  );
create policy desk_realtime_write on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and realtime.topic() like 'board:%'
    and public.is_member(substr(realtime.topic(), 7))
  );
