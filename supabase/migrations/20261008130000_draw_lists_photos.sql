-- Рисунки мелком, списки с галочками и фото

alter table public.elements drop constraint elements_type_check;
alter table public.elements add constraint elements_type_check
  check (type in ('note', 'text', 'link', 'draw', 'list', 'image'));

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

-- Фото: файл обязан лежать в папке своей доски, путь потом не меняется
create function public.images_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type <> 'image' then return new; end if;
  if tg_op = 'UPDATE' and (new.data->>'src') is distinct from (old.data->>'src') then
    raise exception 'bad_patch' using errcode = '22023';
  end if;
  if (new.data->>'src') !~ ('^' || new.board_id || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'bad_image' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function public.images_guard() from public, anon, authenticated;

create trigger images_guard_trg
before insert or update on public.elements
for each row execute function public.images_guard();

-- ============================================================
-- Хранилище фото: читать может любой по ссылке, класть только участник с правом правки
-- в папку своей доски; менять и удалять файлы нельзя, чтобы ничего не терялось
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy desk_images_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'images'
    and coalesce(public.my_role(split_part(name, '/', 1)), 'none') in ('owner', 'editor')
    and name ~ '^[a-z0-9]{8}/[0-9a-f-]{36}\.(jpg|png|webp)$'
  );

notify pgrst, 'reload schema';
