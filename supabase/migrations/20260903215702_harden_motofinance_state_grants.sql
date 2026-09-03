revoke all on table public.motofinance_state from anon, authenticated;
grant select, insert, update, delete on table public.motofinance_state to authenticated;
revoke all on function public.motofinance_state_set_metadata() from public, anon, authenticated;
