-- Control de acceso: códigos de invitación (admin) + aprobación manual + RLS en flujo CTPAT.

begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- =========================================================
-- 1) Tablas
-- =========================================================

create table if not exists public.app_admin_emails (
  email citext primary key,
  created_at timestamptz not null default now()
);

comment on table public.app_admin_emails is
  'Emails que serán admin/aprobados al primer login. Insertar antes del go-live: insert into app_admin_emails(email) values (''tu@correo.com'');';

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.user_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email citext null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  approved_at timestamptz null,
  approved_by uuid null references auth.users (id) on delete set null,
  redeemed_code_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.access_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  label text null,
  created_by uuid null references auth.users (id) on delete set null,
  max_uses integer not null default 1 check (max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0),
  expires_at timestamptz null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_access_status on public.user_access (status);
create index if not exists idx_access_codes_active on public.access_codes (is_active) where is_active = true;

drop trigger if exists trg_user_access_set_updated_at on public.user_access;
create trigger trg_user_access_set_updated_at
before update on public.user_access
for each row execute function public.set_updated_at();

alter table public.app_admin_emails enable row level security;
alter table public.app_admins enable row level security;
alter table public.user_access enable row level security;
alter table public.access_codes enable row level security;

-- =========================================================
-- 2) Helpers
-- =========================================================

create or replace function public.hash_access_code(plain_code text)
returns text
language sql
immutable
strict
as $$
  select encode(extensions.digest(upper(trim(plain_code)), 'sha256'), 'hex');
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_admins a where a.user_id = auth.uid()
  );
$$;

create or replace function public.is_user_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_access ua
    where ua.user_id = auth.uid()
      and ua.status = 'approved'
  );
$$;

-- =========================================================
-- 3) RPC: contexto de acceso tras login
-- =========================================================

create or replace function public.sync_user_access_context()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_status text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;

  insert into public.user_access (user_id, email, status)
  values (v_uid, v_email, 'pending')
  on conflict (user_id) do nothing;

  update public.user_access
  set email = v_email, updated_at = now()
  where user_id = v_uid;

  if exists (
    select 1 from public.app_admin_emails ae
    where lower(ae.email::text) = lower(coalesce(v_email, ''))
  ) then
    insert into public.app_admins (user_id) values (v_uid)
    on conflict (user_id) do nothing;

    update public.user_access
    set
      status = 'approved',
      approved_at = coalesce(approved_at, now()),
      approved_by = coalesce(approved_by, v_uid),
      updated_at = now()
    where user_id = v_uid
      and status <> 'approved';
  end if;

  select ua.status into v_status from public.user_access ua where ua.user_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'status', coalesce(v_status, 'pending'),
    'is_admin', public.is_app_admin()
  );
end;
$$;

-- =========================================================
-- 4) RPC: canjear código de acceso
-- =========================================================

create or replace function public.redeem_access_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_hash text;
  v_code public.access_codes%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Debes iniciar sesión primero.');
  end if;

  if p_code is null or length(trim(p_code)) < 4 then
    return jsonb_build_object('ok', false, 'error', 'Código inválido.');
  end if;

  v_hash := public.hash_access_code(p_code);

  select * into v_code
  from public.access_codes ac
  where ac.code_hash = v_hash
    and ac.is_active = true
    and ac.use_count < ac.max_uses
    and (ac.expires_at is null or ac.expires_at > now())
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Código inválido, expirado o ya utilizado.');
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;

  update public.access_codes
  set use_count = use_count + 1
  where id = v_code.id;

  insert into public.user_access (user_id, email, status, approved_at, approved_by, redeemed_code_id)
  values (v_uid, v_email, 'approved', now(), null, v_code.id)
  on conflict (user_id) do update
  set
    status = 'approved',
    approved_at = coalesce(public.user_access.approved_at, now()),
    redeemed_code_id = v_code.id,
    updated_at = now();

  return jsonb_build_object('ok', true, 'status', 'approved');
