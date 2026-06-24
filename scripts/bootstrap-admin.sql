-- Ejecutar en Supabase SQL Editor ANTES del primer uso en producción.
-- 1) Registra el email del administrador (quedará aprobado y con panel Admin al primer login con Google).
insert into public.app_admin_emails (email)
values ('sistemas.tactical@gmail.com')
on conflict (email) do nothing;

-- 2) Opcional: si el admin ya inició sesión una vez, promover por user_id:
-- insert into public.app_admins (user_id)
-- select id from auth.users where lower(email) = lower('tu-correo@empresa.com')
-- on conflict (user_id) do nothing;
--
-- update public.user_access
-- set status = 'approved', approved_at = now()
-- where user_id in (select id from auth.users where lower(email) = lower('tu-correo@empresa.com'));
