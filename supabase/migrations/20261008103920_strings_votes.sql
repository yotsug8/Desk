-- Нитки между элементами и голосование кнопками

-- ============================================================
-- Нитки: элемент типа link, концы в data.from и data.to
-- ============================================================

alter table public.elements drop constraint elements_type_check;
alter table public.elements add constraint elements_type_check check (type in ('note', 'text', 'link'));

create or replace function public.check_data(t text, d jsonb) returns jsonb
language plpgsql immutable as $$
declare
  allowed text[] := case t
    when 'note' then array['text', 'color']
    when 'text' then array['text', 'size', 'color']
    when 'link' then array['from', 'to', 'color']
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
  if d ? 'color' and (d->>'color') <> all (case t
      when 'note' then array['yellow', 'pink', 'green', 'blue', 'white']
      when 'text' then array['ink', 'white', 'red']
      else array['red', 'ink', 'blue', 'white'] end) then
    raise exception 'bad_color' using errcode = '22023';
  end if;
  if d ? 'size' and (jsonb_typeof(d->'size') <> 'number' or (d->>'size')::numeric not between 8 and 200) then
    raise exception 'bad_size' using errcode = '22023';
  end if;
  return d;
end $$;
revoke execute on function public.check_data(text, jsonb) from public, anon, authenticated;

-- Концы нитки: два разных живых элемента той же доски, не нитки. Менять концы потом нельзя.
create function public.links_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a uuid;
  b uuid;
begin
  if new.type <> 'link' then return new; end if;
  if tg_op = 'UPDATE' then
    if (new.data->>'from') is distinct from (old.data->>'from') or (new.data->>'to') is distinct from (old.data->>'to') then
      raise exception 'bad_patch' using errcode = '22023';
    end if;
    return new;
  end if;
  begin
    a := (new.data->>'from')::uuid;
    b := (new.data->>'to')::uuid;
  exception when others then
    raise exception 'bad_link' using errcode = '22023';
  end;
  if a is null or b is null or a = b or (
    select count(*) from elements
    where id in (a, b) and board_id = new.board_id and type <> 'link' and deleted_at is null
  ) <> 2 then
    raise exception 'bad_link' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function public.links_guard() from public, anon, authenticated;

create trigger links_guard_trg
before insert or update on public.elements
for each row execute function public.links_guard();

-- ============================================================
-- Голосование: раунд с таймером, у каждого до 3 кнопок за раунд
-- ============================================================

create table public.rounds (
  board_id    text primary key references public.boards on delete cascade,
  round       integer not null default 0,
  until       timestamptz,
  started_by  uuid references auth.users on delete set null
);

create table public.votes (
  id          bigserial primary key,
  board_id    text not null references public.boards on delete cascade,
  round       integer not null,
  element_id  uuid not null references public.elements on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  removed     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index votes_board_idx on public.votes (board_id, round);

alter table public.rounds enable row level security;
alter table public.votes enable row level security;
revoke all on public.rounds, public.votes from anon, authenticated;
revoke all on sequence public.votes_id_seq from anon, authenticated;
grant select on public.rounds, public.votes to authenticated;
create policy rounds_read on public.rounds for select to authenticated using (public.is_member(board_id));
create policy votes_read on public.votes for select to authenticated using (public.is_member(board_id));

-- Начать раунд (участник с правом правки). Старые кнопки остаются в прошлом раунде.
create function public.vote_start(p_board text, p_seconds int) returns public.rounds
language plpgsql volatile security definer set search_path = public as $$
declare
  r rounds;
begin
  perform public.require_editor(p_board);
  insert into rounds (board_id, round, until, started_by)
  values (p_board, 1, now() + make_interval(secs => greatest(30, least(p_seconds, 3600))), auth.uid())
  on conflict (board_id) do update set
    round = rounds.round + 1, until = excluded.until, started_by = excluded.started_by
  returning * into r;
  return r;
end $$;

-- Закончить раунд досрочно
create function public.vote_stop(p_board text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.require_editor(p_board);
  update rounds set until = now() where board_id = p_board and until > now();
end $$;

-- Воткнуть свою кнопку в элемент (+1) или вынуть (-1)
create function public.vote(p_element uuid, p_delta int) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
  r rounds;
  mine int;
begin
  select * into e from elements where id = p_element and deleted_at is null and type <> 'link';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.is_member(e.board_id) then raise exception 'no_access' using errcode = '42501'; end if;
  select * into r from rounds where board_id = e.board_id;
  if not found or r.until is null or r.until <= now() then
    raise exception 'no_round' using errcode = '55000';
  end if;
  -- одновременные голоса одного человека проходят по очереди
  perform pg_advisory_xact_lock(hashtext(e.board_id || auth.uid()::text));
  select count(*) into mine from votes
  where board_id = e.board_id and round = r.round and user_id = auth.uid() and not removed;
  if p_delta > 0 then
    if mine >= 3 then raise exception 'no_votes_left' using errcode = '54000'; end if;
    insert into votes (board_id, round, element_id, user_id) values (e.board_id, r.round, p_element, auth.uid());
    return mine + 1;
  end if;
  update votes set removed = true
  where id = (
    select id from votes
    where board_id = e.board_id and round = r.round and element_id = p_element and user_id = auth.uid() and not removed
    order by id desc limit 1
  );
  return greatest(mine - 1, 0);
end $$;

revoke execute on function public.vote_start(text, int), public.vote_stop(text), public.vote(uuid, int) from public, anon;
grant execute on function public.vote_start(text, int), public.vote_stop(text), public.vote(uuid, int) to authenticated;

alter publication supabase_realtime add table public.rounds, public.votes;

-- обновить кэш схемы REST
notify pgrst, 'reload schema';
