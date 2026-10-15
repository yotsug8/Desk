-- Перенос досок на другой компьютер без почты и входа.
-- Компьютер А получает короткий одноразовый код на 10 минут, компьютер Б вводит его.
-- Б становится участником тех же досок с теми же правами, запретами и временем входа
-- (статус новичка и бан переносом не обходятся), и получает список досок и ссылки владельца.

create table public.transfers (
  code       text primary key,
  user_id    uuid not null references auth.users on delete cascade,
  payload    jsonb not null,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index transfers_user_idx on public.transfers (user_id);
-- клиент таблицу не читает: только функции ниже
alter table public.transfers enable row level security;

-- неверные коды: защита от перебора
create table public.transfer_fails (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index transfer_fails_at_idx on public.transfer_fails (at);
create index transfer_fails_user_idx on public.transfer_fails (user_id, at);
alter table public.transfer_fails enable row level security;

-- Код из 8 знаков без похожих символов: 32^8 вариантов
create function public.transfer_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(8);
  out text := '';
begin
  for i in 0 .. 7 loop
    out := out || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
  end loop;
  return out;
end $$;
revoke execute on function public.transfer_code() from public, anon, authenticated;

create function public.transfer_create(p_payload jsonb) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c text;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 20000 then
    raise exception 'bad_payload' using errcode = '22023';
  end if;
  -- у компьютера один живой код: новый заменяет прежний
  delete from transfers where expires_at < now() or user_id = uid;
  loop
    c := public.transfer_code();
    begin
      insert into transfers (code, user_id, payload) values (c, uid, p_payload);
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  return c;
end $$;

create function public.transfer_claim(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t transfers;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  -- перебор: 10 неверных кодов в час с компьютера, 200 в минуту на всех
  if (select count(*) from transfer_fails where user_id = uid and at > now() - interval '1 hour') >= 10
     or (select count(*) from transfer_fails where at > now() - interval '1 minute') >= 200 then
    raise exception 'rate_limit' using errcode = 'P0001';
  end if;
  delete from transfer_fails where at < now() - interval '1 day';

  select * into t from transfers where transfers.code = v_code and expires_at > now() for update;
  if not found then
    insert into transfer_fails (user_id) values (uid);
    return null;
  end if;
  if t.user_id = uid then raise exception 'same_device' using errcode = 'P0001'; end if;

  -- те же доски с теми же правами; владелец становится участником,
  -- а права владельца вернёт ссылка владельца из переданного списка
  insert into members (board_id, user_id, name, color, role, banned, joined_at)
  select m.board_id, uid, m.name, m.color, case when m.role = 'owner' then 'editor' else m.role end, m.banned, m.joined_at
  from members m where m.user_id = t.user_id
  on conflict (board_id, user_id) do update set
    -- бан не снимается ни с одной стороны, права берутся большие из двух
    banned = members.banned or excluded.banned,
    role = case
      when members.role = 'owner' then 'owner'
      when members.role = 'editor' or excluded.role = 'editor' then 'editor'
      else 'viewer' end,
    joined_at = least(members.joined_at, excluded.joined_at);

  delete from transfers where transfers.code = t.code;
  return t.payload;
end $$;

revoke execute on function public.transfer_create(jsonb), public.transfer_claim(text) from public, anon;
grant execute on function public.transfer_create(jsonb), public.transfer_claim(text) to authenticated;

notify pgrst, 'reload schema';
