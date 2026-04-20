-- SharePoint (Graph app-only): las carpetas ya no son IDs de Google Drive por usuario.
-- La Edge Function usa rutas fijas bajo TS REPORTES/users/<user_id>/...

alter table public.user_drive_config
  alter column pdf_folder_id drop not null;

alter table public.user_drive_config
  alter column images_folder_id drop not null;

comment on column public.user_drive_config.pdf_folder_id is
  'Opcional / legado Google Drive. SharePoint usa rutas en Microsoft Graph.';

comment on column public.user_drive_config.images_folder_id is
  'Opcional / legado Google Drive. SharePoint usa rutas en Microsoft Graph.';