end;
$$;

-- =========================================================
-- 5) RPC: admin — crear código
-- =========================================================

create or replace function public.admin_create_access_code(
  p_label text default null,
  p_max_uses integer default 1,
  p_expires_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plain text;
  v_hash text;
  v_id uuid;
begin
  if not public.is_app_admin() then
    return jsonb_build_object('ok', false, 'error', 'No autorizado.');
  end if;

  if p_max_uses is null or p_max_uses < 1 then
    p_max_uses := 1;
  end if;

  v_plain := 'TS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_hash := public.hash_access_code(v_plain);

  insert into public.access_codes (code_hash, label, created_by, max_uses, expires_at)
  values (
    v_hash,
    nullif(trim(p_label), ''),
    auth.uid(),
    p_max_uses,
    case
      when p_expires_days is null or p_expires_days < 1 then null
      else now() + make_interval(days => p_expires_days)
    end
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'code', v_plain,
    'id', v_id,
    'max_uses', p_max_uses
  );
end;
$$;

-- =========================================================
-- 6) RPC: admin — aprobar / rechazar / pendiente
-- =========================================================

create or replace function public.admin_set_user_access(
  p_user_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    return jsonb_build_object('ok', false, 'error', 'No autorizado.');
  end if;

  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'user_id requerido.');
  end if;

  if p_status not in ('pending', 'approved', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'Estado inválido.');
  end if;

  update public.user_access
  set
    status = p_status,
    approved_at = case when p_status = 'approved' then coalesce(approved_at, now()) else null end,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    updated_at = now()
  where user_id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Usuario no encontrado.');
  end if;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- =========================================================
-- 7) RPC: admin — listar usuarios
-- =========================================================

create or replace function public.admin_list_user_access()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_app_admin() then
    return jsonb_build_object('ok', false, 'error', 'No autorizado.');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', ua.user_id,
      'email', ua.email,
      'status', ua.status,
      'approved_at', ua.approved_at,
      'created_at', ua.created_at,
      'updated_at', ua.updated_at
    )
    order by ua.created_at desc
  ), '[]'::jsonb)
  into v_rows
  from public.user_access ua;

  return jsonb_build_object('ok', true, 'users', v_rows);
end;
$$;

create or replace function public.admin_list_access_codes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_app_admin() then
    return jsonb_build_object('ok', false, 'error', 'No autorizado.');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ac.id,
      'label', ac.label,
      'max_uses', ac.max_uses,
      'use_count', ac.use_count,
      'expires_at', ac.expires_at,
      'is_active', ac.is_active,
      'created_at', ac.created_at
    )
    order by ac.created_at desc
  ), '[]'::jsonb)
  into v_rows
  from public.access_codes ac;

  return jsonb_build_object('ok', true, 'codes', v_rows);
end;
$$;

-- =========================================================
-- 8) RLS tablas de acceso
-- =========================================================

drop policy if exists "app_admin_emails_admin_select" on public.app_admin_emails;
create policy "app_admin_emails_admin_select"
on public.app_admin_emails for select to authenticated
using (public.is_app_admin());

drop policy if exists "app_admins_admin_select" on public.app_admins;
create policy "app_admins_admin_select"
on public.app_admins for select to authenticated
using (public.is_app_admin());

drop policy if exists "user_access_select_own" on public.user_access;
drop policy if exists "user_access_select_admin" on public.user_access;

create policy "user_access_select_own"
on public.user_access for select to authenticated
using (user_id = auth.uid());

create policy "user_access_select_admin"
on public.user_access for select to authenticated
using (public.is_app_admin());

drop policy if exists "access_codes_admin_select" on public.access_codes;
create policy "access_codes_admin_select"
on public.access_codes for select to authenticated
using (public.is_app_admin());

-- =========================================================
-- 9) RLS flujo CTPAT — solo usuarios aprobados
-- =========================================================

