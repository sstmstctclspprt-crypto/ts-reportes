-- Retención efímera en BD: columnas de auditoría + purge automático a los 7 días.
-- No afecta Storage ni PDFs en Google Drive / OneDrive.

begin;

alter table public.registros_ctpat
  add column if not exists expires_at timestamptz null,
  add column if not exists purged_sensitive_at timestamptz null;

comment on column public.registros_ctpat.expires_at is
  'Fecha límite para DELETE de la fila (7 días tras sanitizar datos sensibles).';
comment on column public.registros_ctpat.purged_sensitive_at is
  'Marca cuándo se anularon checklists, firmas y evidencias en BD tras PDF exitoso.';

create index if not exists idx_registros_ctpat_expires_at
  on public.registros_ctpat (expires_at)
  where expires_at is not null;

create index if not exists idx_registros_ctpat_pending_sync
  on public.registros_ctpat (user_id, sync_status)
  where sync_status is distinct from 'synced';

create or replace function public.purge_expired_ctpat_registros()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  delete from public.registros_ctpat
  where expires_at is not null
    and expires_at < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

comment on function public.purge_expired_ctpat_registros() is
  'Elimina filas de registros_ctpat cuya expires_at ya venció (solo BD).';

revoke all on function public.purge_expired_ctpat_registros() from public;
grant execute on function public.purge_expired_ctpat_registros() to service_role;

-- pg_cron: habilitar extensión en Supabase Dashboard (Database → Extensions) en plan Pro.
do $outer$
declare
  jid integer;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron no disponible; programa purge-expired-ctpat-data en Edge Functions → Cron.';
    return;
  end if;

  select jobid into jid from cron.job where jobname = 'purge-ctpat-bd' limit 1;
  if jid is not null then
    perform cron.unschedule(jid);
  end if;

  perform cron.schedule(
    'purge-ctpat-bd',
    '0 3 * * *',
    $cmd$ select public.purge_expired_ctpat_registros(); $cmd$
  );
exception
  when undefined_table or invalid_schema_name then
    raise notice 'pg_cron no disponible; use Edge Function purge-expired-ctpat-data con cron del Dashboard.';
  when others then
    raise notice 'pg_cron schedule omitido: %', sqlerrm;
end;
$outer$;

commit;
