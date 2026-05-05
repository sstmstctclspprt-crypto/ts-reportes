-- Nombre legible de subcarpeta para copias en OneDrive vía Power Automate (opcional; si null se usa userId en backend).

alter table public.user_drive_config
  add column if not exists onedrive_subfolder_name text null;

comment on column public.user_drive_config.onedrive_subfolder_name is
  'Etiqueta de carpeta para PDF en OneDrive/Power Automate; se envía en el webhook como onedriveSubfolder.';