drop policy if exists "rctpat_select_own" on public.registros_ctpat;
drop policy if exists "rctpat_insert_own" on public.registros_ctpat;
drop policy if exists "rctpat_update_own" on public.registros_ctpat;
drop policy if exists "rctpat_delete_own" on public.registros_ctpat;

create policy "rctpat_select_own"
on public.registros_ctpat for select to authenticated
using (user_id = auth.uid() and public.is_user_approved());

create policy "rctpat_insert_own"
on public.registros_ctpat for insert to authenticated
with check (user_id = auth.uid() and public.is_user_approved());

create policy "rctpat_update_own"
on public.registros_ctpat for update to authenticated
using (user_id = auth.uid() and public.is_user_approved())
with check (user_id = auth.uid() and public.is_user_approved());

create policy "rctpat_delete_own"
on public.registros_ctpat for delete to authenticated
using (user_id = auth.uid() and public.is_user_approved());

drop policy if exists "udc_select_own" on public.user_drive_config;
drop policy if exists "udc_insert_own" on public.user_drive_config;
drop policy if exists "udc_update_own" on public.user_drive_config;
drop policy if exists "udc_delete_own" on public.user_drive_config;

create policy "udc_select_own"
on public.user_drive_config for select to authenticated
using (user_id = auth.uid() and public.is_user_approved());

create policy "udc_insert_own"
on public.user_drive_config for insert to authenticated
with check (user_id = auth.uid() and public.is_user_approved());

create policy "udc_update_own"
on public.user_drive_config for update to authenticated
using (user_id = auth.uid() and public.is_user_approved())
with check (user_id = auth.uid() and public.is_user_approved());

create policy "udc_delete_own"
on public.user_drive_config for delete to authenticated
using (user_id = auth.uid() and public.is_user_approved());

drop policy if exists "ctpat_evidence_select_own" on storage.objects;
drop policy if exists "ctpat_evidence_insert_own" on storage.objects;
drop policy if exists "ctpat_evidence_update_own" on storage.objects;
drop policy if exists "ctpat_evidence_delete_own" on storage.objects;

create policy "ctpat_evidence_select_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'ctpat-evidence'
  and public.is_user_approved()
  and name like ('organizations/%/' || auth.uid()::text || '/%')
);

create policy "ctpat_evidence_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ctpat-evidence'
  and public.is_user_approved()
  and name like ('organizations/%/' || auth.uid()::text || '/%')
);

create policy "ctpat_evidence_update_own"
on storage.objects for update to authenticated
using (
  bucket_id = 'ctpat-evidence'
  and public.is_user_approved()
  and name like ('organizations/%/' || auth.uid()::text || '/%')
)
with check (
  bucket_id = 'ctpat-evidence'
  and public.is_user_approved()
  and name like ('organizations/%/' || auth.uid()::text || '/%')
);

create policy "ctpat_evidence_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'ctpat-evidence'
  and public.is_user_approved()
  and name like ('organizations/%/' || auth.uid()::text || '/%')
);

-- =========================================================
-- 10) Grants RPC
-- =========================================================

revoke all on function public.sync_user_access_context() from public;
revoke all on function public.redeem_access_code(text) from public;
revoke all on function public.admin_create_access_code(text, integer, integer) from public;
revoke all on function public.admin_set_user_access(uuid, text) from public;
revoke all on function public.admin_list_user_access() from public;
revoke all on function public.admin_list_access_codes() from public;

grant execute on function public.sync_user_access_context() to authenticated;
grant execute on function public.redeem_access_code(text) to authenticated;
grant execute on function public.admin_create_access_code(text, integer, integer) to authenticated;
grant execute on function public.admin_set_user_access(uuid, text) to authenticated;
grant execute on function public.admin_list_user_access() to authenticated;
grant execute on function public.admin_list_access_codes() to authenticated;

commit;
