-- Carpeta individual por registro en SharePoint: TS-REPORTES S1, S2, ... (secuencia por usuario).

alter table public.registros_ctpat
  add column if not exists sharepoint_folder_seq bigint;

comment on column public.registros_ctpat.sharepoint_folder_seq is
  'Número Sn de la carpeta TS-REPORTES Sn para este registro; evita reasignar secuencia en reintentos.';

alter table public.user_drive_config
  add column if not exists sharepoint_report_seq bigint not null default 0;

comment on column public.user_drive_config.sharepoint_report_seq is
  'Contador para carpetas TS-REPORTES Sn en SharePoint (por usuario); incremento atómico al subir cada PDF.';

create or replace function public.next_sharepoint_report_seq(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq bigint;
begin
  insert into public.user_drive_config (user_id, sharepoint_report_seq)
  values (p_user_id, 1)
  on conflict (user_id) do update
    set sharepoint_report_seq = user_drive_config.sharepoint_report_seq + 1
  returning sharepoint_report_seq into v_seq;

  return v_seq;
end;
$$;

revoke all on function public.next_sharepoint_report_seq(uuid) from public;
grant execute on function public.next_sharepoint_report_seq(uuid) to service_role;
