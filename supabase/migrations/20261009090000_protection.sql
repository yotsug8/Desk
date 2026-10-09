-- Защита от порчи: закрепление, доверие по времени, лимит массовых действий с одобрением,
-- права владельца, корзина. Все проверки здесь, в базе.

-- ============================================================
-- Кто делает действие: обычно сам пользователь, при одобрении запроса автор запроса
-- ============================================================

create function public.actor() returns uuid
language sql stable as $$
  select coalesce(nullif(current_setting('desk.actor', true), '')::uuid, auth.uid());
$$;
revoke execute on function public.actor() from public, anon, authenticated;

create or replace function public.elements_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  act text := nullif(current_setting('desk.action', true), '');
  batch uuid := nullif(current_setting('desk.batch', true), '')::uuid;
  who uuid := public.actor();
  last history;
begin
  if tg_op = 'INSERT' then
    insert into history (board_id, element_id, user_id, action, before, after, batch_id)
    values (new.board_id, new.id, who, coalesce(act, 'create'), null, el_snapshot(new), batch);
    return new;
  end if;

  if el_snapshot(old) = el_snapshot(new) then
    return new;
  end if;

  if act is null then
    act := case
      when old.deleted_at is null and new.deleted_at is not null then 'delete'
      when old.deleted_at is not null and new.deleted_at is null then 'restore'
      when old.locked <> new.locked then 'lock'
      else 'update'
    end;
  end if;

  if act = 'update' then
    select * into last from history
    where element_id = new.id order by id desc limit 1;
    if found and last.action = 'update' and last.user_id is not distinct from who
       and last.created_at > clock_timestamp() - interval '10 seconds' then
      update history set after = el_snapshot(new), created_at = clock_timestamp()
      where id = last.id;
      return new;
    end if;
  end if;

  insert into history (board_id, element_id, user_id, action, before, after, batch_id)
  values (new.board_id, new.id, who, act, el_snapshot(old), el_snapshot(new), batch);
  return new;
end $$;

-- ============================================================
-- Можно ли трогать элемент
-- ============================================================

-- Новичок первые 5 минут на доске только добавляет; закреплённое меняют только автор и владелец
create function public.check_touch(e public.elements) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  m members;
begin
  perform public.require_editor(e.board_id);
  select * into m from members where board_id = e.board_id and user_id = auth.uid();
  if m.role = 'owner' or e.created_by = auth.uid() then return; end if;
  if e.locked then
    raise exception 'locked' using errcode = '42501';
  end if;
  if m.joined_at > now() - interval '5 minutes' then
    raise exception 'too_new' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.check_touch(public.elements) from public, anon, authenticated;

-- ============================================================
-- Лимит: больше 10 чужих элементов за минуту удалить или сдвинуть сразу нельзя
-- ============================================================

create table public.mass_log (
  id        bigserial primary key,
  board_id  text not null references public.boards on delete cascade,
  user_id   uuid not null,
  n         int not null,
  at        timestamptz not null default now()
);
create index mass_log_idx on public.mass_log (board_id, user_id, at);
alter table public.mass_log enable row level security;
revoke all on public.mass_log from anon, authenticated;

create function public.mass_guard(p_board text, p_others int) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  recent int;
begin
  if p_others = 0 or public.my_role(p_board) = 'owner' or current_setting('desk.approved', true) = '1' then return; end if;
  select coalesce(sum(n), 0) into recent from mass_log
  where board_id = p_board and user_id = auth.uid() and at > now() - interval '1 minute';
  if recent + p_others > 10 then
    raise exception 'mass_limit' using errcode = '54000';
  end if;
  insert into mass_log (board_id, user_id, n) values (p_board, auth.uid(), p_others);
end $$;
revoke execute on function public.mass_guard(text, int) from public, anon, authenticated;

