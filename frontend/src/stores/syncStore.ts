import { defineStore } from 'pinia';
import { supabase } from '../supabaseClient';
import { useAuthStore } from './authStore';
import {
  isGoogleDriveAccessError,
  isSessionExpiredError,
  isSupabaseGatewayUnauthorized,
  SESSION_EXPIRED_SHORT
} from '../utils/supabaseAuthErrors';
import { uploadSensitiveEvidence } from '../services/evidenceStorage';
import { validateRegistroPayload } from '../utils/registroValidation';

export type SyncKind = 'create_registro_and_generate' | 'generate_pdf';

export interface CreateRegistroAndGeneratePayload {
  userId: string;
  // Payload para insertar en `registros_ctpat`, pero SIN `folio_pdf` (lo generamos en sync).
  insertPayloadBase: Record<string, unknown>;
}

export interface GeneratePdfPayload {
  registroId: string;
  folio?: string;
}

type SyncPayload = CreateRegistroAndGeneratePayload | GeneratePdfPayload;

interface SyncItem {
  id: string; // id local para la cola (no necesariamente el id de BD)
  kind: SyncKind;
  payload: SyncPayload;
  status: 'pending' | 'processing' | 'done' | 'error';
  lastError?: string;
  updatedAt: string;
}

interface SyncState {
  queue: SyncItem[];
  syncing: boolean;
  history: SyncItem[];
  connectivity: 'online' | 'offline';
  retryAttempt: number;
  retryTimerId: number | null;
  periodicSyncTimerId: number | null;
}

export interface ProcessQueueResult {
  hadError: boolean;
  lastError?: string;
  /** Cola vacía, offline, o ya se estaba procesando */
  skipped: boolean;
}

const STORAGE_KEY = 'ts_ctpat_sync_queue_v1';
const HISTORY_KEY = 'ts_ctpat_sync_history_v1';
const IDB_NAME = 'ts_ctpat_sync_db_v1';
const IDB_STORE = 'kv';

/** IndexedDB no puede clonar Proxies (estado reactivo de Pinia/Vue). */
function cloneForIndexedDb<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** JWT de usuario listo para la puerta de Edge Functions (evita carrera tras refresh). */
async function getSupabaseJwtForEdgeFunction(auth: ReturnType<typeof useAuthStore>): Promise<string> {
  await auth.refreshSessionForApi({ force: true });
  const { data: s1, error: e1 } = await supabase.auth.getSession();
  if (e1) throw new Error(`Sesión: ${e1.message}`);
  let token = s1.session?.access_token?.trim();
  if (!token) {
    await new Promise((r) => setTimeout(r, 120));
    const { data: s2 } = await supabase.auth.getSession();
    token = s2.session?.access_token?.trim();
  }
  if (!token) {
    throw new Error('No hay sesión para generar el PDF. Vuelve a iniciar sesión.');
  }
  return token;
}

/**
 * Edge Function `generate-ctpat-pdf`: JWT Supabase + token OAuth de Google Drive.
 * Reintenta JWT Supabase ante 401 de puerta.
 */
async function invokeGenerateCtpatPdf(registroId: string): Promise<void> {
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  const auth = useAuthStore();

  const {
    data: { session: oauthSession }
  } = await supabase.auth.getSession();
  const googleAccessToken = (oauthSession as any)?.provider_token as string | undefined;
  if (!googleAccessToken) {
    throw new Error('No hay token de Google Drive. Cierra sesión y vuelve a iniciar con Google.');
  }

  let jwt = await getSupabaseJwtForEdgeFunction(auth);

  const runOnce = async (userJwt: string): Promise<void> => {
    const baseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/$/, '');
    if (!baseUrl) {
      throw new Error('Falta VITE_SUPABASE_URL.');
    }
    if (!anonKey) {
      throw new Error('Falta VITE_SUPABASE_ANON_KEY en el entorno de la app.');
    }
    const trimmedJwt = userJwt.trim();
    if (!trimmedJwt) {
      throw new Error('No hay token de sesión para llamar a la función.');
    }

    const url = `${baseUrl}/functions/v1/generate-ctpat-pdf`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trimmedJwt}`,
        apikey: anonKey,
        'X-Client-Info': 'ts-ctpat-pwa'
      },
      body: JSON.stringify({
        registroId,
        accessToken: googleAccessToken
      })
    });

    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const j = JSON.parse(text) as { message?: string; code?: number };
        const inner = j?.message ?? text;
        detail = `HTTP ${res.status}: ${inner}`;
      } catch {
        detail = text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`;
      }
      throw new Error(detail);
    }
    if (!text.trim()) return;

    let parsed: { ok?: boolean; error?: string };
    try {
      parsed = JSON.parse(text) as { ok?: boolean; error?: string };
    } catch {
      return;
    }
    if (parsed.ok === false) {
      throw new Error(parsed.error ?? 'Error en función');
    }
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await runOnce(jwt);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isSupabaseGatewayUnauthorized(message) && attempt < 4) {
        await auth.refreshSessionForApi({ force: true });
        jwt = await getSupabaseJwtForEdgeFunction(auth);
        continue;
      }
      throw err;
    }
  }
  throw new Error('generate-ctpat-pdf: reintentos agotados');
}

