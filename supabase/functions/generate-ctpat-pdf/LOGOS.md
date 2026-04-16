# Logos en el PDF

Los logos del encabezado y el fondo se cargan por **URL** para que funcionen en Supabase sin depender del sistema de archivos del deploy.

## Opción recomendada: Supabase Storage

1. En el panel de Supabase: **Storage** → **New bucket**.
2. Crea un bucket público, por ejemplo: `ctpat-logs`.
3. Sube estos archivos a la raíz del bucket:
   - `ctpat.png` (izquierda)
   - `caterpillar.png` (centro, por defecto)
   - `oea.jpeg` (derecha)
   - `logo.png` (marca de agua / sello corporativo centrado en **cada página** del PDF; debe ser el logo que quieras como fondo)
   - `caja.jpg` (diagrama de puntos de verificación en página 2)
   - Opcionales: `komatsu.png`, `john_deere.png` si usas otros servicios.
4. Asegúrate de que el bucket sea **público** (Policy: permitir lectura pública).
5. En la Edge Function, añade la variable de entorno (opcional si el bucket se llama `ctpat-logs`):
   - `LOGO_BUCKET` = `ctpat-logs`

La URL que usará la función será:
`https://<tu-proyecto>.supabase.co/storage/v1/object/public/ctpat-logs/ctpat.png`

## Opción alternativa: URL base propia

Si usas otro almacenamiento (CDN, S3, etc.):

1. Sube ahí los mismos archivos.
2. En la Edge Function define la variable de entorno:
   - `LOGO_BASE_URL` = `https://tu-dominio.com/ruta/logos`
3. La función cargará: `LOGO_BASE_URL/ctpat.png`, etc.

## Orden de carga

1. Si existe `LOGO_BASE_URL` → se usa esa URL base.
2. Si no, si existe `SUPABASE_URL` → se usa Storage: `.../storage/v1/object/public/<LOGO_BUCKET>/<archivo>`.
3. Si no, se intenta leer desde `./assets/` (solo funciona en entornos donde los archivos están en disco).

---

## Logos nuevos + asignación por cuenta (`user_drive_config`)

La tabla en la base de datos es **`public.user_drive_config`**. La columna que guarda el **nombre del archivo** del logo (debe coincidir con el objeto en Storage) es **`service_logo_file`** (por ejemplo `danfoss.png`).

### 1. Bucket y políticas

Puedes aplicar la migración `supabase/migrations/20260327120000_ctpat_logos_bucket.sql` con la CLI (`supabase db push`) o crear el bucket **`ctpat-logs`** público desde el panel y una política de **lectura pública** en `storage.objects` para ese bucket.

### 2. Subir el archivo

En **Storage** → bucket `ctpat-logs` → sube el archivo en la **raíz** del bucket con el nombre definitivo, por ejemplo `mi_cliente.png`.

### 3. Guardar el nombre en la BD

En **Table Editor** → `user_drive_config` → edita la fila del usuario (por `user_id`) y pon **`service_logo_file`** = `mi_cliente.png` (exactamente el mismo nombre que en Storage).

O con SQL (sustituye UUID y nombre de archivo):

```sql
update public.user_drive_config
set service_logo_file = 'mi_cliente.png'
where user_id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
```

**Nota RLS:** los usuarios solo pueden leer/actualizar **su propia** fila. Para asignar logos a otras cuentas usa el **panel de Supabase** (Table Editor / SQL como administrador) o la **service role** en un backend.

### 4. App web (PWA)

En el `.env` del front define el mismo bucket para construir la URL pública del logo en pantalla:

```env
VITE_LOGO_BUCKET=ctpat-logs
```

Si no defines `VITE_LOGO_BUCKET`, la app intentará cargar el logo desde la carpeta **`public/`** del build (`/mi_cliente.png`).
