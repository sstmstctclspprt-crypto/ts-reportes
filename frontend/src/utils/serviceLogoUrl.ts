import { supabase } from '../supabaseClient';

/** Mismo bucket que la Edge Function del PDF (`LOGO_BUCKET`, por defecto `ctpat-logs`). */
const BUCKET = (import.meta.env.VITE_LOGO_BUCKET as string | undefined)?.trim();

/**
 * URL para mostrar el logo de servicio en la PWA.
 * Solo las rutas `logos/...` son subidas al bucket; el resto (`logo.png`, `danfoss.png`, etc.)
 * viven en `public/` de la app. Si usáramos Storage para `logo.png` sin subirlo, el navegador
 * pediría un objeto inexistente y verías 400/404 en consola.
 */
export function getServiceLogoPublicUrl(filename: string | null | undefined): string {
  const name = filename?.trim() ?? '';
  if (!name) return '';
  if (!/^[a-zA-Z0-9/_\.-]+\.(png|jpe?g)$/i.test(name)) return '';
  const useBucket = Boolean(BUCKET && name.toLowerCase().startsWith('logos/'));
  if (useBucket) {
    const { data } = supabase.storage.from(BUCKET as string).getPublicUrl(name);
    return data.publicUrl;
  }
  return name.startsWith('/') ? name : `/${name}`;
}