-- Запросы на крупные действия: видны всем участникам, решает владелец или другой участник
create table public.requests (
  id          bigserial primary key,
  board_id    text not null references public.boards on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  kind        text not null check (kind in ('delete', 'move')),
  payload     jsonb not null,
  n           int not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by  uuid,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create index requests_board_idx on public.requests (board_id, status);
alter table public.requests enable row level security;
revoke all on public.requests from anon, authenticated;
revoke all on sequence public.requests_id_seq from anon, authenticated;
grant select on public.requests to authenticated;
create policy requests_read on public.requests for select to authenticated using (public.is_member(board_id));
alter publication supabase_realtime add table public.requests;

-- ============================================================
-- Изменение, перенос, удаление: те же функции, но с проверками
-- ============================================================

create or replace function public.el_update(p_id uuid, p_base_version int, p_patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
  d jsonb;
begin
  select * into e from elements where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.check_touch(e);
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

create or replace function public.el_move(p_moves jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  m jsonb;
  e elements;
  b text;
  others int := 0;
begin
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) > 500 then
    raise exception 'bad_patch' using errcode = '22023';
  end if;
  -- сначала проверки по всем элементам, потом перенос
  for m in select * from jsonb_array_elements(p_moves) loop
    select * into e from elements where id = (m->>'id')::uuid and deleted_at is null;
    if not found then continue; end if;
    if b is null then b := e.board_id; elsif b <> e.board_id then raise exception 'bad_patch' using errcode = '22023'; end if;
    perform public.check_touch(e);
    if e.created_by <> auth.uid() then others := others + 1; end if;
  end loop;
  if b is null then return; end if;
  perform public.mass_guard(b, others);
  for m in select * from jsonb_array_elements(p_moves) loop
    update elements set
      x = greatest(least((m->>'x')::float8, 1e6), -1e6),
      y = greatest(least((m->>'y')::float8, 1e6), -1e6),
      version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = (m->>'id')::uuid and deleted_at is null;
  end loop;
end $$;

create or replace function public.el_delete(p_ids uuid[]) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
  b text;
  n int := 0;
  others int := 0;
  i uuid;
begin
  if coalesce(array_length(p_ids, 1), 0) > 500 then raise exception 'bad_patch' using errcode = '22023'; end if;
  foreach i in array p_ids loop
    select * into e from elements where id = i and deleted_at is null;
    if not found then continue; end if;
    if b is null then b := e.board_id; elsif b <> e.board_id then raise exception 'bad_patch' using errcode = '22023'; end if;
    perform public.check_touch(e);
    if e.created_by <> auth.uid() then others := others + 1; end if;
  end loop;
  if b is null then return 0; end if;
  perform public.mass_guard(b, others);
  perform set_config('desk.batch', gen_random_uuid()::text, true);
  update elements set deleted_at = now(), version = version + 1, updated_by = auth.uid(), updated_at = now()
  where id = any(p_ids) and deleted_at is null;
  get diagnostics n = row_count;
  perform set_config('desk.batch', '', true);
  return n;
end $$;

-- Откат: новичок не откатывает, закреплённое чужое не трогается (кроме владельца)
create or replace function public.rollback_to(p_board text, p_history_id bigint) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
  snap jsonb;
  n int := 0;
  m members;
begin
  perform public.require_editor(p_board);
  select * into m from members where board_id = p_board and user_id = auth.uid();
  if m.role <> 'owner' and m.joined_at > now() - interval '5 minutes' then
    raise exception 'too_new' using errcode = '42501';
  end if;
  if not exists (select 1 from history where id = p_history_id and board_id = p_board) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform set_config('desk.action', 'rollback', true);
  perform set_config('desk.batch', gen_random_uuid()::text, true);

  for e in select * from elements where board_id = p_board for update loop
    if e.locked and m.role <> 'owner' and e.created_by <> auth.uid() then continue; end if;
    select h.after into snap from history h
    where h.element_id = e.id and h.id <= p_history_id
    order by h.id desc limit 1;

    if snap is null then
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

-- ============================================================
-- Запросы на одобрение
-- ============================================================

-- Отправить крупное действие на одобрение (то, что не прошло по лимиту)
create function public.request_mass(p_board text, p_kind text, p_payload jsonb) returns public.requests
language plpgsql volatile security definer set search_path = public as $$
declare
  r requests;
  n int;
begin
  perform public.require_editor(p_board);
  if p_kind not in ('delete', 'move') or jsonb_typeof(p_payload) <> 'array' or jsonb_array_length(p_payload) > 500 then
    raise exception 'bad_patch' using errcode = '22023';
  end if;
  if (select count(*) from requests where board_id = p_board and user_id = auth.uid() and status = 'pending') >= 3 then
    raise exception 'too_many_requests' using errcode = '54000';
  end if;
  n := jsonb_array_length(p_payload);
  insert into requests (board_id, user_id, kind, payload, n) values (p_board, auth.uid(), p_kind, p_payload, n)
  returning * into r;
  return r;
end $$;

-- Решить запрос: владелец или другой участник, который не новичок
create function public.decide_request(p_id bigint, p_approve boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  r requests;
  m members;
  ids uuid[];
begin
  select * into r from requests where id = p_id for update;
  if not found or r.status <> 'pending' then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.require_editor(r.board_id);
  select * into m from members where board_id = r.board_id and user_id = auth.uid();
  if r.user_id = auth.uid() and m.role <> 'owner' then raise exception 'no_access' using errcode = '42501'; end if;
  if m.role <> 'owner' and m.joined_at > now() - interval '5 minutes' then
    raise exception 'too_new' using errcode = '42501';
  end if;

  update requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now()
  where id = p_id;
  if not p_approve then return; end if;

  -- выполняем от имени автора запроса, без лимита; закреплённое чужое не трогаем
  perform set_config('desk.actor', r.user_id::text, true);
  perform set_config('desk.batch', gen_random_uuid()::text, true);
  if r.kind = 'delete' then
    select array_agg(x::uuid) into ids from jsonb_array_elements_text(r.payload) x;
    update elements set deleted_at = now(), version = version + 1, updated_by = r.user_id, updated_at = now()
    where id = any(ids) and board_id = r.board_id and deleted_at is null
      and (not locked or created_by = r.user_id or m.role = 'owner');
  else
    update elements e set
      x = greatest(least((mv->>'x')::float8, 1e6), -1e6),
      y = greatest(least((mv->>'y')::float8, 1e6), -1e6),
      version = e.version + 1, updated_by = r.user_id, updated_at = now()
    from jsonb_array_elements(r.payload) mv
    where e.id = (mv->>'id')::uuid and e.board_id = r.board_id and e.deleted_at is null
      and (not e.locked or e.created_by = r.user_id or m.role = 'owner');
  end if;
  perform set_config('desk.actor', '', true);
  perform set_config('desk.batch', '', true);
end $$;

-- ============================================================
-- Закрепление
-- ============================================================

create function public.el_lock(p_id uuid, p_locked boolean) returns public.elements
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
begin
  select * into e from elements where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.require_editor(e.board_id);
  if e.created_by <> auth.uid() and public.my_role(e.board_id) <> 'owner' then
    raise exception 'no_access' using errcode = '42501';
  end if;
  update elements set locked = p_locked, version = version + 1, updated_by = auth.uid(), updated_at = now()
  where id = p_id returning * into e;
  return e;
end $$;

-- ============================================================
-- Права владельца
-- ============================================================

create function public.require_owner(b text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role(b) is distinct from 'owner' then
    raise exception 'no_access' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.require_owner(text) from public, anon, authenticated;

-- Новые гости только смотрят
create function public.set_readonly_new(p_board text, p_on boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.require_owner(p_board);
  update boards set readonly_for_new = p_on where id = p_board;
end $$;

-- Роль участника: может править или только смотрит; выгнать и вернуть
create function public.set_member(p_board text, p_user uuid, p_role text, p_banned boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.require_owner(p_board);
  if p_user = auth.uid() then raise exception 'no_access' using errcode = '42501'; end if;
  if p_role not in ('editor', 'viewer') then raise exception 'bad_patch' using errcode = '22023'; end if;
  update members set role = p_role, banned = p_banned where board_id = p_board and user_id = p_user;
end $$;

-- Откатить все действия человека за последние p_hours часов.
-- Элемент возвращается к состоянию до его первой правки в этом окне,
-- если после него элемент никто другой не менял; созданное им снимается.
create function public.undo_user(p_board text, p_user uuid, p_hours int default 24) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
  first_row history;
  snap jsonb;
  n int := 0;
begin
  perform public.require_owner(p_board);
  perform set_config('desk.action', 'rollback', true);
  perform set_config('desk.batch', gen_random_uuid()::text, true);
  for e in
    select el.* from elements el
    where el.board_id = p_board and exists (
      select 1 from history h where h.element_id = el.id and h.user_id = p_user
        and h.created_at > now() - make_interval(hours => greatest(1, least(p_hours, 720))))
    for update
  loop
    -- после него кто-то другой правил: не трогаем, чтобы не затереть чужую работу
    if exists (
      select 1 from history h where h.element_id = e.id and h.user_id is distinct from p_user
        and h.id > (select min(id) from history where element_id = e.id and user_id = p_user
                     and created_at > now() - make_interval(hours => greatest(1, least(p_hours, 720))))
    ) then continue; end if;
    select * into first_row from history
    where element_id = e.id and user_id = p_user and created_at > now() - make_interval(hours => greatest(1, least(p_hours, 720)))
    order by id limit 1;
    snap := first_row.before;
    if snap is null then
      if e.deleted_at is null then
        update elements set deleted_at = now(), version = version + 1, updated_by = auth.uid(), updated_at = now() where id = e.id;
        n := n + 1;
      end if;
    elsif snap <> public.el_snapshot(e) then
      update elements set
        x = (snap->>'x')::float8, y = (snap->>'y')::float8, w = (snap->>'w')::float8, h = (snap->>'h')::float8,
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

-- ============================================================
-- Корзина: снятое за 30 дней
-- ============================================================

create function public.trash_list(p_board text) returns setof public.elements
language sql stable security definer set search_path = public as $$
  select e.* from elements e
  where e.board_id = p_board and public.is_member(p_board)
    and e.deleted_at is not null and e.deleted_at > now() - interval '30 days' and e.type <> 'link'
  order by e.deleted_at desc
  limit 200;
$$;

-- board_info отдаёт и режим «новые гости только смотрят»
revoke execute on function public.request_mass(text, text, jsonb), public.decide_request(bigint, boolean),
  public.el_lock(uuid, boolean), public.set_readonly_new(text, boolean), public.set_member(text, uuid, text, boolean),
  public.undo_user(text, uuid, int), public.trash_list(text) from public, anon;
grant execute on function public.request_mass(text, text, jsonb), public.decide_request(bigint, boolean),
  public.el_lock(uuid, boolean), public.set_readonly_new(text, boolean), public.set_member(text, uuid, text, boolean),
  public.undo_user(text, uuid, int), public.trash_list(text) to authenticated;

notify pgrst, 'reload schema';
