# Tactical Support CT-PAT PWA (Vue 3 + Supabase)

Aplicación Web Progresiva (PWA) para la gestión de registros de seguridad logística CT-PAT, migrada desde una app Flutter. Stack principal:

- Vue 3 (Composition API) + Vite
- Tailwind CSS para la UI
- Pinia para estado global (`authStore`, `syncStore`)
- Supabase (PostgreSQL + Auth + Edge Functions)

## Seguridad operativa (hardening)

- **Cifrado en tránsito:** producción en Vercel con HTTPS/TLS administrado por Vercel + headers de seguridad (`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) en `vercel.json`.
- **Secretos:** nunca se guardan secretos de proveedor en frontend; todos viven en variables de entorno seguras de Supabase/Vercel.
- **Zero Trust en Edge:** `generate-ctpat-pdf` exige `Authorization: Bearer <JWT>` y valida identidad/propiedad del registro en backend.
- **PII sensible:** evidencias y firmas se almacenan en bucket privado (`ctpat-evidence`) con políticas por organización/usuario; en DB solo se guardan rutas.
- **Aislamiento multi-tenant:** RLS por `organization_id` y `user_id`.
- **Inmutabilidad:** registros `sync_status='synced'` no aceptan `UPDATE/DELETE`.
- **Auditoría:** cambios y bloqueos de mutación se registran en tabla de auditoría.

## 1. Modelo de datos y Supabase

### Esquema SQL

En `supabase/schema.sql` se define la tabla principal `registros_ctpat`, que replica el `RegistroModel`:

- **Identificación**: `id (uuid PK)`, `service_id`, `folio_pdf`
- **Datos generales**: `operador` (forzado a mayúsculas en el frontend)
- **Checklists**:
  - `checklist_tracto` (`jsonb`)
  - `checklist_caja` (`jsonb`)
- **Inspecciones**:
  - `inspeccion_agricola` (`jsonb`)
  - `inspeccion_mecanica` (`jsonb`)
- **Imágenes**: `image_urls (text[])` para guardar rutas/URLs de Supabase Storage
- **Firmas**: `firma_operador`, `firma_oficial` (Data URLs o rutas de Storage)
- **Sincronización**: `sync_status` (`pending` / `synced`)
- **Auditoría**: `user_id`, `created_at`, `updated_at`

### Row Level Security (RLS)

`schema.sql` habilita RLS y crea políticas para que:

- Un usuario **solo pueda ver** (`select`) sus propios registros: `auth.uid() = user_id`.
- Solo pueda **insertar/actualizar/borrar** registros donde `user_id = auth.uid()`.

Ejecuta el SQL en tu proyecto Supabase (SQL Editor) y verifica que la tabla existe y que las políticas están activas.

## 2. Autenticación (Supabase + Google)

El archivo `src/stores/authStore.ts` implementa un `authStore` con Pinia, análogo al `AuthService` original:

- Usa `supabase.auth.signInWithOAuth` con proveedor **Google** (solo identidad).
- Solicita scopes: `openid profile email` (sin permisos de Drive; la subida a archivos es en **SharePoint** vía la Edge Function).
- Persiste la sesión con `supabase.auth.getSession()`.
- Expone estado:
  - `isSignedIn`
  - `email`
  - `displayName`
  - `loading`

El `App.vue` inicializa la sesión en `onMounted` y muestra la identidad del usuario y los botones de iniciar/cerrar sesión.

Configura las variables de entorno en `.env`:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## 3. Formulario de Registro (Frontend Vue)

El componente principal del registro es `src/components/RegistroForm.vue`:

- Usa un modelo reactivo `RegistroFormModel` con:
  - Identificación (`serviceId`, `folioPdf`)
  - Datos generales (`operador`)
  - Checklists (`checklistTracto`, `checklistCaja`) como `Record<string, boolean>`
  - Inspecciones (`inspeccionAgricola`, `inspeccionMecanica`)
  - URLs de imágenes `imageUrls[]`
  - Firmas (`firmaOperadorDataUrl`, `firmaOficialDataUrl`)
  - `syncStatus: 'pending'`
- Secciones:
  - **Datos Generales**
  - **Checklist CT-PAT** (Tracto y Caja)
  - **Inspección Agrícola y Mecánica**
  - **Fotos (2x3)** – por ahora captura solo URLs
  - **Firmas** – usa `vue-signature-pad`

### Firmas con `vue-signature-pad`

- Dos pads:
  - `Firma Operador`
  - `Firma Oficial`
- Métodos:
  - `clearFirmaOperador()`, `clearFirmaOficial()`
  - En el guardado se llama a `saveSignature()` para obtener `dataURL` y se persiste en Supabase en los campos `firma_operador` y `firma_oficial`.

### Lógica `criticalChecklistFailing`

- Los ítems críticos del checklist están marcados con `critical: true`.
- Si **algún crítico está en falso**, antes de guardar:
  - Se muestra un **modal de advertencia**.
  - El usuario debe confirmar si desea continuar.
  - Al confirmar se procede con el guardado.

### Guardado y estado `syncStatus`

La función `persistRegistro()`:

- Normaliza a mayúsculas (`toUpperCase()`) los campos generales.
- Inserta el registro en Supabase (`registros_ctpat`) con `sync_status = 'pending'`.
- Marca localmente los datos como `syncStatus: 'pending'`.
- Encola el registro en el `syncStore` para sincronizar PDF/SharePoint vía Edge Function.

## 4. Sincronización y Cola Offline (SharePoint sync)

`src/stores/syncStore.ts` implementa un store para la **cola de sincronización offline**:

- Cola persistida en `localStorage`:
  - Clave: `ts_ctpat_sync_queue_v1`
  - Ítems con: `id`, `payload`, `status`, `lastError`, `updatedAt`
- Historial de ejecuciones similar a `DriveSyncHistoryScreen`:
  - Clave: `ts_ctpat_sync_history_v1`
  - Consumido visualmente en `HomeView.vue`

### Flujo

- Al crear un registro se llama a `enqueueRegistro({ id, createdAt })`.
- Si `navigator.onLine === false`:
  - El registro queda **pendiente** en la cola.
- Se adjunta un listener a `window.online` para disparar `processQueue()`.
- `processQueue()`:
  - Para cada item `pending`:
    - Llama a la **Supabase Edge Function**:

      ```bash
      POST /functions/v1/generate-ctpat-pdf
      body: { "registroId": "<uuid>" }
      ```

    - Actualiza `status` a `done` o `error`.
    - Agrega el resultado al `history`.

**Importante:** La generación de PDF y la subida a SharePoint no se hace en el navegador, sino en la Edge Function (Microsoft Graph con **client credentials**).

## 5. Edge Function: Generación de PDF y SharePoint (Microsoft Graph)

Código en `supabase/functions/generate-ctpat-pdf/` (`index.ts` + `graphSharePoint.ts`):

1. **Recupera el registro** desde Supabase (Service Role): tabla `registros_ctpat`.
2. **Genera un PDF** de varias páginas con `pdf-lib` (estructura CT-PAT).
3. **Sube el PDF y las evidencias** a la biblioteca predeterminada del sitio SharePoint indicado:
   - Token OAuth de **aplicación**: `POST` a `login.microsoftonline.com/{tenant}/oauth2/v2.0/token` con `AZURE_*`.
   - **Una carpeta por registro**, secuencial por usuario: `TS REPORTES/users/<user_id>/TS-REPORTES S1/`, `TS-REPORTES S2/`, etc. (nombre raíz configurable con `GRAPH_ROOT_FOLDER_NAME`). Dentro va solo el PDF de ese registro. Las fotos/firmas van **embebidas en el PDF**.
4. **Copia de respaldo** del PDF en Storage (`ctpat-pdfs`) cuando aplica.
5. **Marca el registro como `synced`** y guarda el id del ítem de Graph en `drive_file_id`.

### Entra ID / permisos (TI)

- Registro de aplicación en el inquilino M365 con permisos de aplicación a Microsoft Graph (p. ej. `Sites.Selected` y concesión en el sitio, u otro permiso acordado con seguridad).
- Sin secretos de Microsoft en el frontend.

### Variables de entorno para la Edge Function (Supabase)

Obligatorias para Graph + Supabase:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- Sitio SharePoint: `GRAPH_SHAREPOINT_SITE_ID` **o** `GRAPH_SITE_HOSTNAME` + `GRAPH_SITE_PATH` (ej. `contoso.sharepoint.com` y `/sites/CTPAT`)
- Opcional: `GRAPH_ROOT_FOLDER_NAME` (default `TS REPORTES`), `EVIDENCE_BUCKET`, buckets de logos/PDFs según ya tengas.

Despliegue:

```bash
supabase functions deploy generate-ctpat-pdf --no-verify-jwt
```

Desarrollo local: `supabase functions serve --env-file ./supabase/.env` (o secretos en CLI).

## 6. UI y Estilo (Tailwind CSS)

La estética imita **Tactical Support**:

- Títulos azules (`text-tactical-blue`), definidos en `tailwind.config.cjs`.
- Encabezado con logo `logo.png` y título en `App.vue`.
- Botones principales:
  - Fondo azul.
  - Spinners tipo `CircularProgressIndicator` usando `border` + `animate-spin`.
- Home (`HomeView.vue`) incluye:
  - Filtro por **Entrada / Salida / Todos** (puedes enlazarlo al modelo real de movimiento).
  - Tarjeta con **historial de sincronización** de la cola (similar a `DriveSyncHistoryScreen`).

## 7. Puesta en marcha del proyecto

1. Instala dependencias:

```bash
npm install
```

2. Configura variables de entorno en `.env` (para Vite) y en Supabase (para la Edge Function).

3. Aplica el esquema SQL en el proyecto Supabase:

```sql
-- Copia y ejecuta el contenido de supabase/schema.sql
```

4. Ejecuta en local:

```bash
npm run dev
```

5. Despliega la Edge Function `generate-ctpat-pdf` y configura la URL base de Supabase para que
   el path `/functions/v1/generate-ctpat-pdf` esté disponible para la PWA.

### Despliegue en Vercel (solo frontend)

1. Conecta el repo en Vercel y usa **Framework Preset: Vite** (build: `npm run build`, output: `dist`).
2. **Variables de entorno** del proyecto (Production / Preview):
   - `VITE_SUPABASE_URL` — URL del proyecto Supabase.
   - `VITE_SUPABASE_ANON_KEY` — clave anónima (pública) de Supabase.
   - `VITE_SITE_URL` — URL pública de la app en Vercel (ej. `https://tu-app.vercel.app`), **sin** barra final; sirve para OAuth y enlaces.
   - Opcional: `VITE_LOGO_BUCKET`, `VITE_EVIDENCE_BUCKET` si los usas en el cliente.
3. En **Supabase → Authentication → URL Configuration**, añade la URL de Vercel en **Redirect URLs** y **Site URL** si aplica.
4. El archivo [`vercel.json`](vercel.json) ya define headers de seguridad y rewrite SPA; no hace falta configuración extra para rutas.

## 8. Puntos a extender / personalizar

- Integración real de captura y subida de imágenes a Supabase Storage (en lugar de solo URLs).
- Render de firmas en el PDF embebiendo las imágenes base64.
- Replicar al detalle el layout original del `PdfService` de Flutter (tipografías, tablas, logotipos).
- Implementar modo PWA (manifest y service worker) para soporte offline avanzado.
