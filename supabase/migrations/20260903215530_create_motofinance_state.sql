create table public.motofinance_state (
    user_id uuid primary key references auth.users(id) on delete cascade,
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    version bigint not null default 1,
    constraint motofinance_state_version_positive check (version >= 1)
);

alter table public.motofinance_state enable row level security;

revoke all on table public.motofinance_state from anon;
grant select, insert, update, delete on table public.motofinance_state to authenticated;

create policy "motofinance_state_select_own"
on public.motofinance_state
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "motofinance_state_insert_own"
on public.motofinance_state
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "motofinance_state_update_own"
on public.motofinance_state
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "motofinance_state_delete_own"
on public.motofinance_state
for delete
to authenticated
using ((select auth.uid()) = user_id);

create function public.motofinance_state_set_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        new.version := 1;
        new.updated_at := now();
    else
        if new.version <> old.version + 1 then
            raise exception using
                errcode = '40001',
                message = 'motofinance_state version conflict';
        end if;
        new.updated_at := now();
    end if;
    return new;
end;
$$;

create trigger motofinance_state_set_metadata_before_write
before insert or update on public.motofinance_state
for each row execute function public.motofinance_state_set_metadata();
