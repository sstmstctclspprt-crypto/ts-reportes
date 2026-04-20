  -- Tabla principal que replica el RegistroModel de Flutter
  create table if not exists public.registros_ctpat (
    id uuid primary key default gen_random_uuid(),
    service_id text,
    folio_pdf text,
    operador text,
    checklist_tracto jsonb not null default '{}'::jsonb,
    checklist_caja jsonb not null default '{}'::jsonb,
    inspeccion_agricola jsonb not null default '{}'::jsonb,
    inspeccion_mecanica jsonb not null default '{}'::jsonb,
    image_urls text[] not null default '{}'::text[],
    firma_operador text,
    firma_oficial text,
    comentarios text,
    comentarios_tipo text,
    evidencias_exif jsonb not null default '{}'::jsonb,
    sync_status text not null default 'pending',
    pdf_storage_path text,
    drive_file_id text,
    sharepoint_folder_seq bigint,
    user_id uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  alter table public.registros_ctpat
    add column if not exists sharepoint_folder_seq bigint;

  -- Preferencia de logo por usuario (carpetas Google Drive deprecadas; SharePoint vía Graph)
  create table if not exists public.user_drive_config (
    user_id uuid primary key references auth.users (id) on delete cascade,
    pdf_folder_id text,
    images_folder_id text,
    created_at timestamptz not null default now()
  );

  alter table public.user_drive_config enable row level security;

-- Logo por usuario/servicio (archivo dentro del bucket LOGO_BUCKET o assets).
-- Ejemplos: caterpillar.png, komatsu.png, john_deere.png
alter table public.user_drive_config
  add column if not exists service_logo_file text not null default 'caterpillar.png';

alter table public.user_drive_config
  add column if not exists sharepoint_report_seq bigint not null default 0;

  drop policy if exists "Usuarios ven su propia config Drive" on public.user_drive_config;
  create policy "Usuarios ven su propia config Drive"
    on public.user_drive_config
    for select
    using (auth.uid() = user_id);

  drop policy if exists "Usuarios insertan su propia config Drive" on public.user_drive_config;
  create policy "Usuarios insertan su propia config Drive"
    on public.user_drive_config
    for insert
    with check (auth.uid() = user_id);

  drop policy if exists "Usuarios actualizan su propia config Drive" on public.user_drive_config;
  create policy "Usuarios actualizan su propia config Drive"
    on public.user_drive_config
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

  -- Contador de folio automático POR USUARIO (TS-1, TS-2, ...)
  create table if not exists public.registros_ctpat_folio_counter (
    user_id uuid primary key references auth.users(id) on delete cascade,
    counter bigint not null default 0
  );

  alter table public.registros_ctpat_folio_counter enable row level security;

  drop policy if exists "Usuarios ven su contador de folio" on public.registros_ctpat_folio_counter;
  create policy "Usuarios ven su contador de folio"
    on public.registros_ctpat_folio_counter
    for select
    using (auth.uid() = user_id);

  drop policy if exists "Usuarios insertan su contador de folio" on public.registros_ctpat_folio_counter;
  create policy "Usuarios insertan su contador de folio"
    on public.registros_ctpat_folio_counter
    for insert
    with check (auth.uid() = user_id);

  drop policy if exists "Usuarios actualizan su contador de folio" on public.registros_ctpat_folio_counter;
  create policy "Usuarios actualizan su contador de folio"
    on public.registros_ctpat_folio_counter
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

  create or replace function public.next_folio_ctpat(p_user_id uuid default null)
  returns text as $$
  declare
    new_val bigint;
    uid uuid;
  begin
    uid := coalesce(p_user_id, auth.uid());
    if uid is null then
      raise exception 'user_id requerido para generar folio';
    end if;

    insert into public.registros_ctpat_folio_counter (user_id, counter)
    values (uid, 1)
    on conflict (user_id) do update
      set counter = public.registros_ctpat_folio_counter.counter + 1
    returning counter into new_val;

    return format('TS-%s', new_val::text);
  end;
  $$ language plpgsql;

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

  alter table public.registros_ctpat enable row level security;

  drop policy if exists "Usuarios ven sólo sus registros" on public.registros_ctpat;
  create policy "Usuarios ven sólo sus registros"
    on public.registros_ctpat
    for select
    using (auth.uid() = user_id);

  drop policy if exists "Usuarios insertan sus registros" on public.registros_ctpat;
  create policy "Usuarios insertan sus registros"
    on public.registros_ctpat
    for insert
    with check (auth.uid() = user_id);

  drop policy if exists "Usuarios actualizan sus registros" on public.registros_ctpat;
  create policy "Usuarios actualizan sus registros"
    on public.registros_ctpat
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

  drop policy if exists "Usuarios borran sus registros" on public.registros_ctpat;
  create policy "Usuarios borran sus registros"
    on public.registros_ctpat
    for delete
    using (auth.uid() = user_id);

  create or replace function public.set_registros_ctpat_updated_at()
  returns trigger as $$
  begin
    new.updated_at = now();
    return new;
  end;
  $$ language plpgsql;

  drop trigger if exists set_registros_ctpat_updated_at on public.registros_ctpat;

  create trigger set_registros_ctpat_updated_at
  before update on public.registros_ctpat
  for each row
  execute function public.set_registros_ctpat_updated_at();

  -- =========================
  -- Limpieza automática BD
  -- =========================
  -- Importante: NO borrar "pending" antes de que la Edge Function
  -- termine de subir el PDF a Drive. Solo se eliminan registros ya sincronizados.
  create index if not exists registros_ctpat_created_at_idx
    on public.registros_ctpat (created_at);

  create or replace function public.cleanup_registros_ctpat(p_days integer default 30)
  returns void
  language plpgsql
  as $$
  begin
    delete from public.registros_ctpat
    where created_at < now() - make_interval(days => p_days)
      and sync_status = 'error';
  end;
  $$;

  -- =========================
  -- Security hardening
  -- =========================
  create or replace function public.current_org_id()
  returns text
  language sql
  stable
  as $$
    select coalesce(nullif(auth.jwt() ->> 'org_id', ''), auth.uid()::text)
  $$;

  alter table public.registros_ctpat
    add column if not exists organization_id text;

  update public.registros_ctpat r
  set organization_id = coalesce(
    nullif((u.raw_app_meta_data ->> 'org_id'), ''),
    r.user_id::text
  )
  from auth.users u
  where r.organization_id is null
    and r.user_id = u.id;

  update public.registros_ctpat
  set organization_id = coalesce(organization_id, user_id::text)
  where organization_id is null;

  create index if not exists registros_ctpat_org_idx
    on public.registros_ctpat (organization_id);

  create or replace function public.registros_ctpat_set_tenant_defaults()
  returns trigger
  language plpgsql
  as $$
  begin
    if new.user_id is null then
      new.user_id := auth.uid();
    end if;
    if new.organization_id is null or btrim(new.organization_id) = '' then
      new.organization_id := public.current_org_id();
    end if;
    return new;
  end;
  $$;

  drop trigger if exists set_registros_ctpat_tenant_defaults on public.registros_ctpat;
  create trigger set_registros_ctpat_tenant_defaults
  before insert on public.registros_ctpat
  for each row
  execute function public.registros_ctpat_set_tenant_defaults();

  drop policy if exists "Usuarios ven sólo sus registros" on public.registros_ctpat;
  drop policy if exists "Usuarios insertan sus registros" on public.registros_ctpat;
  drop policy if exists "Usuarios actualizan sus registros" on public.registros_ctpat;
  drop policy if exists "Usuarios borran sus registros" on public.registros_ctpat;
  drop policy if exists "Usuarios ven registros de su organizacion" on public.registros_ctpat;
  drop policy if exists "Usuarios insertan registros de su organizacion" on public.registros_ctpat;
  drop policy if exists "Usuarios actualizan registros propios de su organizacion" on public.registros_ctpat;
  drop policy if exists "Usuarios eliminan registros propios de su organizacion" on public.registros_ctpat;

  create policy "Usuarios ven registros de su organizacion"
    on public.registros_ctpat
    for select
    using (organization_id = public.current_org_id());

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

  create table if not exists public.registros_ctpat_audit (
    id bigint generated always as identity primary key,
    registro_id uuid,
    organization_id text,
    actor_user_id uuid,
    action text not null,
    reason text,
    old_data jsonb,
    new_data jsonb,
    created_at timestamptz not null default now()
  );

  create index if not exists registros_ctpat_audit_registro_id_idx
    on public.registros_ctpat_audit (registro_id);
  create index if not exists registros_ctpat_audit_org_idx
    on public.registros_ctpat_audit (organization_id);

  alter table public.registros_ctpat_audit enable row level security;
  drop policy if exists "Usuarios ven auditoria de su organizacion" on public.registros_ctpat_audit;
  create policy "Usuarios ven auditoria de su organizacion"
    on public.registros_ctpat_audit
    for select
    using (organization_id = public.current_org_id());

  create or replace function public.registros_ctpat_audit_mutation()
  returns trigger
  language plpgsql
  as $$
  begin
    if tg_op = 'UPDATE' then
      insert into public.registros_ctpat_audit (
        registro_id, organization_id, actor_user_id, action, old_data, new_data
      )
      values (old.id, old.organization_id, auth.uid(), 'UPDATE', to_jsonb(old), to_jsonb(new));
      return new;
    end if;

    if tg_op = 'DELETE' then
      insert into public.registros_ctpat_audit (
        registro_id, organization_id, actor_user_id, action, old_data, new_data
      )
      values (old.id, old.organization_id, auth.uid(), 'DELETE', to_jsonb(old), null);
      return old;
    end if;
    return null;
  end;
  $$;

  create or replace function public.registros_ctpat_block_synced_mutations()
  returns trigger
  language plpgsql
  as $$
  begin
    if old.sync_status = 'synced' then
      insert into public.registros_ctpat_audit (
        registro_id, organization_id, actor_user_id, action, reason, old_data, new_data
      )
      values (
        old.id,
        old.organization_id,
        auth.uid(),
        'BLOCKED_' || tg_op,
        'Registro inmutable: sync_status=synced',
        to_jsonb(old),
        case when tg_op = 'UPDATE' then to_jsonb(new) else null end
      );
      raise exception 'Registro inmutable: no se permite % cuando sync_status = synced', tg_op;
    end if;
    if tg_op = 'UPDATE' then return new; end if;
    return old;
  end;
  $$;

  drop trigger if exists trg_registros_ctpat_immutable on public.registros_ctpat;
  create trigger trg_registros_ctpat_immutable
  before update or delete on public.registros_ctpat
  for each row
  execute function public.registros_ctpat_block_synced_mutations();

  drop trigger if exists trg_registros_ctpat_audit on public.registros_ctpat;
  create trigger trg_registros_ctpat_audit
  after update or delete on public.registros_ctpat
  for each row
  execute function public.registros_ctpat_audit_mutation();