function shouldInvalidateLocalSession(message: string): boolean {
  // Mantener sesión local salvo errores reales de autenticación Supabase.
  // Errores de Google Drive no deben cerrar sesión Supabase.
  if (isSessionExpiredError(message)) return true;
  const m = message.toLowerCase();
  return (
    (m.includes('jwt') && m.includes('refresh')) ||
    m.includes('invalid refresh token')
  );
}

function openSyncDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    openSyncDb()
      .then((db) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(key);
        req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      })
      .catch(reject);
  });
}

function idbSet<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    openSyncDb()
      .then((db) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
      .catch(reject);
  });
}

function normalizeQueueItems(parsed: unknown): SyncItem[] {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((it: any) => {
      if (it?.kind === 'sync_drive') return null;
      if (it?.kind) return it as SyncItem;
      const registroId = it?.payload?.id;
      const folio = it?.payload?.folio;
      return {
        id: it?.id ?? registroId ?? String(Date.now()),
        kind: 'generate_pdf',
        payload: { registroId, folio } satisfies GeneratePdfPayload,
        status: it?.status ?? 'pending',
        lastError: it?.lastError,
        updatedAt: it?.updatedAt ?? new Date().toISOString()
      } satisfies SyncItem;
    })
    .filter((x): x is SyncItem => x != null);
}

