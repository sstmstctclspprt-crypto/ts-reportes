/**
 * Comprueba que las URLs de Supabase apunten al mismo proyecto.
 * Si `VITE_SUPABASE_FUNCTIONS_URL` es de otro ref que `VITE_SUPABASE_URL`, la puerta de enlace
 * devuelve 401 Invalid JWT aunque el usuario esté bien logueado.
 */
export function getSupabaseProjectRef(url: string): string | null {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    if (host.endsWith('.supabase.co')) {
      const withoutDomain = host.slice(0, -'.supabase.co'.length);
      if (withoutDomain.endsWith('.functions')) {
        return withoutDomain.slice(0, -'.functions'.length);
      }
      return withoutDomain;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function warnIfSupabaseFunctionsEnvMismatch(): void {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const fn = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string | undefined)?.trim();
  if (fn) {
    // eslint-disable-next-line no-console
    console.warn(
      '[Supabase] VITE_SUPABASE_FUNCTIONS_URL está definida pero ya no se usa en la app. ' +
        'Las Edge Functions se llaman con la misma base que VITE_SUPABASE_URL (`.../functions/v1`). ' +
        'Bórrala en Vercel/.env; si apunta a `*.functions.supabase.co` puede causar 401 en la función.'
    );
  }
  if (!base || !fn) return;

  const refBase = getSupabaseProjectRef(base);
  const refFn = getSupabaseProjectRef(fn);
  if (!refBase || !refFn || refBase === refFn) return;

  // eslint-disable-next-line no-console
  console.warn(
    '[Supabase] VITE_SUPABASE_FUNCTIONS_URL parece ser de otro proyecto que VITE_SUPABASE_URL. ' +
      `Refs: functions="${refFn}" vs api="${refBase}". ` +
      'Elimina VITE_SUPABASE_FUNCTIONS_URL y usa solo VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.'
  );
}
