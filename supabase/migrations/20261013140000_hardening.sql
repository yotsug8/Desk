-- Укрепление сервера по итогам аудита: лимиты на все массовые действия,
-- проверки возврата и одобрения, защита от спама элементами и картинками

-- ---------- Возврат из корзины: те же правила, что у удаления ----------
create or replace function public.el_restore(p_ids uuid[]) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
  b text;
  n int := 0;
  k int := 0;
  others int := 0;
  i uuid;
begin
  if coalesce(array_length(p_ids, 1), 0) > 500 then raise exception 'bad_patch' using errcode = '22023'; end if;
  foreach i in array p_ids loop
    select * into e from elements where id = i and deleted_at is not null for update;
    if not found then continue; end if;
    if b is null then b := e.board_id; elsif b <> e.board_id then raise exception 'bad_patch' using errcode = '22023'; end if;
    perform public.check_touch(e);
    if e.created_by <> auth.uid() then others := others + 1; end if;
  end loop;
  if b is null then return 0; end if;
  if (select count(*) from elements where board_id = b and deleted_at is null) + coalesce(array_length(p_ids, 1), 0) > 5000 then
    raise exception 'board_full' using errcode = '54000';
  end if;
  perform public.mass_guard(b, others);
  perform set_config('desk.batch', gen_random_uuid()::text, true);
  update elements set deleted_at = null, version = version + 1, updated_by = auth.uid(), updated_at = now()
  where id = any(p_ids) and board_id = b and deleted_at is not null and type <> 'link';
  get diagnostics n = row_count;
  -- нитки возвращаются, только если оба конца на доске
  update elements l set deleted_at = null, version = version + 1, updated_by = auth.uid(), updated_at = now()
  where l.id = any(p_ids) and l.board_id = b and l.deleted_at is not null and l.type = 'link'
    and (select count(*) from elements x
         where x.id in ((l.data->>'from')::uuid, (l.data->>'to')::uuid) and x.deleted_at is null) = 2;
  get diagnostics k = row_count;
  perform set_config('desk.batch', '', true);
  return n + k;
end $$;

-- ---------- Удаление и перенос: блокировка строк и только своя доска ----------
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
  foreach i in array (select array_agg(distinct x) from unnest(p_ids) x) loop
    select * into e from elements where id = i and deleted_at is null for update;
    if not found then continue; end if;
    if b is null then b := e.board_id; elsif b <> e.board_id then raise exception 'bad_patch' using errcode = '22023'; end if;
    perform public.check_touch(e);
    if e.created_by <> auth.uid() then others := others + 1; end if;
  end loop;
  if b is null then return 0; end if;
  perform public.mass_guard(b, others);
  perform set_config('desk.batch', gen_random_uuid()::text, true);
  update elements set deleted_at = now(), version = version + 1, updated_by = auth.uid(), updated_at = now()
  where id = any(p_ids) and board_id = b and deleted_at is null;
  get diagnostics n = row_count;
  perform set_config('desk.batch', '', true);
  return n;
end $$;

create or replace function public.el_move(p_moves jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  m jsonb;
  e elements;
  b text;
  others int := 0;
  top bigint;
  i int := 0;
  seen uuid[] := '{}';
begin
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) > 500 then
    raise exception 'bad_patch' using errcode = '22023';
  end if;
  for m in select * from jsonb_array_elements(p_moves) loop
    select * into e from elements where id = (m->>'id')::uuid and deleted_at is null for update;
    if not found or e.id = any(seen) then continue; end if;
    seen := seen || e.id;
    if b is null then b := e.board_id; elsif b <> e.board_id then raise exception 'bad_patch' using errcode = '22023'; end if;
    perform public.check_touch(e);
    if e.created_by <> auth.uid() then others := others + 1; end if;
  end loop;
  if b is null then return; end if;
  perform public.mass_guard(b, others);
  -- перенесённое встаёт поверх, порядок между ними сохраняется
  top := (extract(epoch from clock_timestamp()) * 1000)::bigint - jsonb_array_length(p_moves);
  for m in
    select mv from jsonb_array_elements(p_moves) mv
    join elements el on el.id = (mv->>'id')::uuid
    order by el.z
  loop
    i := i + 1;
    update elements set
      x = greatest(least((m->>'x')::float8, 1e6), -1e6),
      y = greatest(least((m->>'y')::float8, 1e6), -1e6),
      z = top + i,
      version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = (m->>'id')::uuid and board_id = b and deleted_at is null;
  end loop;
