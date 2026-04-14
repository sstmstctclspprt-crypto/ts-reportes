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

- Usa `supabase.auth.signInWithOAuth` con proveedor **Google**.
- Solicita scopes: `openid profile email https://www.googleapis.com/auth/drive.file`.
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
- Encola el registro en el `syncStore` para sincronizar PDF/Drive vía Edge Function.

## 4. Sincronización y Cola Offline (Drive Sync)

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

**Importante:** La generación de PDF y la subida a Drive no se hace en el navegador, sino en la Edge Function.

## 5. Edge Function: Generación de PDF y Google Drive

La función está en `supabase/functions/generate-ctpat-pdf/index.ts`:

1. **Recupera el registro** desde Supabase (usando Service Role):
   - Tabla `registros_ctpat`.
2. **Genera un PDF de 4 páginas** con `pdf-lib`:
   - P1: Datos generales + Checklist (Tracto/Caja).
   - P2: Inspección Agrícola.
   - P3: Fotos (2x3) – por ahora lista de URLs como texto; se puede extender para embeber imágenes.
   - P4: Inspección Mecánica + placeholders para Firmas (rectángulos donde en el futuro se pueden dibujar las firmas capturadas).
3. **Sube el PDF a Google Drive**:
   - Usa una **Service Account** (cuenta maestra).
   - Construye un JWT, obtiene un access token (`https://oauth2.googleapis.com/token`).
   - Sube el archivo con `multipart/related` a `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`.
   - Opcionalmente lo guarda en una carpeta (`GOOGLE_DRIVE_FOLDER_ID`).
4. **Marca el registro como `synced`** en Supabase.

### Variables de entorno para la Edge Function

Configura en Supabase:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY` (PEM; en Supabase suele ponerse con `\n` escapados)
- `GOOGLE_DRIVE_FOLDER_ID` (opcional)

Despliegue:

```bash
supabase functions deploy generate-ctpat-pdf --no-verify-jwt
```

Y publica vía:

```bash
supabase functions serve --env-file ./supabase/.env
```

*(ajusta comandos según tu flujo de CI/CD)*.

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

## 8. Puntos a extender / personalizar

- Integración real de captura y subida de imágenes a Supabase Storage (en lugar de solo URLs).
- Render de firmas en el PDF embebiendo las imágenes base64.
- Replicar al detalle el layout original del `PdfService` de Flutter (tipografías, tablas, logotipos).
- Implementar modo PWA (manifest y service worker) para soporte offline avanzado.

#   T S - R E P O R T S 
 
 #   t s - r e p o r t e s 
 
 #   t s - r e p o r t e s 
 
 