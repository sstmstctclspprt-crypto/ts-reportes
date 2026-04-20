-- Security hardening:
-- - Multi-tenant isolation with organization_id + RLS by org
-- - Immutability for synced records
-- - Audit trail for UPDATE/DELETE and blocked mutations
-- - Private storage bucket for sensitive evidence/signatures

-- 1) Tenant helper
create or replace function public.current_org_id()
returns text
language sql
stable
as $$
  select coalesce(nullif(auth.jwt() ->> 'org_id', ''), auth.uid()::text)
$$;

-- 2) Organization column + backfill
alter table public.registros_ctpat
  add column if not exists organization_id text;

update public.registros_ctpat r
set organization_id = coalesce(
  nullif((u.raw_app_meta_data ->> 'org_id'), ''),
  r.user_id::text
)
from auth.users u
where r.organization_id is null
  and r.user_id = u.id;

update public.registros_ctpat
set organization_id = coalesce(organization_id, user_id::text)
where organization_id is null;

create index if not exists registros_ctpat_org_idx
  on public.registros_ctpat (organization_id);

-- 3) Auto-assign tenant/owner on insert
create or replace function public.registros_ctpat_set_tenant_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;

  if new.organization_id is null or btrim(new.organization_id) = '' then
    new.organization_id := public.current_org_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_registros_ctpat_tenant_defaults on public.registros_ctpat;
create trigger set_registros_ctpat_tenant_defaults
before insert on public.registros_ctpat
for each row
execute function public.registros_ctpat_set_tenant_defaults();

-- 4) Rebuild RLS for multi-tenant
drop policy if exists "Usuarios ven sólo sus registros" on public.registros_ctpat;
drop policy if exists "Usuarios insertan sus registros" on public.registros_ctpat;
drop policy if exists "Usuarios actualizan sus registros" on public.registros_ctpat;
drop policy if exists "Usuarios borran sus registros" on public.registros_ctpat;
drop policy if exists "Usuarios ven registros de su organizacion" on public.registros_ctpat;
drop policy if exists "Usuarios insertan registros de su organizacion" on public.registros_ctpat;
drop policy if exists "Usuarios actualizan registros propios de su organizacion" on public.registros_ctpat;
drop policy if exists "Usuarios eliminan registros propios de su organizacion" on public.registros_ctpat;

create policy "Usuarios ven registros de su organizacion"
  on public.registros_ctpat
  for select
  using (
    organization_id = public.current_org_id()
  );

create policy "Usuarios insertan registros de su organizacion"
  on public.registros_ctpat
  for insert
  with check (
    auth.uid() = user_id
    and organization_id = public.current_org_id()
  );

create policy "Usuarios actualizan registros propios de su organizacion"
  on public.registros_ctpat
  for update
  using (
    auth.uid() = user_id
    and organization_id = public.current_org_id()
  )
  with check (
    auth.uid() = user_id
    and organization_id = public.current_org_id()
  );

create policy "Usuarios eliminan registros propios de su organizacion"
  on public.registros_ctpat
  for delete
  using (
    auth.uid() = user_id
    and organization_id = public.current_org_id()
  );

