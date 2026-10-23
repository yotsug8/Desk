-- Простое голосование: один голос человека на элемент, без раундов и таймера.
-- Голоса живут в той же таблице votes с round = 0.
create function public.vote_toggle(p_element uuid) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  e elements;
  mine bigint;
  n int;
begin
  select * into e from elements where id = p_element and deleted_at is null and type <> 'link';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.is_member(e.board_id) then raise exception 'no_access' using errcode = '42501'; end if;
  -- одновременные нажатия одного человека проходят по очереди
  perform pg_advisory_xact_lock(hashtext(p_element::text || auth.uid()::text));
  select id into mine from votes
  where element_id = p_element and round = 0 and user_id = auth.uid() and not removed limit 1;
  if mine is null then
    insert into votes (board_id, round, element_id, user_id) values (e.board_id, 0, p_element, auth.uid());
  else
    update votes set removed = true where id = mine;
  end if;
  select count(*) into n from votes where element_id = p_element and round = 0 and not removed;
  return n;
end $$;

revoke execute on function public.vote_toggle(uuid) from public, anon;
grant execute on function public.vote_toggle(uuid) to authenticated;

notify pgrst, 'reload schema';
