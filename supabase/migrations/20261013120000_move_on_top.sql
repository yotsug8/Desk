-- Перенесённые элементы встают поверх остальных, порядок между ними сохраняется
create or replace function public.el_move(p_moves jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  m jsonb;
  e elements;
  b text;
  others int := 0;
  top bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint - jsonb_array_length(p_moves);
  i int := 0;
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
    where id = (m->>'id')::uuid and deleted_at is null;
  end loop;
end $$;