-- 5) Audit table
create table if not exists public.registros_ctpat_audit (
  id bigint generated always as identity primary key,
  registro_id uuid,
  organization_id text,
  actor_user_id uuid,
  action text not null,
  reason text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists registros_ctpat_audit_registro_id_idx
  on public.registros_ctpat_audit (registro_id);

create index if not exists registros_ctpat_audit_org_idx
  on public.registros_ctpat_audit (organization_id);

alter table public.registros_ctpat_audit enable row level security;

drop policy if exists "Usuarios ven auditoria de su organizacion" on public.registros_ctpat_audit;
create policy "Usuarios ven auditoria de su organizacion"
  on public.registros_ctpat_audit
  for select
  using (
    organization_id = public.current_org_id()
  );

-- 6) Immutability + audit triggers
create or replace function public.registros_ctpat_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    insert into public.registros_ctpat_audit (
      registro_id,
      organization_id,
      actor_user_id,
      action,
      old_data,
      new_data
    )
    values (
      old.id,
      old.organization_id,
      auth.uid(),
      'UPDATE',
      to_jsonb(old),
      to_jsonb(new)
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.registros_ctpat_audit (
      registro_id,
      organization_id,
      actor_user_id,
      action,
      old_data,
      new_data
    )
    values (
      old.id,
      old.organization_id,
      auth.uid(),
      'DELETE',
      to_jsonb(old),
      null
    );
    return old;
  end if;

  return null;
end;
$$;

create or replace function public.registros_ctpat_block_synced_mutations()
returns trigger
language plpgsql
as $$
begin
  if old.sync_status = 'synced' then
    insert into public.registros_ctpat_audit (
      registro_id,
      organization_id,
      actor_user_id,
      action,
      reason,
      old_data,
      new_data
    )
    values (
      old.id,
      old.organization_id,
      auth.uid(),
      'BLOCKED_' || tg_op,
      'Registro inmutable: sync_status=synced',
      to_jsonb(old),
      case when tg_op = 'UPDATE' then to_jsonb(new) else null end
    );

    raise exception 'Registro inmutable: no se permite % cuando sync_status = synced', tg_op;
  end if;

  if tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_registros_ctpat_immutable on public.registros_ctpat;
create trigger trg_registros_ctpat_immutable
before update or delete on public.registros_ctpat
for each row
execute function public.registros_ctpat_block_synced_mutations();

drop trigger if exists trg_registros_ctpat_audit on public.registros_ctpat;
create trigger trg_registros_ctpat_audit
after update or delete on public.registros_ctpat
for each row
execute function public.registros_ctpat_audit_mutation();

-- 7) Keep cleanup away from immutable/synced records
create or replace function public.cleanup_registros_ctpat(p_days integer default 30)
returns void
language plpgsql
as $$
begin
  delete from public.registros_ctpat
  where created_at < now() - make_interval(days => p_days)
    and sync_status = 'error';
end;
$$;

-- 8) Private bucket for sensitive photos/signatures
insert into storage.buckets (id, name, public, file_size_limit)
values ('ctpat-evidence', 'ctpat-evidence', false, 52428800)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "Users read own org evidence" on storage.objects;
create policy "Users read own org evidence"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'ctpat-evidence'
  and (storage.foldername(name))[1] = 'organizations'
  and (storage.foldername(name))[2] = public.current_org_id()
  and (storage.foldername(name))[3] = auth.uid()::text
);

drop policy if exists "Users insert own org evidence" on storage.objects;
create policy "Users insert own org evidence"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'ctpat-evidence'
  and (storage.foldername(name))[1] = 'organizations'
  and (storage.foldername(name))[2] = public.current_org_id()
  and (storage.foldername(name))[3] = auth.uid()::text
);

drop policy if exists "Users update own org evidence" on storage.objects;
create policy "Users update own org evidence"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'ctpat-evidence'
  and (storage.foldername(name))[1] = 'organizations'
  and (storage.foldername(name))[2] = public.current_org_id()
  and (storage.foldername(name))[3] = auth.uid()::text
)
with check (
  bucket_id = 'ctpat-evidence'
  and (storage.foldername(name))[1] = 'organizations'
  and (storage.foldername(name))[2] = public.current_org_id()
  and (storage.foldername(name))[3] = auth.uid()::text
);

drop policy if exists "Users delete own org evidence" on storage.objects;
create policy "Users delete own org evidence"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'ctpat-evidence'
  and (storage.foldername(name))[1] = 'organizations'
  and (storage.foldername(name))[2] = public.current_org_id()
  and (storage.foldername(name))[3] = auth.uid()::text
);
