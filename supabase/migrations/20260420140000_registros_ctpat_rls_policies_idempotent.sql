-- Idempotente: evita ERROR 42710 al re-ejecutar scripts que crean las mismas políticas RLS.
-- Útil si ya existían "Usuarios ven registros de su organizacion" etc. y se vuelve a correr el bloque CREATE.

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
