-- =============================================================
-- APA (Apaworld) database setup, version 1
-- Run in order on a new Supabase project. Contains no secrets.
-- =============================================================

-- 01 keepalive table ------------------------------------------
create table public.keepalive (
  id int primary key,
  note text
);
insert into public.keepalive (id, note) values (1, 'APA keep-alive');
alter table public.keepalive enable row level security;
create policy "Public can read keepalive"
  on public.keepalive for select to anon using (true);

-- 02 keepalive grant ------------------------------------------
grant select on public.keepalive to anon;

-- 03 profiles -------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  language text default 'en',
  created_at timestamptz not null default now(),
  is_blocked boolean not null default false
);
alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
grant update (display_name, language) on public.profiles to authenticated;
create policy "Users read own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "Users update own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
create function public.handle_new_user()
returns trigger language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 04 user_settings --------------------------------------------
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint settings_size_limit check (pg_column_size(settings) < 100000)
);
alter table public.user_settings enable row level security;
grant select, insert, update on public.user_settings to authenticated;
create policy "Users read own settings"
  on public.user_settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users create own settings"
  on public.user_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users update own settings"
  on public.user_settings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 05 admins ---------------------------------------------------
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'super_admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
create function public.is_admin()
returns boolean language sql stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admins
    where user_id = (select auth.uid()) and is_active
  )
  and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
  and exists (
    select 1
    from jsonb_array_elements(coalesce((select auth.jwt() -> 'amr'), '[]'::jsonb)) as m
    where m ->> 'method' = 'totp'
      and (m ->> 'timestamp')::bigint > extract(epoch from now()) - 8 * 3600
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- 06 tickets --------------------------------------------------
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint generated always as identity (start with 100001) unique,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject text not null check (char_length(subject) between 3 and 200),
  message text not null check (char_length(message) between 1 and 5000),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'answered', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tickets enable row level security;
grant select on public.tickets to authenticated;
grant insert (subject, message) on public.tickets to authenticated;
grant update (status, updated_at) on public.tickets to authenticated;
create policy "Users create own tickets"
  on public.tickets for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Users read own tickets"
  on public.tickets for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Admins read all tickets"
  on public.tickets for select to authenticated
  using ((select public.is_admin()));
create policy "Admins update tickets"
  on public.tickets for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 07 admin_activity_log ---------------------------------------
create table public.admin_activity_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  action text not null check (char_length(action) between 2 and 100),
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_activity_log enable row level security;
revoke all on public.admin_activity_log from anon, authenticated;
grant select on public.admin_activity_log to authenticated;
create policy "Admins read activity log"
  on public.admin_activity_log for select to authenticated
  using ((select public.is_admin()));
create function public.prevent_log_changes()
returns trigger language plpgsql
as $$
begin
  raise exception 'The admin activity log cannot be changed or deleted';
end;
$$;
create trigger admin_log_no_change
  before update or delete on public.admin_activity_log
  for each row execute function public.prevent_log_changes();
create trigger admin_log_no_truncate
  before truncate on public.admin_activity_log
  for each statement execute function public.prevent_log_changes();
create function public.log_admin_action(
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_details jsonb default '{}'::jsonb
)
returns void language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  insert into public.admin_activity_log (admin_id, action, target_type, target_id, details)
  values ((select auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
end;
$$;
revoke all on function public.log_admin_action(text, text, text, jsonb) from public, anon;
grant execute on function public.log_admin_action(text, text, text, jsonb) to authenticated;

-- 08 admin_login_history --------------------------------------
create table public.admin_login_history (
  id bigint generated always as identity primary key,
  admin_id uuid,
  attempted_email text,
  event text not null check (event in (
    'login_success', 'login_failed', 'mfa_success', 'mfa_failed',
    'passkey_success', 'passkey_failed', 'backup_code_used', 'logout', 'blocked'
  )),
  ip inet,
  provider text,
  asn integer,
  connection_type text,
  country text,
  city text,
  device text,
  user_agent text,
  alert_level text not null default 'info'
    check (alert_level in ('info', 'warning', 'critical')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_login_history enable row level security;
revoke all on public.admin_login_history from anon, authenticated;
grant select on public.admin_login_history to authenticated;
create policy "Admins read login history"
  on public.admin_login_history for select to authenticated
  using ((select public.is_admin()));
create function public.protect_login_history()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'DELETE' and old.created_at < now() - interval '12 months' then
    return old;
  end if;
  raise exception 'The admin login history cannot be changed or deleted';
end;
$$;
create trigger login_history_protect
  before update or delete on public.admin_login_history
  for each row execute function public.protect_login_history();
create trigger login_history_no_truncate
  before truncate on public.admin_login_history
  for each statement execute function public.prevent_log_changes();
create index admin_login_history_admin_date
  on public.admin_login_history (admin_id, created_at desc);

-- 09 tickets channels (WhatsApp, email, SMS) ---------------------
alter table public.tickets alter column user_id drop not null;
alter table public.tickets
  add column channel text not null default 'web'
    check (channel in ('web', 'email', 'whatsapp', 'sms')),
  add column contact text;
grant select, insert on public.tickets to service_role;
