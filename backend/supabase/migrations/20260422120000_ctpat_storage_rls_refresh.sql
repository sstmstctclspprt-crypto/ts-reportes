-- Renovación de tablas y políticas para flujo CTPAT (PDF + Drive + evidencias).
-- Objetivo:
-- 1) Asegurar tablas mínimas (idempotente).
-- 2) Normalizar buckets de Storage.
-- 3) Limpiar/recrear políticas RLS con alcance controlado.

begin;

-- =========================================================
-- 0) Función utilitaria para updated_at
-- =========================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- 1) Tabla user_drive_config
-- =========================================================
create table if not exists public.user_drive_config (
  user_id uuid not null,
  pdf_folder_id text null,
  images_folder_id text null,
  service_logo_file text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_drive_config
  add column if not exists user_id uuid,
  add column if not exists pdf_folder_id text,
  add column if not exists images_folder_id text,
  add column if not exists service_logo_file text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_drive_config_pkey'
      and conrelid = 'public.user_drive_config'::regclass
  ) then
    alter table public.user_drive_config
      add constraint user_drive_config_pkey primary key (user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_drive_config_user_id_fkey'
      and conrelid = 'public.user_drive_config'::regclass
  ) then
    alter table public.user_drive_config
      add constraint user_drive_config_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

drop trigger if exists trg_user_drive_config_set_updated_at on public.user_drive_config;
create trigger trg_user_drive_config_set_updated_at
before update on public.user_drive_config
for each row execute function public.set_updated_at();

alter table public.user_drive_config enable row level security;

drop policy if exists "udc_select_own" on public.user_drive_config;
drop policy if exists "udc_insert_own" on public.user_drive_config;
drop policy if exists "udc_update_own" on public.user_drive_config;
drop policy if exists "udc_delete_own" on public.user_drive_config;

create policy "udc_select_own"
on public.user_drive_config
for select
to authenticated
using (user_id = auth.uid());

create policy "udc_insert_own"
on public.user_drive_config
for insert
to authenticated
with check (user_id = auth.uid());

create policy "udc_update_own"
on public.user_drive_config
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "udc_delete_own"
on public.user_drive_config
for delete
to authenticated
using (user_id = auth.uid());

-- =========================================================
-- 2) Tabla registros_ctpat (mínimos que usa el flujo)
-- =========================================================
create table if not exists public.registros_ctpat (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  organization_id text null,
  service_id text null,
  folio_pdf text null,
  pdf_storage_path text null,
  drive_file_id text null,
  sharepoint_folder_seq integer null,
  operador text null,
  checklist_tracto jsonb null,
  checklist_caja jsonb null,
  inspeccion_agricola jsonb null,
  inspeccion_mecanica jsonb null,
  image_urls text[] null,
  firma_operador text null,
  firma_oficial text null,
  evidencias_exif jsonb null,
  sync_status text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.registros_ctpat
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists organization_id text,
  add column if not exists service_id text,
  add column if not exists folio_pdf text,
  add column if not exists pdf_storage_path text,
  add column if not exists drive_file_id text,
  add column if not exists sharepoint_folder_seq integer,
  add column if not exists operador text,
  add column if not exists checklist_tracto jsonb,
  add column if not exists checklist_caja jsonb,
  add column if not exists inspeccion_agricola jsonb,
  add column if not exists inspeccion_mecanica jsonb,
  add column if not exists image_urls text[],
  add column if not exists firma_operador text,
  add column if not exists firma_oficial text,
  add column if not exists evidencias_exif jsonb,
  add column if not exists sync_status text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'registros_ctpat_pkey'
      and conrelid = 'public.registros_ctpat'::regclass
  ) then
    alter table public.registros_ctpat
      add constraint registros_ctpat_pkey primary key (id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'registros_ctpat_user_id_fkey'
      and conrelid = 'public.registros_ctpat'::regclass
  ) then
    alter table public.registros_ctpat
      add constraint registros_ctpat_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_registros_ctpat_user_id on public.registros_ctpat (user_id);
create index if not exists idx_registros_ctpat_created_at on public.registros_ctpat (created_at desc);

drop trigger if exists trg_registros_ctpat_set_updated_at on public.registros_ctpat;
create trigger trg_registros_ctpat_set_updated_at
before update on public.registros_ctpat
for each row execute function public.set_updated_at();

