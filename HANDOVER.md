# APPWEB CT-PAT - Documentacion de relevo tecnico

## 1) Que es esta app

`APPWEB` es una aplicacion web progresiva (PWA) para capturar y gestionar registros CT-PAT de seguridad logistica.

El flujo principal es:

1. Un usuario autenticado crea un registro desde el formulario.
2. El registro se guarda en Supabase con estado `pending`.
3. Una cola de sincronizacion procesa el registro cuando hay conectividad.
4. Una Edge Function genera un PDF y lo sube a **SharePoint** (Microsoft Graph, app-only), una carpeta por registro.
5. El registro se marca como `synced` (id del item en `drive_file_id`).

Objetivo operativo: tener evidencia digital estandarizada (checklists, inspecciones, firmas y PDF) con sincronizacion confiable; el almacenamiento en nube corporativa lo controla TI (Entra ID + sitio SharePoint).

## 2) Stack tecnico

- Frontend: Vue 3 + Vite + TypeScript.
- Estado y navegacion: Pinia + Vue Router.
- UI: Tailwind CSS.
- Backend/BaaS: Supabase (Auth + Postgres + Storage + Edge Functions).
- Integraciones: Google OAuth solo para **inicio de sesion** en Supabase; **Microsoft Graph (client credentials)** en la Edge Function para escribir en SharePoint.
- Librerias relevantes: `@supabase/supabase-js`, `vue-signature-pad`, `zod`.

## 3) Estructura del proyecto

- `src/`
  - `components/`: componentes UI (incluye el formulario principal).
  - `views/`: pantallas principales.
  - `stores/`: estado global (`authStore`, `syncStore`, etc.).
  - `services/`: integraciones y utilidades de acceso a datos.
  - `router/`: rutas de la app.
- `public/`
  - `manifest.webmanifest` y `sw.js` para PWA.
- `supabase/`
  - `schema.sql`: estructura base de DB.
  - `migrations/`: cambios incrementales de base de datos.
  - `functions/generate-ctpat-pdf/`: Edge Function (PDF + `graphSharePoint.ts`).
- `vercel.json`: headers de seguridad y rewrite SPA para despliegue.

## 4) Requisitos previos

- Node.js 20+ recomendado.
- npm.
- Proyecto Supabase configurado.
- Inquilino Microsoft 365: app registrada en Entra ID, permisos Graph y acceso al sitio SharePoint destino (TI).

## 5) Configuracion de entorno

### Variables del frontend (Vite)

Crear `.env` local con, al menos:

```bash
VITE_SUPABASE_URL=<tu_url_supabase>
VITE_SUPABASE_ANON_KEY=<tu_anon_key_supabase>
VITE_SITE_URL=http://localhost:5173
VITE_LOGO_BUCKET=<bucket_logo_opcional>
VITE_EVIDENCE_BUCKET=<bucket_evidencias_recomendado>
```

Notas:

- El codigo usa variables `VITE_*` en frontend.
- No hacen falta secretos de Azure en el cliente; la subida a SharePoint es solo servidor.

### Variables de la Edge Function (Supabase)

Secretos para `generate-ctpat-pdf`:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- Sitio: `GRAPH_SHAREPOINT_SITE_ID` **o** `GRAPH_SITE_HOSTNAME` + `GRAPH_SITE_PATH`
- Opcional: `GRAPH_ROOT_FOLDER_NAME` (default `TS REPORTES`), `EVIDENCE_BUCKET`, buckets de logos/PDFs.

### Azure / Entra ID (manual, TI)

1. Crear **App registration** en el inquilino.
2. Permisos de aplicacion Microsoft Graph: p. ej. `Sites.Selected` + concesion en el sitio (recomendado) u otra politica acordada.
3. Client secret (o certificado) solo en secretos de Supabase.
4. Probar con Graph Explorer o la propia Edge Function tras desplegar.

## 6) Como correr en local

1. Instalar dependencias:

```bash
npm install
```

2. Iniciar app:

```bash
npm run dev
```

3. Build de produccion:

```bash
npm run build
```

4. Preview local del build:

```bash
npm run preview
```

## 7) Base de datos y seguridad

- La tabla principal es `registros_ctpat`.
- `user_drive_config`: logo y contador `sharepoint_report_seq` (secuencia por usuario para carpetas `TS-REPORTES Sn`); `pdf_folder_id` / `images_folder_id` legado Google. Cada registro tiene `sharepoint_folder_seq` con el `n` de su carpeta.
- RLS esta habilitado para aislar datos por usuario/organizacion.
- Registros `synced` tienen restricciones de mutabilidad (segun migraciones de hardening).

Pasos sugeridos para bootstrap:

1. Ejecutar `supabase/schema.sql`.
2. Aplicar migraciones en `supabase/migrations/` (incluye columnas nullable en `user_drive_config`).
3. Verificar politicas RLS y permisos de buckets.

## 8) Sincronizacion y generacion de PDF

- `syncStore` mantiene cola en `localStorage` para modo offline/online.
- Al reconectar, `processQueue()` invoca la funcion `generate-ctpat-pdf` con **solo** JWT Supabase (body `{ registroId }`).
- La funcion:
  - obtiene datos del registro,
  - genera PDF,
  - sube a SharePoint vía Graph (app-only),
  - opcionalmente respaldo en Storage,
  - actualiza estado a `synced`.

Si algo falla, revisar:

- estado de cola en frontend,
- logs de Edge Function,
- secretos `AZURE_*`, sitio `GRAPH_*`, permisos Graph y grant en el sitio (`Sites.Selected`).

## 9) Despliegue

### Frontend

- Preparado para Vercel (`vercel.json`):
  - headers de seguridad,
  - rewrite SPA.

### Backend

- Deploy de Edge Function con Supabase CLI:

```bash
supabase functions deploy generate-ctpat-pdf
```

## 10) Operacion diaria (runbook corto)

- **Alta de usuario:** via Auth de Supabase con Google (u otro proveedor si lo configuras).
- **Incidencia de sync:** revisar conectividad, cola local y logs de la funcion.
- **PDF no aparece en SharePoint:** validar variables `AZURE_*`, `GRAPH_*`, permisos de la app en el sitio y rutas `TS REPORTES/users/<uuid>/TS-REPORTES S<n>/`.
- **Errores de acceso a registros:** revisar RLS y JWT del usuario.

## 11) Deuda tecnica / mejoras prioritarias

1. Configurar ESLint v9 (`eslint.config.js`), porque `npm run lint` depende de ello.
2. Homologar variables de entorno para evitar confusiones (`VITE_EVIDENCE_BUCKET` vs `EVIDENCE_BUCKET`).
3. Completar tipado de `ImportMetaEnv` con todas las variables realmente usadas.
4. Seguir extrayendo modulos desde `generate-ctpat-pdf/index.ts` (render PDF, Storage, Graph).
5. Agregar pruebas (al menos smoke tests de stores y Edge Function).

## 12) Checklist de entrega a la siguiente persona

- [ ] Puede levantar la app con `npm run dev`.
- [ ] Tiene acceso al proyecto Supabase (Auth, DB, Storage, Functions).
- [ ] Tiene secretos Azure/Graph y Supabase configurados para `generate-ctpat-pdf`.
- [ ] Puede generar y sincronizar un registro de prueba end-to-end.
- [ ] Puede ubicar cada PDF en su carpeta `TS REPORTES/users/<uuid>/TS-REPORTES S<n>/`.
- [ ] Conoce ubicacion de logs y flujo de troubleshooting.
- [ ] Tiene documentadas credenciales y propietarios tecnicos (sin poner secretos en git).

## 13) Recomendaciones de continuidad

- Mantener un `.env.example` sin secretos para onboarding rapido.
- Rotar claves si alguna vez estuvieron expuestas en archivos locales compartidos.
- Definir versionado de schema/migrations como parte del proceso de release.
- Documentar en tickets cualquier cambio en formato PDF o politicas RLS.
