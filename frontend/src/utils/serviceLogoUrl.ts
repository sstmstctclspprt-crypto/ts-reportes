import { supabase } from '../supabaseClient';

/** Mismo bucket que la Edge Function del PDF (`LOGO_BUCKET`, por defecto `ctpat-logs`). */
const BUCKET = (import.meta.env.VITE_LOGO_BUCKET as string | undefined)?.trim();

/**
 * URL para mostrar el logo de servicio en la PWA.
 * Si `VITE_LOGO_BUCKET` está definido, usa Storage público de Supabase; si no, `/nombre.png` (carpeta `public/`).
 */
export function getServiceLogoPublicUrl(filename: string | null | undefined): string {
  const name = filename?.trim() ?? '';
  if (!name) return '';
  if (!/^[a-zA-Z0-9/_\.-]+\.(png|jpe?g)$/i.test(name)) return '';
  if (BUCKET) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(name);
    return data.publicUrl;
  }
  return `/${name}`;
}