alter table public.registros_ctpat enable row level security;

drop policy if exists "rctpat_select_own" on public.registros_ctpat;
drop policy if exists "rctpat_insert_own" on public.registros_ctpat;
drop policy if exists "rctpat_update_own" on public.registros_ctpat;
drop policy if exists "rctpat_delete_own" on public.registros_ctpat;

create policy "rctpat_select_own"
on public.registros_ctpat
for select
to authenticated
using (user_id = auth.uid());

create policy "rctpat_insert_own"
on public.registros_ctpat
for insert
to authenticated
with check (user_id = auth.uid());

create policy "rctpat_update_own"
on public.registros_ctpat
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "rctpat_delete_own"
on public.registros_ctpat
for delete
to authenticated
using (user_id = auth.uid());

-- =========================================================
-- 3) Buckets de Storage
-- =========================================================
insert into storage.buckets (id, name, public)
values
  ('ctpat-logs', 'ctpat-logs', true),
  ('ctpat-evidence', 'ctpat-evidence', false),
  ('ctpat-pdfs', 'ctpat-pdfs', false)
on conflict (id) do update
set public = excluded.public;

-- =========================================================
-- 4) Policies Storage (limpieza + recreación)
-- =========================================================
drop policy if exists "ctpat_logs_select_public" on storage.objects;
drop policy if exists "ctpat_logs_insert_own_logo" on storage.objects;
drop policy if exists "ctpat_logs_update_own_logo" on storage.objects;
drop policy if exists "ctpat_logs_delete_own_logo" on storage.objects;

drop policy if exists "ctpat_evidence_select_own" on storage.objects;
drop policy if exists "ctpat_evidence_insert_own" on storage.objects;
drop policy if exists "ctpat_evidence_update_own" on storage.objects;
drop policy if exists "ctpat_evidence_delete_own" on storage.objects;

drop policy if exists "ctpat_pdfs_select_own" on storage.objects;

-- Logos (público + escritura de su propio archivo en logos/<uid>.png|jpg|jpeg)
create policy "ctpat_logs_select_public"
on storage.objects
for select
to public
using (bucket_id = 'ctpat-logs');

create policy "ctpat_logs_insert_own_logo"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'ctpat-logs'
  and (
    name = 'logos/' || auth.uid()::text || '.png'
    or name = 'logos/' || auth.uid()::text || '.jpg'
    or name = 'logos/' || auth.uid()::text || '.jpeg'
  )
);

create policy "ctpat_logs_update_own_logo"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'ctpat-logs'
  and (
    name = 'logos/' || auth.uid()::text || '.png'
    or name = 'logos/' || auth.uid()::text || '.jpg'
    or name = 'logos/' || auth.uid()::text || '.jpeg'
  )
)
with check (
  bucket_id = 'ctpat-logs'
  and (
    name = 'logos/' || auth.uid()::text || '.png'
    or name = 'logos/' || auth.uid()::text || '.jpg'
    or name = 'logos/' || auth.uid()::text || '.jpeg'
  )
);

create policy "ctpat_logs_delete_own_logo"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'ctpat-logs'
  and (
    name = 'logos/' || auth.uid()::text || '.png'
    or name = 'logos/' || auth.uid()::text || '.jpg'
    or name = 'logos/' || auth.uid()::text || '.jpeg'
  )
);

-- Evidencias sensibles privadas: organizations/<org>/<uid>/...
create policy "ctpat_evidence_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'ctpat-evidence'
  and name like ('organizations/%/' || auth.uid()::text || '/%')
);

create policy "ctpat_evidence_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'ctpat-evidence'
  and name like ('organizations/%/' || auth.uid()::text || '/%')
);

create policy "ctpat_evidence_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'ctpat-evidence'
  and name like ('organizations/%/' || auth.uid()::text || '/%')
)
with check (
  bucket_id = 'ctpat-evidence'
  and name like ('organizations/%/' || auth.uid()::text || '/%')
);

create policy "ctpat_evidence_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'ctpat-evidence'
  and name like ('organizations/%/' || auth.uid()::text || '/%')
);

-- PDFs privados: cada usuario lee solo su carpeta <uid>/
create policy "ctpat_pdfs_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'ctpat-pdfs'
  and name like (auth.uid()::text || '/%')
);

commit;