end $$;

-- ---------- Правка: первая правка чужого элемента считается в лимит ----------
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
  if jsonb_typeof(p_patch) <> 'object' or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('x', 'y', 'w', 'h', 'z', 'data')) then
    raise exception 'bad_patch' using errcode = '22023';
  end if;
  if e.created_by <> auth.uid() and not exists (
    select 1 from history where element_id = e.id and user_id = auth.uid() and created_at > now() - interval '1 minute'
  ) then
    perform public.mass_guard(e.board_id, 1);
  end if;

  if p_patch ? 'data' and (p_patch->'data') ? 'text'
     and e.version is distinct from p_base_version and (p_patch->'data'->>'text') is distinct from (e.data->>'text') then
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

-- ---------- Откат доски: чужое в пределах лимита, владельцу без ограничений ----------
create or replace function public.rollback_to(p_board text, p_history_id bigint) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
  snap jsonb;
  n int := 0;
  m members;
  others int;
begin
  perform public.require_editor(p_board);
  select * into m from members where board_id = p_board and user_id = auth.uid();
  if m.role <> 'owner' and m.joined_at > now() - interval '5 minutes' then
    raise exception 'too_new' using errcode = '42501';
  end if;
  if not exists (select 1 from history where id = p_history_id and board_id = p_board) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select count(*) into others from elements el
  where el.board_id = p_board and el.created_by <> auth.uid()
    and exists (select 1 from history h where h.element_id = el.id and h.id > p_history_id);
  perform public.mass_guard(p_board, others);
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

-- ---------- Создание: не больше 120 в минуту от человека и 20000 строк на доску ----------
create index if not exists elements_rate_idx on public.elements (board_id, created_by, created_at);

create or replace function public.el_create(p_board text, p_type text, p_x double precision, p_y double precision,
  p_w double precision, p_h double precision, p_data jsonb, p_id uuid default null) returns public.elements
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
begin
  perform public.require_editor(p_board);
  if (select count(*) from elements where board_id = p_board and deleted_at is null) >= 5000
     or (select count(*) from elements where board_id = p_board) >= 20000 then
    raise exception 'board_full' using errcode = '54000';
  end if;
  if (select count(*) from elements where board_id = p_board and created_by = auth.uid()
      and created_at > now() - interval '1 minute') >= 120 then
    raise exception 'rate_limit' using errcode = '54000';
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

-- ---------- Голос: повторное нажатие возвращает прежнюю строку, а не плодит новые ----------
create or replace function public.vote_toggle(p_element uuid) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
  v votes;
  n int;
begin
  select * into e from elements where id = p_element and deleted_at is null and type <> 'link';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.is_member(e.board_id) then raise exception 'no_access' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_element::text || auth.uid()::text));
  select * into v from votes where element_id = p_element and round = 0 and user_id = auth.uid()
  order by removed, id desc limit 1;
  if not found then
    insert into votes (board_id, round, element_id, user_id) values (e.board_id, 0, p_element, auth.uid());
  else
    update votes set removed = not v.removed where id = v.id;
  end if;
  select count(*) into n from votes where element_id = p_element and round = 0 and not removed;
  return n;
end $$;

