-- ============================================================
-- Wetalk v2 - cloud sync for the practice workspace ("Previous Work")
--
-- The v2 practice app stores finished sessions (prompt, scores, transcript,
-- coaching tips, AI feedback) as one JSON payload. This table syncs that list
-- to the signed-in account while localStorage stays the offline cache.
--
-- Safe to re-run. Run after schema.sql (profiles/works/ai_usage).
-- ============================================================

create table if not exists public.sessions (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text,
  title text,
  started_at timestamptz,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sessions_user_started_idx
  on public.sessions (user_id, started_at desc);

comment on table public.sessions is 'Finished Wetalk v2 practice sessions (one JSON payload per session), owner-only.';

drop trigger if exists sessions_set_updated_at on public.sessions;
create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();

alter table public.sessions enable row level security;

drop policy if exists sessions_select_own on public.sessions;
create policy sessions_select_own on public.sessions
  for select using (auth.uid() = user_id);

drop policy if exists sessions_insert_own on public.sessions;
create policy sessions_insert_own on public.sessions
  for insert with check (auth.uid() = user_id);

drop policy if exists sessions_update_own on public.sessions;
create policy sessions_update_own on public.sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists sessions_delete_own on public.sessions;
create policy sessions_delete_own on public.sessions
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.sessions to authenticated;
