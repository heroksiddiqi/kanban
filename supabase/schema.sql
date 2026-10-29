-- =============================================================
-- Herok Kanban — Supabase schema
--
-- Run this ONCE in the SQL editor of a fresh Supabase project.
-- It creates the three tables, row level security, the
-- "one board per user" bootstrap function and turns on Realtime.
--
-- WARNING: the drop statements at the top delete the tables if
-- they already exist. Do not re-run this on a board you care
-- about — export a JSON backup first.
--
-- Security model: a signed-in user can only read and write rows
-- that belong to them. The publishable/anon key in the frontend
-- is safe only as long as Row Level Security stays enabled.
-- =============================================================

begin;

drop table if exists public.cards cascade;
drop table if exists public.columns cascade;
drop table if exists public.boards cascade;
drop function if exists public.ensure_board();

create extension if not exists pgcrypto;

-- ---------- tables -------------------------------------------

create table public.boards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null default 'My Board',
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- one board per user (the app is a single-board kanban)
create unique index boards_user_idx on public.boards (user_id);

create table public.columns (
  id         uuid primary key,                -- generated on the client
  board_id   uuid not null references public.boards (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null,
  color      text not null default 'slate',
  position   integer not null default 0,
  deleted    boolean not null default false,  -- tombstone so devices agree on deletes
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table public.cards (
  id         uuid primary key,                -- generated on the client
  board_id   uuid not null references public.boards (id) on delete cascade,
  column_id  uuid not null references public.columns (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null,
  notes      text not null default '',
  color      text not null default '',
  due_date   text not null default '',        -- 'YYYY-MM-DD' or ''
  position   integer not null default 0,
  deleted    boolean not null default false,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index columns_board_idx on public.columns (board_id, deleted, position);
create index cards_board_idx   on public.cards (board_id, deleted, column_id, position);
create index cards_updated_idx on public.cards (board_id, updated_at);

-- ---------- row level security -------------------------------

alter table public.boards  enable row level security;
alter table public.columns enable row level security;
alter table public.cards   enable row level security;

create policy "boards are private"
  on public.boards for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "columns are private"
  on public.columns for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "cards are private"
  on public.cards for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.boards, public.columns, public.cards from anon;
grant select, insert, update, delete on public.boards, public.columns, public.cards to authenticated;

-- ---------- board bootstrap ----------------------------------
-- Called once after sign-in: returns the user's board id and
-- seeds three starter columns the very first time.

create or replace function public.ensure_board()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.boards (user_id) values (auth.uid())
    on conflict (user_id) do nothing;

  select id into b from public.boards where user_id = auth.uid();

  if not exists (select 1 from public.columns where board_id = b) then
    insert into public.columns (id, board_id, user_id, title, color, position) values
      (gen_random_uuid(), b, auth.uid(), 'To Do', 'blue',  0),
      (gen_random_uuid(), b, auth.uid(), 'Doing', 'amber', 1),
      (gen_random_uuid(), b, auth.uid(), 'Done',  'green', 2);
  end if;

  return b;
end;
$$;

revoke all on function public.ensure_board() from public;
grant execute on function public.ensure_board() to authenticated;

-- ---------- realtime -----------------------------------------

alter table public.columns replica identity full;
alter table public.cards   replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.columns;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.cards;
  exception when duplicate_object then null;
  end;
end $$;

commit;
