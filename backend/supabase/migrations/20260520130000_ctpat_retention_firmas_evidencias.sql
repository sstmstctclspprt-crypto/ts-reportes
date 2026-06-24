-- Firmas y evidencias en BD: se conservan hasta expires_at (7 días) y se eliminan con la fila.

begin;

comment on column public.registros_ctpat.expires_at is
  'Fecha límite para DELETE de la fila completa (firmas, image_urls, checklists) — típicamente 7 días desde el alta.';
comment on column public.registros_ctpat.purged_sensitive_at is
  'Marca cuándo se anularon checklists/inspección tras PDF exitoso; firmas y evidencias siguen hasta expires_at.';

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
  where (expires_at is not null and expires_at < now())
     or (expires_at is null and created_at < now() - interval '7 days');

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

commit;
