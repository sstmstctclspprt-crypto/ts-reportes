import type { Session } from '@supabase/supabase-js';
import { defineStore } from 'pinia';
import { supabase } from '../supabaseClient';
import { SESSION_EXPIRED } from '../utils/supabaseAuthErrors';
import { useToastStore } from './toastStore';
const LOGO_BUCKET = ((import.meta.env.VITE_LOGO_BUCKET as string | undefined)?.trim() || 'ctpat-logs');

interface AuthState {
  isSignedIn: boolean;
  email: string | null;
  displayName: string | null;
  userId: string | null;
  loading: boolean;
  driveConfigReady: boolean;
  driveConfigRetryScheduled: boolean;
  /** Nombre de archivo del logo de servicio (p. ej. danfoss.png), desde user_drive_config */
  serviceLogoFile: string | null;
  /** Subcarpeta legible para copias OneDrive/Power Automate; si está vacío el servidor usa el id de usuario */
  onedriveSubfolderName: string | null;
}

const AUTH_CACHED_USER_ID_KEY = 'ts_ctpat_cached_user_id_v1';

/**
 * Varios listeners (visibility + focus + cola sync) pueden llamar a refresh a la vez.
 * Dos `refreshSession()` concurrentes invalidan el refresh token del otro → fallos y 401 Invalid JWT.
 */
let refreshSessionForApiMutex: Promise<Session | null> | null = null;

/** Evita varios inserts concurrentes en `user_drive_config` (misma clave → 23505 y error en consola). */
let ensureDriveConfigMutex: Promise<void> | null = null;

function isPostgresUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === '23505') return true;
  const m = (e?.message ?? '').toLowerCase();
  return m.includes('duplicate key') || m.includes('unique constraint');
}

