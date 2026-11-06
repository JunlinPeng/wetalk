-- ============================================================
-- Wetalk - Supabase schema
--
-- Run this ONCE in the Supabase SQL editor:
--   Dashboard > SQL Editor > New query > paste all of this > Run
--
-- It creates the tables the web app uses:
--   public.profiles  - one row per auth user (public username)
--   public.works     - saved scripts / practice schedules per user
--   public.ai_usage  - daily AI quota accounting (written by the
--                      ai-feedback Edge Function with the service role)
--
-- Every table has Row Level Security enabled: a signed-in user can
-- only read and write their own rows. The browser only ever uses the
-- public anon key, so RLS is the actual security boundary.
--
-- Safe to re-run: it uses IF NOT EXISTS / CREATE OR REPLACE and drops
-- each trigger and policy before recreating it.
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$')
);

comment on table public.profiles is 'Public profile for each Wetalk account (one row per auth.users row).';
comment on column public.profiles.username is 'Lowercase handle, 3-20 chars [a-z0-9_], unique. Visible to the owner only (RLS).';

-- ------------------------------------------------------------
-- 2. works (saved scripts + schedules)
-- ------------------------------------------------------------
create table if not exists public.works (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  mode text,
  speech text,
  schedule jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists works_user_updated_idx
  on public.works (user_id, updated_at desc);

comment on table public.works is 'A saved Wetalk work: speech draft and/or practice schedule, owned by one user.';
comment on column public.works.id is 'Client-generated work id (e.g. wl3k2j9abc); unique across the table.';
comment on column public.works.schedule is 'JSON snapshot of the practice schedule produced by the app.';

-- ------------------------------------------------------------
-- 3. ai_usage (daily quota accounting)
-- ------------------------------------------------------------
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  requests integer not null default 0 check (requests >= 0),
  tokens integer not null default 0 check (tokens >= 0),
  primary key (user_id, day)
);

comment on table public.ai_usage is 'Per-user, per-day AI request/token counters. Written by the ai-feedback Edge Function with the service role key; clients may only read their own rows.';

-- ------------------------------------------------------------
-- 4. updated_at trigger
-- ------------------------------------------------------------
-- profiles always stamp the server time.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- works: the app syncs by updated_at, so a client-supplied value is kept
-- (upsert sends an ISO-8601 timestamp); otherwise the server stamps now().
create or replace function public.set_works_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.updated_at is null then
    new.updated_at = now();
  elsif tg_op = 'UPDATE' and new.updated_at is not distinct from old.updated_at then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists works_set_updated_at on public.works;
create trigger works_set_updated_at
  before insert or update on public.works
  for each row execute function public.set_works_updated_at();

-- ------------------------------------------------------------
-- 5. create a profile automatically for every new auth user
--
-- Username resolution order:
--   a) raw_user_meta_data.username (email sign-up sends this)
--   b) derived from the email local part (OAuth users)
--   c) "user"
-- A numeric suffix is added when the handle is already taken so the
-- trigger can never block a sign-up.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate text;
  v_base text;
  v_suffix integer := 0;
begin
  v_candidate := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_candidate := regexp_replace(v_candidate, '[^a-z0-9_]', '', 'g');
  v_candidate := left(v_candidate, 20);

  if length(v_candidate) < 3 then
    v_candidate := lower(coalesce(split_part(new.email, '@', 1), ''));
    v_candidate := regexp_replace(v_candidate, '[^a-z0-9_]', '', 'g');
    v_candidate := left(v_candidate, 15);
    if length(v_candidate) < 3 then
      v_candidate := 'user';
    end if;
  end if;

  -- v_base is the *original* candidate; the loop rebuilds v_candidate from it
  -- so a collision on "john" yields "john_1", never a too-short string.
  v_base := v_candidate;

  loop
    exit when not exists (
      select 1 from public.profiles where username = v_candidate
    );
    v_suffix := v_suffix + 1;
    v_candidate := left(v_base, greatest(3, 19 - length(v_suffix::text)))
                   || '_' || v_suffix::text;
    if v_suffix > 500 then
      v_candidate := 'user_' || left(replace(new.id::text, '-', ''), 8);
      exit;
    end if;
  end loop;

  insert into public.profiles (id, username, email)
  values (new.id, v_candidate, new.email)
  on conflict (id) do update set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 6. RPC: check a username before sign-up
-- Callable with the anon key (client-side pre-validation). Returns
-- true when the handle is free. Existing usernames stay private:
-- only a boolean is exposed, never the matching row.
-- ------------------------------------------------------------
create or replace function public.username_available(candidate text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1 from public.profiles
    where username = lower(trim(candidate))
  );
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

comment on function public.username_available(text) is 'True when a username is free. Used by signup.html before calling auth.signUp().';

-- ------------------------------------------------------------
-- 7. Row Level Security - owner-only policies
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.works enable row level security;
alter table public.ai_usage enable row level security;

-- profiles: a user may read and update only their own profile.
-- Insert is normally done by the handle_new_user trigger (definer);
-- the insert policy also allows a user to self-provision a profile.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- works: full CRUD restricted to the owning user.
drop policy if exists works_select_own on public.works;
create policy works_select_own on public.works
  for select using (auth.uid() = user_id);

drop policy if exists works_insert_own on public.works;
create policy works_insert_own on public.works
  for insert with check (auth.uid() = user_id);

drop policy if exists works_update_own on public.works;
create policy works_update_own on public.works
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists works_delete_own on public.works;
create policy works_delete_own on public.works
  for delete using (auth.uid() = user_id);

-- ai_usage: read-only for the owner. The Edge Function writes with the
-- service role key, which bypasses RLS by design.
drop policy if exists ai_usage_select_own on public.ai_usage;
create policy ai_usage_select_own on public.ai_usage
  for select using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 8. Grants (authenticated users use the API through RLS)
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.works to authenticated;
grant select on public.ai_usage to authenticated;