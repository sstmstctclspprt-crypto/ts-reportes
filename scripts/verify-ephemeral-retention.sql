-- Verificación manual post-deploy (Opción 2: limpieza solo BD).
-- Ejecutar en Supabase SQL Editor tras generar un PDF exitoso.

-- 1) Tras PDF + sync: checklists en NULL; firmas/evidencias siguen en BD hasta expires_at (~7 días)
select
  id,
  folio_pdf,
  drive_file_id,
  sync_status,
  purged_sensitive_at,
  expires_at,
  created_at,
  operador,
  checklist_tracto,
  image_urls,
  firma_operador,
  firma_oficial
from public.registros_ctpat
order by created_at desc
limit 5;

-- 2) Probar purge manual (simula job de 7 días)
-- update public.registros_ctpat set expires_at = now() - interval '1 minute' where id = '<REGISTRO_ID>';
-- select public.purge_expired_ctpat_registros();

-- 3) Permanente: user_drive_config intacto
select user_id, pdf_folder_id, images_folder_id, service_logo_file, onedrive_subfolder_name
from public.user_drive_config
limit 10;
