/**
 * Detecta errores de Supabase/PostgREST/GoTrue que requieren volver a iniciar sesión.
 *
 * Importante: NO usar "invalid token" suelto: algunas APIs externas devuelven frases parecidas
 * y eso NO debe cerrar la sesión de Supabase ni borrar el registro ya guardado.
 */
export function isSessionExpiredError(
  message: string | null | undefined,
  code?: string | null | undefined
): boolean {
  const c = (code ?? '').toString();
  if (c === '401' || c === 'PGRST301' || c === 'PGRST302') return true;

  const m = (message ?? '').toLowerCase();
  if (!m.trim()) return false;

  // Puerta de enlace Supabase / GoTrue (JWT de usuario Supabase)
  if (/\binvalid jwt\b/.test(m)) return true;
  if (/\bjwt expired\b/.test(m)) return true;
  if (m.includes('http 401:') && (m.includes('jwt') || m.includes('unauthorized'))) return true;

  // PostgREST en cuerpo de error
  if (m.includes('pgrst301') || m.includes('pgrst302')) return true;

  return false;
}

/**
 * Solo para reintento de Edge Function con otro JWT Supabase (no cerrar sesión).
 * Más estricto que errores de Graph mezclados en el mismo mensaje.
 */
export function isSupabaseGatewayUnauthorized(message: string | null | undefined): boolean {
  const m = (message ?? '').toLowerCase();
  return (
    /\binvalid jwt\b/.test(m) ||
    m.includes('missing authorization') ||
    (m.includes('http 401:') && (m.includes('jwt') || m.includes('authorization')))
  );
}

/** Texto para toasts (sin códigos HTTP). */
export const SESSION_EXPIRED = {
  title: 'Sesión finalizada',
  message: 'Por seguridad hay que volver a entrar. Usa el botón de inicio de sesión en la parte superior.'
} as const;

/** Mensaje breve para cola de sincronización / historial de errores. */
export const SESSION_EXPIRED_SHORT = 'Sesión finalizada. Vuelve a iniciar sesión.';

/** Errores de Google Drive / OAuth de Google. */
export function isGoogleDriveAccessError(message: string | null | undefined): boolean {
  const m = (message ?? '').toLowerCase();
  if (!m.trim()) return false;
  if (m.includes('google drive')) return true;
  if (m.includes('googleapis.com')) return true;
  if (m.includes('provider_token')) return true;
  if (m.includes('accesstoken') && m.includes('google')) return true;
  return false;
}

/**
 * 401 u otro fallo de credencial en llamadas a Google (Drive) que puede resolverse
 * re-leyendo el `provider_token` tras `refreshSession` (aunque a veces haga falta volver a entrar con Google).
 */
export function isGoogleDriveAccessTokenExpiredError(message: string | null | undefined): boolean {
  const m = (message ?? '').toLowerCase();
  if (!m.trim()) return false;
  if (m.includes('(status 401)')) {
    if (m.includes('google drive') || m.includes('en drive') || m.includes('googleapis')) {
      return true;
    }
  }
  if (m.includes('invalid') && m.includes('grant') && m.includes('token')) {
    return true;
  }
  return false;
}