-- ---------- Запросы на одобрение: проверка содержимого и автора ----------
create or replace function public.request_mass(p_board text, p_kind text, p_payload jsonb) returns public.requests
language plpgsql volatile security definer set search_path = public as $$
declare
  r requests;
  n int;
begin
  perform public.require_editor(p_board);
  if p_kind not in ('delete', 'move') or jsonb_typeof(p_payload) <> 'array' or jsonb_array_length(p_payload) > 500 then
    raise exception 'bad_patch' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_payload) x where
       (p_kind = 'delete' and (jsonb_typeof(x) <> 'string' or x #>> '{}' !~ '^[0-9a-f-]{36}$')) or
       (p_kind = 'move' and (jsonb_typeof(x) <> 'object'
          or (select count(*) from jsonb_object_keys(x)) <> 3
          or coalesce(x->>'id', '') !~ '^[0-9a-f-]{36}$'
          or jsonb_typeof(x->'x') is distinct from 'number' or jsonb_typeof(x->'y') is distinct from 'number'))) then
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

create or replace function public.decide_request(p_id bigint, p_approve boolean) returns void
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
  -- автора выгнали или лишили прав: запрос больше не исполняется
  if not exists (select 1 from members where board_id = r.board_id and user_id = r.user_id
                 and not banned and role in ('owner', 'editor')) then
    update requests set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return;
  end if;

  update requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now()
  where id = p_id;
  if not p_approve then return; end if;

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
      z = (extract(epoch from clock_timestamp()) * 1000)::bigint,
      version = e.version + 1, updated_by = r.user_id, updated_at = now()
    from jsonb_array_elements(r.payload) mv
    where e.id = (mv->>'id')::uuid and e.board_id = r.board_id and e.deleted_at is null
      and (not e.locked or e.created_by = r.user_id or m.role = 'owner');
  end if;
  perform set_config('desk.actor', '', true);
  perform set_config('desk.batch', '', true);
end $$;

create or replace function public.set_member(p_board text, p_user uuid, p_role text, p_banned boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.require_owner(p_board);
  if p_user = auth.uid() then raise exception 'no_access' using errcode = '42501'; end if;
  if p_role not in ('editor', 'viewer') then raise exception 'bad_patch' using errcode = '22023'; end if;
  update members set role = p_role, banned = p_banned where board_id = p_board and user_id = p_user;
  if p_banned or p_role = 'viewer' then
    update requests set status = 'rejected', decided_by = auth.uid(), decided_at = now()
    where board_id = p_board and user_id = p_user and status = 'pending';
  end if;
end $$;

-- ---------- Права владельца: только для участника доски ----------
create or replace function public.claim_owner(p_board text, p_secret text) returns boolean
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
  if not exists (select 1 from members where board_id = p_board and user_id = uid) then return false; end if;
  update members set role = 'editor' where board_id = p_board and user_id = b.owner_id and user_id <> uid;
  update boards set owner_id = uid where id = p_board;
  update members set role = 'owner', banned = false where board_id = p_board and user_id = uid;
  return true;
end $$;

-- ---------- Выгнанный видит свою строку участника и уходит сам ----------
drop policy if exists members_read_self on public.members;
create policy members_read_self on public.members for select to authenticated using (user_id = auth.uid());

-- ---------- Картинки: лимиты загрузки, владелец может удалять ----------
create or replace function public.can_upload_image(b text) returns boolean
language sql stable security definer set search_path = public, storage as $$
  select coalesce(public.my_role(b), 'none') in ('owner', 'editor')
    and (select count(*) from storage.objects where bucket_id = 'images' and owner = auth.uid()
         and created_at > now() - interval '1 hour') < 60
    and (select count(*) from storage.objects where bucket_id = 'images' and name like b || '/%') < 2000
$$;
grant execute on function public.can_upload_image(text) to authenticated;

drop policy if exists desk_images_insert on storage.objects;
create policy desk_images_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'images'
    and name ~ '^[a-z0-9]{8}/[0-9a-f-]{36}\.(jpg|png|webp)$'
    and public.can_upload_image(split_part(name, '/', 1))
  );
drop policy if exists desk_images_delete on storage.objects;
create policy desk_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'images' and public.my_role(split_part(name, '/', 1)) = 'owner');

