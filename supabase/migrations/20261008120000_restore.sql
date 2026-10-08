-- Вернуть снятые элементы сразу после снятия (в истории это запись restore)
create function public.el_restore(p_ids uuid[]) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  b text;
  n int := 0;
  i uuid;
begin
  if coalesce(array_length(p_ids, 1), 0) > 500 then raise exception 'bad_patch' using errcode = '22023'; end if;
  perform set_config('desk.batch', gen_random_uuid()::text, true);
  foreach i in array p_ids loop
    select board_id into b from elements where id = i and deleted_at is not null;
    if b is null then continue; end if;
    perform public.require_editor(b);
    update elements set deleted_at = null, version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = i;
    n := n + 1;
  end loop;
  perform set_config('desk.batch', '', true);
  return n;
end $$;

revoke execute on function public.el_restore(uuid[]) from public, anon;
grant execute on function public.el_restore(uuid[]) to authenticated;

notify pgrst, 'reload schema';