export const useSyncStore = defineStore('sync', {
  state: (): SyncState => ({
    queue: [],
    syncing: false,
    history: [],
    connectivity: navigator.onLine ? 'online' : 'offline',
    retryAttempt: 0,
    retryTimerId: null,
    periodicSyncTimerId: null
  }),
  actions: {
    clearRetryTimer() {
      if (this.retryTimerId != null) {
        window.clearTimeout(this.retryTimerId);
        this.retryTimerId = null;
      }
    },
    scheduleRetry() {
      this.clearRetryTimer();
      const ms = Math.min(60000, 5000 * 2 ** Math.max(0, this.retryAttempt - 1));
      this.retryTimerId = window.setTimeout(() => {
        void this.processQueue();
      }, ms);
    },
    async updateConnectivity() {
      if (navigator.onLine) {
        this.connectivity = 'online';
        return;
      }

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 4000);
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/health`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal
        });
        this.connectivity = res.ok ? 'online' : 'offline';
      } catch {
        this.connectivity = 'offline';
      } finally {
        window.clearTimeout(timer);
      }
    },
    async loadFromStorage() {
      try {
        const queueFromDb = await idbGet<SyncItem[]>(STORAGE_KEY);
        const historyFromDb = await idbGet<SyncItem[]>(HISTORY_KEY);

        if (queueFromDb) {
          this.queue = normalizeQueueItems(queueFromDb);
        }
        if (historyFromDb) {
          this.history = Array.isArray(historyFromDb) ? historyFromDb : [];
        }

        if (!queueFromDb) {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            this.queue = normalizeQueueItems(JSON.parse(raw));
            await idbSet(STORAGE_KEY, cloneForIndexedDb(this.queue));
          }
        }
        if (!historyFromDb) {
          const rawHistory = localStorage.getItem(HISTORY_KEY);
          if (rawHistory) {
            this.history = JSON.parse(rawHistory);
            await idbSet(HISTORY_KEY, cloneForIndexedDb(this.history));
          }
        }
      } catch (e) {
        console.warn('SyncStore: IndexedDB no disponible, usando localStorage', e);
        const raw = localStorage.getItem(STORAGE_KEY);
        const rawHistory = localStorage.getItem(HISTORY_KEY);
        this.queue = raw ? normalizeQueueItems(JSON.parse(raw)) : [];
        this.history = rawHistory ? JSON.parse(rawHistory) : [];
      }
    },
    async persist() {
      try {
        await Promise.all([
          idbSet(STORAGE_KEY, cloneForIndexedDb(this.queue)),
          idbSet(HISTORY_KEY, cloneForIndexedDb(this.history))
        ]);
      } catch (e) {
        console.warn('SyncStore: error guardando en IndexedDB, usando localStorage', e);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
    },
    /**
     * JWT inválido (p. ej. usuario borrado en Supabase, refresh revocado): limpia cola local y cierra sesión.
     */
    /** Cierra sesión sin toast (el caller muestra un solo mensaje claro). */
    async handleSessionInvalidated() {
      this.clearRetryTimer();
      this.retryAttempt = 0;
      this.queue = [];
      await this.persist();
      const auth = useAuthStore();
      await auth.signOut();
    },
    enqueueCreateRegistroAndGenerate(payload: CreateRegistroAndGeneratePayload) {
      const safePayload = {
        ...payload,
        insertPayloadBase: validateRegistroPayload(payload.insertPayloadBase)
      };
      const now = new Date().toISOString();
      const id = `create_${payload.userId}_${Date.now()}`;
      const item: SyncItem = {
        id,
        kind: 'create_registro_and_generate',
        payload: safePayload,
        status: 'pending',
        updatedAt: now
      };
      this.queue.push(item);
      void this.persist();
    },
    enqueueGeneratePdf(payload: GeneratePdfPayload) {
      const now = new Date().toISOString();
      const id = `pdf_${payload.registroId}`;
      const alreadyQueued = this.queue.some((q) => q.id === id && q.status !== 'done');
      if (alreadyQueued) {
        return;
      }
      const item: SyncItem = {
        id,
        kind: 'generate_pdf',
        payload,
        status: 'pending',
        updatedAt: now
      };
      this.queue.push(item);
      void this.persist();
    },
    async processQueue(): Promise<ProcessQueueResult> {
      if (this.syncing) {
        return { hadError: false, skipped: true };
      }
      if (this.queue.length === 0) {
        return { hadError: false, skipped: true };
      }

      this.syncing = true;
      let hadSuccess = false;
      let hadError = false;
      let lastError: string | undefined;

      try {
        const authStore = useAuthStore();

        await this.updateConnectivity();
        if (this.connectivity !== 'online') {
          return { hadError: false, skipped: true };
        }

        let session = await authStore.refreshSessionForApi({ force: true });
        if (!session?.access_token) {
          const {
            data: { session: fallback }
          } = await supabase.auth.getSession();
          if (fallback?.access_token) {
            session = fallback;
          }
        }
        if (!session?.access_token) {
          return {
            hadError: true,
            lastError:
              'No se pudo validar la sesión para sincronizar. Comprueba la conexión o vuelve a iniciar sesión.',
            skipped: false
          };
        }

        for (const item of this.queue) {
          if (item.status !== 'pending') continue;
          item.status = 'processing';
          item.updatedAt = new Date().toISOString();
          await this.persist();

          try {
            if (item.kind === 'generate_pdf') {
              const payload = item.payload as GeneratePdfPayload;
              await invokeGenerateCtpatPdf(payload.registroId);

              item.status = 'done';
              item.lastError = undefined;
              item.updatedAt = new Date().toISOString();
              this.history.unshift({ ...item });
              hadSuccess = true;
            } else if (item.kind === 'create_registro_and_generate') {
              const payload = item.payload as CreateRegistroAndGeneratePayload;
              const organizationId =
                (session?.user?.app_metadata?.org_id as string | undefined)?.trim() ||
                payload.userId;

              let safeInsertPayloadBase = validateRegistroPayload(payload.insertPayloadBase);
              const images = Array.isArray(safeInsertPayloadBase.image_urls)
                ? safeInsertPayloadBase.image_urls
                : [];
              const hasSensitiveInlineData =
                images.some((v) => typeof v === 'string' && v.startsWith('data:')) ||
                (typeof safeInsertPayloadBase.firma_operador === 'string' &&
                  safeInsertPayloadBase.firma_operador.startsWith('data:')) ||
                (typeof safeInsertPayloadBase.firma_oficial === 'string' &&
                  safeInsertPayloadBase.firma_oficial.startsWith('data:'));

              if (hasSensitiveInlineData) {
                const uploaded = await uploadSensitiveEvidence({
                  userId: payload.userId,
                  organizationId,
                  payloadId: item.id,
                  imageDataUrls: images.filter((v) => typeof v === 'string'),
                  signatureOperadorDataUrl:
                    typeof safeInsertPayloadBase.firma_operador === 'string'
                      ? safeInsertPayloadBase.firma_operador
                      : undefined,
                  signatureOficialDataUrl:
                    typeof safeInsertPayloadBase.firma_oficial === 'string'
                      ? safeInsertPayloadBase.firma_oficial
                      : undefined
                });
                safeInsertPayloadBase = validateRegistroPayload({
                  ...safeInsertPayloadBase,
                  organization_id: organizationId,
                  image_urls: uploaded.imagePaths,
                  firma_operador: uploaded.signatureOperadorPath,
                  firma_oficial: uploaded.signatureOficialPath
                });
              }

              const { data: folioData, error: folioErr } = await supabase.rpc('next_folio_ctpat', {
                p_user_id: payload.userId
              });

              if (folioErr) {
                if (isSessionExpiredError(folioErr.message, folioErr.code)) {
                  await this.handleSessionInvalidated();
                  return { hadError: true, lastError: SESSION_EXPIRED_SHORT, skipped: false };
                }
              }
              if (folioErr || !folioData) {
                throw new Error(`No se pudo generar folio automático: ${folioErr?.message ?? 'sin detalle'}`);
              }

              const folioAuto = folioData as string;

              const insertPayload = {
                ...safeInsertPayloadBase,
                folio_pdf: folioAuto,
                sync_status: 'pending'
              };

              const { data: inserted, error: insertErr } = await supabase
                .from('registros_ctpat')
                .insert(insertPayload)
                .select('id, created_at, folio_pdf')
                .single();

              if (insertErr) {
                if (isSessionExpiredError(insertErr.message, insertErr.code)) {
                  await this.handleSessionInvalidated();
                  return { hadError: true, lastError: SESSION_EXPIRED_SHORT, skipped: false };
                }
              }
              if (insertErr || !inserted) {
                throw new Error(`Error insertando registro: ${insertErr?.message ?? 'sin detalle'}`);
              }

              await invokeGenerateCtpatPdf(inserted.id);

              item.status = 'done';
              item.lastError = undefined;
              item.updatedAt = new Date().toISOString();
              this.history.unshift({
                ...item,
                payload: {
                  registroId: inserted.id,
                  folio: folioAuto
                } satisfies GeneratePdfPayload
              });
              hadSuccess = true;
            }
          } catch (err) {
            const rawMessage = err instanceof Error ? err.message : String(err);
            const message = isGoogleDriveAccessError(rawMessage)
              ? 'Error al subir a Google Drive. Revisa permisos de Google y vuelve a intentar.'
              : rawMessage;
            if (shouldInvalidateLocalSession(message)) {
              await this.handleSessionInvalidated();
              return { hadError: true, lastError: SESSION_EXPIRED_SHORT, skipped: false };
            }
            item.status = 'error';
            item.lastError = message;
            item.updatedAt = new Date().toISOString();
            this.history.unshift({ ...item });
            hadError = true;
            lastError = message;
          }
        }

        this.queue = this.queue.filter((q) => q.status === 'pending' || q.status === 'error');
        await this.persist();
        return { hadError, lastError, skipped: false };
      } finally {
        this.syncing = false;
        if (hadSuccess) {
          this.retryAttempt = 0;
          this.clearRetryTimer();
        }
        if (hadError && this.queue.some((q) => q.status === 'error' || q.status === 'pending')) {
          this.retryAttempt += 1;
          this.scheduleRetry();
        }
      }
    },
    async retryErroredItems() {
      for (const item of this.queue) {
        if (item.status === 'error') {
          item.status = 'pending';
          item.lastError = undefined;
          item.updatedAt = new Date().toISOString();
        }
      }
      await this.persist();
      return this.processQueue();
    },
    async clearErroredItems() {
      const before = this.queue.length;
      this.queue = this.queue.filter((item) => item.status !== 'error');
      if (this.queue.length !== before) {
        await this.persist();
      }
    },
    async markErroredItemsAsPending() {
      let touched = false;
      for (const item of this.queue) {
        if (item.status === 'error') {
          const msg = (item.lastError ?? '').toLowerCase();
          // Errores funcionales (requiere acción del usuario) no se reintentan automáticamente.
          if (msg.includes('template requerida') || msg.includes('plantilla pdf')) {
            continue;
          }
          item.status = 'pending';
          item.lastError = undefined;
          item.updatedAt = new Date().toISOString();
          touched = true;
        }
      }
      if (touched) {
        await this.persist();
      }
    },
    attachOnlineListener() {
      window.addEventListener('offline', () => {
        this.connectivity = 'offline';
      });
      window.addEventListener('online', () => {
        void this.updateConnectivity();
        this.retryAttempt = 0;
        void this.markErroredItemsAsPending();
        const auth = useAuthStore();
        if (auth.isSignedIn) {
          void auth.refreshSessionForApi({ force: false });
        }
        void this.processQueue();
      });
    },
    attachLifecycleListeners() {
      const trigger = () => {
        const auth = useAuthStore();
        if (auth.isSignedIn) {
          void auth.refreshSessionForApi({ force: false });
        }
        void this.processQueue();
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') trigger();
      });
      window.addEventListener('focus', trigger);
      window.addEventListener('pageshow', trigger);
    },
    attachPeriodicSync(intervalMs = 45000) {
      if (this.periodicSyncTimerId != null) {
        window.clearInterval(this.periodicSyncTimerId);
      }
      this.periodicSyncTimerId = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        void this.processQueue();
      }, intervalMs);
    }
  }
});