-- ---------- Склейка истории не ломает порядок отката ----------
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
    -- склеиваем только с самой последней записью доски, иначе ломается порядок отката
    if found and last.action = 'update' and last.user_id is not distinct from who
       and last.created_at > clock_timestamp() - interval '10 seconds'
       and last.batch_id is not distinct from batch
       and not exists (select 1 from history h where h.board_id = new.board_id and h.id > last.id) then
      update history set after = el_snapshot(new), created_at = clock_timestamp()
      where id = last.id;
      return new;
    end if;
  end if;

  insert into history (board_id, element_id, user_id, action, before, after, batch_id)
  values (new.board_id, new.id, who, act, el_snapshot(old), el_snapshot(new), batch);
  return new;
end $$;

-- ---------- Пустые значения цвета и толщины не проходят ----------
create or replace function public.check_data(t text, d jsonb) returns jsonb
language plpgsql immutable as $$
declare
  allowed text[] := case t
    when 'note' then array['text', 'color']
    when 'text' then array['text', 'size', 'color']
    when 'link' then array['from', 'to', 'color']
    when 'draw' then array['points', 'color', 'width']
    when 'list' then array['text', 'color']
    when 'image' then array['src', 'text']
    when 'frame' then array['text', 'color']
    else array[]::text[] end;
begin
  if jsonb_typeof(d) <> 'object' then
    raise exception 'bad_data' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(d) k where k <> all (allowed)) then
    raise exception 'bad_data' using errcode = '22023';
  end if;
  if d ? 'text' and (jsonb_typeof(d->'text') <> 'string' or char_length(d->>'text') > 5000) then
    raise exception 'bad_text' using errcode = '22023';
  end if;
  -- свой набор цветов у каждого типа
  if d ? 'color' and (jsonb_typeof(d->'color') <> 'string' or (d->>'color') <> all (case t
      when 'note' then array['yellow', 'pink', 'green', 'blue', 'white']
      when 'text' then array['ink', 'white', 'red']
      when 'draw' then array['white', 'ink', 'red', 'blue', 'yellow']
      when 'list' then array['white', 'yellow', 'blue']
      when 'frame' then array['white', 'yellow', 'green', 'blue', 'pink']
      else array['red', 'ink', 'blue', 'white'] end)) then
    raise exception 'bad_color' using errcode = '22023';
  end if;
  if d ? 'size' and (jsonb_typeof(d->'size') <> 'number' or (d->>'size')::numeric not between 8 and 200) then
    raise exception 'bad_size' using errcode = '22023';
  end if;
  -- рисунок: точки «x,y x,y ...» целыми числами, толщина из трёх вариантов
  if d ? 'points' and (jsonb_typeof(d->'points') <> 'string' or char_length(d->>'points') > 24000
      or (d->>'points') !~ '^-?[0-9]+,-?[0-9]+( -?[0-9]+,-?[0-9]+)*$') then
    raise exception 'bad_points' using errcode = '22023';
  end if;
  if t = 'draw' and not d ? 'points' then
    raise exception 'bad_points' using errcode = '22023';
  end if;
  if d ? 'width' and (jsonb_typeof(d->'width') <> 'number' or (d->>'width') not in ('3', '6', '12')) then
    raise exception 'bad_width' using errcode = '22023';
  end if;
  if t = 'image' and (jsonb_typeof(d->'src') is distinct from 'string') then
    raise exception 'bad_image' using errcode = '22023';
  end if;
  return d;
end $$;
revoke execute on function public.check_data(text, jsonb) from public, anon, authenticated;


notify pgrst, 'reload schema';
