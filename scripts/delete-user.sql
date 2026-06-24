-- Si falla "Database error deleting user" en Supabase Authentication:
-- 1) Diagnóstico: qué tablas bloquean el borrado
select
  conrelid::regclass as referencing_table,
  a.attname as referencing_column,
  c.conname as constraint_name,
  case c.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
  end as on_delete
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
join pg_class ref on ref.oid = c.confrelid
join pg_namespace n on n.oid = ref.relnamespace
where c.contype = 'f'
  and n.nspname = 'auth'
  and ref.relname = 'users'
order by referencing_table;

-- 2) Sustituye el UUID y ejecuta (requiere migración fix_auth_user_delete_cascade aplicada)
-- select public.admin_prepare_user_delete('00000000-0000-0000-0000-000000000000'::uuid);

-- 3) Luego borra el usuario en Dashboard → Authentication → Users → Delete

-- Alternativa manual sin RPC:
-- select public.cleanup_user_storage('UUID-AQUI'::uuid);
-- delete from public.registros_ctpat where user_id = 'UUID-AQUI'::uuid;
-- delete from public.user_drive_config where user_id = 'UUID-AQUI'::uuid;
-- delete from public.user_access where user_id = 'UUID-AQUI'::uuid;
-- delete from public.app_admins where user_id = 'UUID-AQUI'::uuid;
