-- Фон доски: пробка, клетка как в тетради, линейка или чистый лист.
-- Общий для всех участников; меняет любой, кто может править; смена пишется в историю.

alter table public.boards add column if not exists bg text not null default 'cork'
  check (bg in ('cork', 'grid', 'lines', 'plain'));

create or replace function public.board_info(p_board text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', b.id, 'title', b.title, 'readonly_for_new', b.readonly_for_new, 'bg', b.bg,
    'me', (select to_jsonb(m) - 'board_id' from members m where m.board_id = b.id and m.user_id = auth.uid())
  )
  from boards b where b.id = p_board;
$$;

create or replace function public.set_background(p_board text, p_bg text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.require_editor(p_board);
  if p_bg not in ('cork', 'grid', 'lines', 'plain') then raise exception 'bad_background' using errcode = '22023'; end if;
  update boards set bg = p_bg where id = p_board and bg <> p_bg;
  if found then
    insert into history (board_id, user_id, action, after) values (p_board, auth.uid(), 'background', jsonb_build_object('bg', p_bg));
  end if;
end $$;

revoke execute on function public.set_background(text, text) from public, anon;
grant execute on function public.set_background(text, text) to authenticated;

notify pgrst, 'reload schema';
