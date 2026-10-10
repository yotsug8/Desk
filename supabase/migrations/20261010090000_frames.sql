-- Области: подписанная рамка под элементами, двигает своё содержимое
alter table public.elements drop constraint elements_type_check;
alter table public.elements add constraint elements_type_check
  check (type in ('note', 'text', 'link', 'draw', 'list', 'image', 'frame'));

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
  if d ? 'color' and (d->>'color') <> all (case t
      when 'note' then array['yellow', 'pink', 'green', 'blue', 'white']
      when 'text' then array['ink', 'white', 'red']
      when 'draw' then array['white', 'ink', 'red', 'blue', 'yellow']
      when 'list' then array['white', 'yellow', 'blue']
      when 'frame' then array['white', 'yellow', 'green', 'blue', 'pink']
      else array['red', 'ink', 'blue', 'white'] end) then
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
  if d ? 'width' and (d->>'width') not in ('3', '6', '12') then
    raise exception 'bad_width' using errcode = '22023';
  end if;
  if t = 'image' and (jsonb_typeof(d->'src') is distinct from 'string') then
    raise exception 'bad_image' using errcode = '22023';
  end if;
  return d;
end $$;
revoke execute on function public.check_data(text, jsonb) from public, anon, authenticated;