/** `exp` del JWT (segundos UNIX). */
function accessTokenExp(accessToken: string | undefined): number | null {
  if (!accessToken) return null;
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const payload = JSON.parse(atob(b64)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Margen antes del vencimiento del JWT para renovar (evita 401 en llamadas largas o pestaña inactiva). */
export const JWT_REFRESH_SKEW_SEC = 300;

/** Si falta `exp` o caduca en menos de `skewSec`, hay que refrescar. */
function shouldRefreshAccessToken(accessToken: string | undefined, skewSec = JWT_REFRESH_SKEW_SEC): boolean {
  const exp = accessTokenExp(accessToken);
  if (exp == null) return true;
  const now = Math.floor(Date.now() / 1000);
  return exp - now < skewSec;
}

/** Normaliza metadata/BD al nombre de archivo en public/ y en assets del PDF */
export function normalizeServiceLogoFile(v: string | null): string {
  if (!v) return 'logo.png';
  const s = v.toString().toLowerCase();
  if (s.endsWith('.png') || s.endsWith('.jpg') || s.endsWith('.jpeg')) return s;
  if (s.includes('caterpillar')) return 'caterpillar.png';
  if (s.includes('komatsu')) return 'komatsu.png';
  if (s.includes('john_deere') || s.includes('john')) return 'john_deere.png';
  if (s.includes('danfoss')) return 'danfoss.png';
  // Permite logos arbitrarios: si no trae extensión, asumimos PNG.
  return `${s}.png`;
}

/** Nombre seguro para carpeta OneDrive/SharePoint (sin caracteres prohibidos). */
export function sanitizeOnedriveSubfolderName(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = raw.toString().trim();
  if (!s) return null;
  s = s.replace(/[\u0000-\u001f\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > 120) s = s.slice(0, 120).trim();
  return s;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    isSignedIn: false,
    email: null,
    displayName: null,
    userId: localStorage.getItem(AUTH_CACHED_USER_ID_KEY),
    loading: false,
    driveConfigReady: false,
    driveConfigRetryScheduled: false,
    serviceLogoFile: null,
    onedriveSubfolderName: null
  }),
  actions: {
    /**
     * Renueva access_token antes de RPC, REST o Edge Function (evita 401 Invalid JWT).
     * Las llamadas concurrentes comparten una sola promesa (mutex) para no tumbar el refresh token.
     */
    async refreshSessionForApi(options?: { force?: boolean }): Promise<Session | null> {
      if (!refreshSessionForApiMutex) {
        refreshSessionForApiMutex = this.refreshSessionForApiInner(options).finally(() => {
          refreshSessionForApiMutex = null;
        });
      }
      return refreshSessionForApiMutex;
    },
    /**
     * `force`: siempre llama a `refreshSession` si hay refresh_token (p. ej. tras 401 en Edge Function).
     * Si no, solo refresca cuando el access token falta o está a punto de caducar (evita rotar tokens en cada acción).
     */
    async refreshSessionForApiInner(options?: { force?: boolean }): Promise<Session | null> {
      const force = options?.force ?? false;
      try {
        const {
          data: { session: s0 }
        } = await supabase.auth.getSession();
        if (!s0?.user) return null;

        const needsRefresh =
          force || !s0.access_token || shouldRefreshAccessToken(s0.access_token, JWT_REFRESH_SKEW_SEC);

        let session: Session | null = s0;

        if (needsRefresh) {
          const rt = s0.refresh_token;
          if (!rt) return null;
          const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession({
            refresh_token: rt
          });
          if (refreshErr) {
            console.warn('refreshSessionForApi', refreshErr.message);
            return null;
          }
          session = refreshed.session ?? null;
          if (!session?.user) return null;
        }

        const gu1 = await supabase.auth.getUser();
        if (gu1.error || !gu1.data.user) {
          console.warn('getUser tras preparar sesión', gu1.error?.message);
          const { data: cur } = await supabase.auth.getSession();
          const rtRecover = cur.session?.refresh_token;
          if (!rtRecover) return null;
          const { data: refreshed2, error: e2 } = await supabase.auth.refreshSession({
            refresh_token: rtRecover
          });
          if (e2 || !refreshed2.session?.user) return null;
          session = refreshed2.session;
          const gu2 = await supabase.auth.getUser();
          if (gu2.error || !gu2.data.user) return null;
        }

        const {
          data: { session: latest }
        } = await supabase.auth.getSession();
        return latest ?? session;
      } catch (e) {
        console.error('refreshSessionForApi', e);
        return null;
      }
    },
    async getDriveConfigRow(userId: string) {
      const { data, error } = await supabase
        .from('user_drive_config')
        .select('pdf_folder_id, images_folder_id, service_logo_file, onedrive_subfolder_name')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    async uploadServiceLogo(file: File): Promise<string> {
      if (!this.userId) throw new Error('No hay usuario autenticado.');
      const rawName = file.name.toLowerCase();
      const ext = rawName.endsWith('.jpg') || rawName.endsWith('.jpeg') ? 'jpg' : 'png';
      const objectPath = `logos/${this.userId}.${ext}`;

      // Si ya hay fila en BD, no pasar por ensureDriveConfigIfNeeded (evita refresh de sesión que
      // puede quitar `provider_token` justo antes de guardar un registro / PDF).
      try {
        const cfg = await this.getDriveConfigRow(this.userId);
        if (cfg) {
          this.driveConfigReady = true;
          this.serviceLogoFile = cfg.service_logo_file ?? null;
          this.onedriveSubfolderName = cfg.onedrive_subfolder_name?.trim() || null;
        } else {
          await this.ensureDriveConfigIfNeeded();
        }
      } catch {
        await this.ensureDriveConfigIfNeeded();
      }

      const { error: upErr } = await supabase.storage.from(LOGO_BUCKET).upload(objectPath, file, {
        upsert: true,
        contentType: ext === 'jpg' ? 'image/jpeg' : 'image/png'
      });
      if (upErr) throw new Error(`No se pudo subir logo: ${upErr.message}`);

      const { error: cfgErr } = await supabase
        .from('user_drive_config')
        .update({ service_logo_file: objectPath })
        .eq('user_id', this.userId);
      if (cfgErr) throw new Error(`No se pudo guardar logo en configuración: ${cfgErr.message}`);

      this.serviceLogoFile = objectPath;
      return objectPath;
    },
    async saveOnedriveSubfolderLabel(raw: string) {
      if (!this.userId) throw new Error('No hay usuario autenticado.');
      const sanitized = sanitizeOnedriveSubfolderName(raw);
      await this.ensureDriveConfigIfNeeded();
      const { error } = await supabase
        .from('user_drive_config')
        .update({ onedrive_subfolder_name: sanitized })
        .eq('user_id', this.userId);
      if (error) throw new Error(`No se pudo guardar el nombre de carpeta: ${error.message}`);
      this.onedriveSubfolderName = sanitized;
    },
    scheduleDriveConfigRetry() {
      if (this.driveConfigRetryScheduled) return;
      this.driveConfigRetryScheduled = true;
      const retry = () => {
        window.removeEventListener('online', retry);
        this.driveConfigRetryScheduled = false;
        void this.ensureDriveConfigIfNeeded();
      };
      window.addEventListener('online', retry, { once: true });
    },
    async ensureDriveConfigIfNeeded() {
      if (!this.userId) return;
      if (!ensureDriveConfigMutex) {
        ensureDriveConfigMutex = this.ensureDriveConfigIfNeededBody().finally(() => {
          ensureDriveConfigMutex = null;
        });
      }
      await ensureDriveConfigMutex;
    },
    async ensureDriveConfigIfNeededBody() {
      if (!this.userId) return;
      try {
        // No llamar refreshSession aquí: rotar JWT antes de logo/Drive suele hacer que GoTrue guarde
        // la sesión sin `provider_token` y falle generate-ctpat-pdf al guardar justo después.
        const existing = await this.getDriveConfigRow(this.userId);
        if (existing) {
          this.driveConfigReady = true;
          this.serviceLogoFile = existing.service_logo_file ?? null;
          this.onedriveSubfolderName = existing.onedrive_subfolder_name?.trim() || null;
          return;
        }
      } catch (e) {
        console.error('Error consultando user_drive_config:', e);
      }

      if (!navigator.onLine) {
        this.driveConfigReady = false;
        this.scheduleDriveConfigRetry();
        return;
      }

      try {
        await this.ensureUserStorageConfig();
      } catch (e) {
        if (isPostgresUniqueViolation(e)) {
          try {
            if (!this.userId) return;
            const row = await this.getDriveConfigRow(this.userId);
            if (row) {
              this.driveConfigReady = true;
              this.serviceLogoFile = row.service_logo_file ?? null;
              this.onedriveSubfolderName = row.onedrive_subfolder_name?.trim() || null;
              return;
            }
          } catch (readErr) {
            console.error('Error leyendo user_drive_config tras conflicto:', readErr);
          }
        }
        console.error('Error asegurando configuración de almacenamiento:', e);
        this.driveConfigReady = false;
        this.scheduleDriveConfigRetry();
      }
    },
    async initSession() {
      this.loading = true;
      this.driveConfigReady = false;
      try {
        const {
          data: { session }
        } = await supabase.auth.getSession();

        if (session?.user) {
          this.isSignedIn = true;
          this.userId = session.user.id ?? null;
          this.email = session.user.email ?? null;
          this.displayName =
            (session.user.user_metadata?.full_name as string | undefined) ??
            (session.user.user_metadata?.name as string | undefined) ??
            this.email;
          if (this.userId) {
            localStorage.setItem(AUTH_CACHED_USER_ID_KEY, this.userId);
          }
          await this.ensureDriveConfigIfNeeded();
          if (!this.serviceLogoFile && session.user) {
            const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
            const candidate =
              (meta.service_logo_file as string | undefined) ??
              (meta.service_logo as string | undefined) ??
              (meta.service_code as string | undefined) ??
              (meta.service as string | undefined) ??
              null;
            if (candidate) {
              this.serviceLogoFile = normalizeServiceLogoFile(candidate);
            }
          }
        } else {
          this.isSignedIn = false;
          this.userId = null;
          this.email = null;
          this.displayName = null;
          this.serviceLogoFile = null;
          this.onedriveSubfolderName = null;
          localStorage.removeItem(AUTH_CACHED_USER_ID_KEY);
        }
      } catch (e) {
        console.error('Error initSession:', e);
        if (navigator.onLine) {
          this.isSignedIn = false;
          this.userId = null;
          this.email = null;
          this.displayName = null;
          this.serviceLogoFile = null;
          this.onedriveSubfolderName = null;
          localStorage.removeItem(AUTH_CACHED_USER_ID_KEY);
        } else {
          this.isSignedIn = !!this.userId;
          if (this.userId) {
            this.scheduleDriveConfigRetry();
          }
        }
      } finally {
        this.loading = false;
      }
    },
    /**
     * Crea fila en user_drive_config (logo) si no existe. La subida a Drive la hace la Edge Function.
     */
    async ensureUserStorageConfig() {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;
      if (this.userId && userId !== this.userId) {
        return;
      }

      const existing = await this.getDriveConfigRow(userId);

      if (existing) {
        this.driveConfigReady = true;
        this.serviceLogoFile = existing.service_logo_file ?? null;
        this.onedriveSubfolderName = existing.onedrive_subfolder_name?.trim() || null;
        return;
      }

      const meta = (session?.user?.user_metadata ?? {}) as Record<string, unknown>;
      const candidate =
        (meta.service_logo_file as string | undefined) ??
        (meta.service_logo as string | undefined) ??
        (meta.service_code as string | undefined) ??
        (meta.service as string | undefined) ??
        null;

      const logoFile = normalizeServiceLogoFile(candidate);

      const { error } = await supabase.from('user_drive_config').insert({
        user_id: userId,
        service_logo_file: logoFile
      });

      if (error) {
        if (isPostgresUniqueViolation(error)) {
          const row = await this.getDriveConfigRow(userId);
          if (row) {
            this.driveConfigReady = true;
            this.serviceLogoFile = row.service_logo_file ?? null;
            this.onedriveSubfolderName = row.onedrive_subfolder_name?.trim() || null;
            return;
          }
        }
        throw error;
      }
      this.driveConfigReady = true;
      this.serviceLogoFile = logoFile;
      this.onedriveSubfolderName = null;
    },
    async signInWithGoogle() {
      this.loading = true;
      // Usar el origen real de la pestaña evita errores OAuth 400 cuando VITE_SITE_URL
      // quedó apuntando a localhost en un despliegue remoto.
      const rawSiteUrl =
        window.location.origin || (import.meta.env.VITE_SITE_URL as string | undefined) || '';
      const redirectTo = rawSiteUrl.replace(/\/$/, '');

      try {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            scopes: 'openid profile email https://www.googleapis.com/auth/drive.file',
            queryParams: {
              access_type: 'offline',
              prompt: 'consent'
            }
          }
        });

        if (error) {
          // eslint-disable-next-line no-console
          console.error('Error signInWithGoogle', error);
        }
      } catch (e) {
        console.error('Error signInWithGoogle:', e);
      } finally {
        this.loading = false;
      }
    },
    async signOut() {
      await supabase.auth.signOut();
      this.isSignedIn = false;
      this.userId = null;
      this.email = null;
      this.displayName = null;
      this.serviceLogoFile = null;
      this.onedriveSubfolderName = null;
      localStorage.removeItem(AUTH_CACHED_USER_ID_KEY);
    },
    /**
     * Cierra sesión y avisa con un mensaje claro (sin códigos 401/JWT crudos).
     * Usar cuando la API indique sesión inválida o expirada.
     */
    async signOutDueToExpiredSession() {
      const toast = useToastStore();
      toast.error(SESSION_EXPIRED.title, SESSION_EXPIRED.message);
      await this.signOut();
    }
  }
});
