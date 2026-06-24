-- Permite borrar usuarios desde Authentication sin "Database error deleting user".
-- Causas típicas: FK sin ON DELETE CASCADE y archivos en Storage.

begin;

-- =========================================================
-- 1) FK → auth.users con CASCADE / SET NULL explícito
-- =========================================================

alter table public.registros_ctpat
  drop constraint if exists registros_ctpat_user_id_fkey;
alter table public.registros_ctpat
  add constraint registros_ctpat_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.user_drive_config
  drop constraint if exists user_drive_config_user_id_fkey;
alter table public.user_drive_config
  add constraint user_drive_config_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.app_admins
  drop constraint if exists app_admins_user_id_fkey;
alter table public.app_admins
  add constraint app_admins_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.user_access
  drop constraint if exists user_access_user_id_fkey;
alter table public.user_access
  add constraint user_access_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.user_access
  drop constraint if exists user_access_approved_by_fkey;
alter table public.user_access
  add constraint user_access_approved_by_fkey
  foreign key (approved_by) references auth.users (id) on delete set null;

alter table public.access_codes
  drop constraint if exists access_codes_created_by_fkey;
alter table public.access_codes
  add constraint access_codes_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.user_access
  drop constraint if exists user_access_redeemed_code_id_fkey;
alter table public.user_access
  add constraint user_access_redeemed_code_id_fkey
  foreign key (redeemed_code_id) references public.access_codes (id) on delete set null;

-- =========================================================
-- 2) Limpieza de Storage + datos públicos (ejecutar antes de borrar en Auth)
-- =========================================================

create or replace function public.cleanup_user_storage(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  deleted_count bigint;
begin
  delete from storage.objects
  where bucket_id in ('ctpat-evidence', 'ctpat-pdfs', 'ctpat-logs')
    and (
      owner = p_user_id
      or name like p_user_id::text || '/%'
      or name like '%/' || p_user_id::text || '/%'
      or name like 'logos/' || p_user_id::text || '.%'
    );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.admin_prepare_user_delete(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_storage bigint;
begin
  if not public.is_app_admin() then
    return jsonb_build_object('ok', false, 'error', 'No autorizado.');
  end if;

  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'user_id requerido.');
  end if;

  v_storage := public.cleanup_user_storage(p_user_id);

  delete from public.registros_ctpat where user_id = p_user_id;
  delete from public.user_drive_config where user_id = p_user_id;
  delete from public.user_access where user_id = p_user_id;
  delete from public.app_admins where user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'storage_objects_deleted', v_storage,
    'message', 'Datos públicos eliminados. Ahora borra el usuario en Authentication.'
  );
end;
$$;

revoke all on function public.cleanup_user_storage(uuid) from public;
revoke all on function public.admin_prepare_user_delete(uuid) from public;
grant execute on function public.cleanup_user_storage(uuid) to service_role;
grant execute on function public.admin_prepare_user_delete(uuid) to authenticated;

commit;
