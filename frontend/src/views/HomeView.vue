<template>
  <div class="space-y-6">
    <section class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-slate-800">
          Registros
        </h2>
        <p class="text-sm text-slate-500 mt-0.5">
          Gestiona tus reportes de entrada y salida de transporte.
        </p>
        <div class="mt-2 flex items-center gap-3">
          <img
            v-if="serviceLogoPreviewUrl"
            :src="serviceLogoPreviewUrl"
            alt="Logo de servicio"
            class="h-8 w-16 object-contain rounded border border-slate-200 bg-white px-1"
          />
          <span v-else class="text-xs text-slate-500">Sin logo configurado (se usará `logo.png`).</span>
        </div>
      </div>
      <div class="grid w-full sm:w-auto grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          ref="logoInputRef"
          type="file"
          accept="image/png,image/jpeg,image/jpg"
          class="hidden"
          @change="onPickLogo"
        />
        <button
          class="btn-secondary w-full sm:w-auto shrink-0"
          :disabled="uploadingLogo"
          @click="triggerLogoPicker"
        >
          {{ uploadingLogo ? 'Subiendo logo...' : 'Configurar logo' }}
        </button>
        <button
          class="btn-primary w-full sm:w-auto shrink-0"
          @click="goNew"
        >
          Nuevo registro
        </button>
      </div>
      <div class="mt-4 w-full max-w-xl rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-3">
        <p class="text-xs font-semibold text-slate-800">
          Carpeta en OneDrive (respaldo)
        </p>
        <p class="text-xs text-slate-500 mt-1 leading-snug">
          Escribe un nombre para tu subcarpeta; Power Automate debe usar el campo
          <code class="text-[11px] bg-white px-1 rounded border border-slate-200">onedriveSubfolder</code>
          en la ruta. Si lo dejas vacío, se usa tu id de usuario.
        </p>
        <div class="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            v-model="onedriveFolderDraft"
            type="text"
            maxlength="120"
            autocomplete="off"
            placeholder="Ej. Transportes López"
            class="flex-1 min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-tactical-blue/30 focus:border-tactical-blue"
          />
          <button
            type="button"
            class="btn-secondary shrink-0 whitespace-nowrap"
            :disabled="savingOnedriveFolder"
            @click="saveOnedriveFolderDraft"
          >
            {{ savingOnedriveFolder ? 'Guardando…' : 'Guardar nombre' }}
          </button>
        </div>
      </div>
    </section>

    <section
      v-if="cameraBlockedBanner"
      class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      role="status"
    >
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div class="min-w-0">
          <p class="font-semibold">Permiso de cámara necesario</p>
          <p class="mt-1 text-amber-900/90 leading-snug">
            Si rechazaste el acceso, el navegador ya no muestra el mismo aviso: abre el menú del sitio (candado o ⋮ en la barra de dirección),
            permite <strong>Cámara</strong> para esta página y, si no cambia, recarga la pestaña. Después vuelve a pulsar «Nuevo registro».
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
          @click="dismissCameraBlockedBanner"
        >
          Ocultar aviso
        </button>
      </div>
    </section>

    <section class="card p-4 sm:p-5">
      <div class="space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <span class="text-sm font-medium text-slate-700">Filtrar por movimiento</span>
          <span
            class="inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold"
            :class="syncStatusClass"
          >
            {{ syncStatusText }}
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            v-if="pwa.isInstallable && !pwa.isStandalone"
            type="button"
            class="text-xs text-emerald-700 font-semibold hover:underline"
            @click="installPwa"
          >
            Instalar app en Android
          </button>
          <button
            v-if="erroredSyncCount > 0"
            type="button"
            class="text-xs text-tactical-blue font-semibold hover:underline"
            @click="retrySyncErrors"
          >
            Reintentar ({{ erroredSyncCount }})
          </button>
          <button
            v-if="erroredSyncCount > 0"
            type="button"
            class="text-xs text-rose-700 font-semibold hover:underline"
            @click="clearSyncErrors"
          >
            Limpiar errores
          </button>
          <button
            v-if="syncQueueItems.length > 0 || pendingSyncCount > 0"
            type="button"
            class="text-xs text-indigo-700 font-semibold hover:underline disabled:opacity-60"
            :disabled="syncStore.syncing || syncStore.connectivity === 'offline'"
            @click="syncNow"
          >
            {{ syncStore.syncing ? 'Sincronizando…' : 'Sincronizar ahora' }}
          </button>
        </div>

        <div class="overflow-x-auto">
          <div class="inline-flex min-w-full sm:min-w-0 rounded-lg border border-slate-200 bg-slate-50/50 p-0.5">
            <button
              v-for="opt in movementOptions"
              :key="opt.value"
              type="button"
              class="flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap"
              :class="
                movementFilter === opt.value
                  ? 'bg-tactical-blue text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-800 hover:bg-white'
              "
              @click="movementFilter = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </div>
      <p
        v-if="syncErrorMessage"
        class="mt-3 text-sm text-rose-700 break-words"
        role="alert"
      >
        {{ syncErrorMessage }}
      </p>
      <p
        v-if="syncQueueItems.length > 0"
        class="mt-2 text-xs text-slate-500"
      >
        Cola: {{ syncQueueItems.length }} elemento(s)
        <span v-if="pendingSyncCount"> · pendientes: {{ pendingSyncCount }}</span>
        <span v-if="erroredSyncCount"> · con error: {{ erroredSyncCount }}</span>
      </p>
    </section>

    <!-- Lista de registros por folio -->
    <section class="card p-4 sm:p-5">
      <div class="flex items-center justify-between gap-3 mb-4">
        <h3 class="text-base font-semibold text-slate-800">Registros guardados</h3>
        <button
          type="button"
          class="text-sm text-tactical-blue font-medium hover:underline"
          :disabled="loadingRegistros"
          @click="loadRegistros"
        >
          {{ loadingRegistros ? 'Cargando…' : 'Actualizar' }}
        </button>
      </div>
      <div
        v-if="loadingRegistros && registros.length === 0"
        class="text-center py-8 text-slate-500 text-sm"
      >
        Cargando registros…
      </div>
      <div
        v-else-if="filteredRegistros.length === 0"
        class="text-center py-8 text-slate-500 text-sm"
      >
        <p>{{ movementFilter === 'all' ? 'Aún no hay registros.' : 'No hay registros con este filtro.' }}</p>
        <p class="text-xs mt-1">Crea uno con «Nuevo registro».</p>
      </div>
      <ul v-else class="divide-y divide-slate-100 -mx-1 px-1">
        <li
          v-for="r in filteredRegistros"
          :key="r.id"
          class="py-3 flex items-center justify-between gap-3"
        >
          <div class="min-w-0 flex-1">
            <p class="font-semibold text-slate-800">
              {{ formatFolio(r.folio_pdf) || 'Sin folio' }}
            </p>
            <p class="text-xs text-slate-500 mt-0.5">
              {{ new Date(r.created_at).toLocaleString() }}
            </p>
          </div>
          <span
            class="shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
            :class="movementBadgeClass(r)"
          >
            {{ movementLabel(r) }}
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { supabase } from '../supabaseClient';
import { isSessionExpiredError } from '../utils/supabaseAuthErrors';
import { getServiceLogoPublicUrl } from '../utils/serviceLogoUrl';
import {
  clearRegistroCameraBlockedHint,
  hasRegistroCameraBlockedHint
} from '../utils/cameraPermission';
import { useAuthStore } from '../stores/authStore';
import { usePwaStore } from '../stores/pwaStore';
import { useSyncStore, type SyncKind } from '../stores/syncStore';
import { useToastStore } from '../stores/toastStore';

const router = useRouter();
const authStore = useAuthStore();
const syncStore = useSyncStore();
const pwa = usePwaStore();
const toastStore = useToastStore();

const movementFilter = ref<'all' | 'entrada' | 'salida'>('all');
const registros = ref<Array<{
  id: string;
  folio_pdf: string | null;
  created_at: string;
  sync_status: string | null;
  drive_file_id: string | null;
  checklist_tracto: Record<string, unknown> | null;
}>>([]);
const loadingRegistros = ref(false);
const uploadingLogo = ref(false);
const logoInputRef = ref<HTMLInputElement | null>(null);
const cameraBlockedBanner = ref(false);
const onedriveFolderDraft = ref('');
const savingOnedriveFolder = ref(false);

watch(
  () => authStore.onedriveSubfolderName,
  (v) => {
    onedriveFolderDraft.value = v ?? '';
  },
  { immediate: true }
);

function refreshCameraBlockedBanner() {
  cameraBlockedBanner.value = hasRegistroCameraBlockedHint();
}

function dismissCameraBlockedBanner() {
  clearRegistroCameraBlockedHint();
  cameraBlockedBanner.value = false;
}

const movementOptions = [
  { label: 'Todos', value: 'all' },
  { label: 'Entrada', value: 'entrada' },
  { label: 'Salida', value: 'salida' }
] as const;
interface QueueRow {
  id: string;
  kind: SyncKind;
  status: 'pending' | 'processing' | 'done' | 'error';
  lastError?: string;
  updatedAt: string;
}

const pendingSyncCount = computed(
  () => syncStore.queue.filter((q) => q.status === 'pending' || q.status === 'processing').length
);
const erroredSyncCount = computed(() => syncStore.queue.filter((q) => q.status === 'error').length);
const syncQueueItems = computed<QueueRow[]>(() =>
  [...syncStore.queue].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
);
const syncErrorMessage = computed(() => {
  const failed = syncStore.queue.filter((q) => q.status === 'error' && q.lastError);
  if (failed.length === 0) return '';
  const latest = [...failed].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )[0];
  return latest?.lastError ?? '';
});
const syncStatusText = computed(() => {
  if (syncStore.connectivity === 'offline') return 'Sin conexión';
  if (syncStore.syncing) return 'Sincronizando…';
  if (pendingSyncCount.value > 0) return `Pendientes (${pendingSyncCount.value})`;
  if (erroredSyncCount.value > 0) return `Error (${erroredSyncCount.value})`;
  return 'Sincronización al día';
});
const syncStatusClass = computed(() => {
  if (syncStore.connectivity === 'offline') return 'bg-amber-100 text-amber-800';
  if (erroredSyncCount.value > 0) return 'bg-rose-100 text-rose-800';
  if (syncStore.syncing || pendingSyncCount.value > 0) return 'bg-blue-100 text-blue-800';
  return 'bg-emerald-100 text-emerald-800';
});
const serviceLogoPreviewUrl = computed(() => getServiceLogoPublicUrl(authStore.serviceLogoFile || 'logo.png'));

function formatFolio(folio: string | null | undefined): string {
  if (!folio || typeof folio !== 'string') return '';
  const m = folio.trim().match(/^TS-0*(\d+)$/i);
  if (m) return `TS-${String(Number(m[1]))}`;
  return folio;
}

function getEntradaSalida(r: { checklist_tracto: Record<string, unknown> | null }): 'Entrada' | 'Salida' | null {
  const dg = (r.checklist_tracto as Record<string, unknown>)?.datos_generales as Record<string, unknown> | undefined;
  const v = dg?.entradaSalida;
  if (v === 'Entrada' || v === 'Salida') return v;
  return null;
}

const filteredRegistros = computed(() => {
  const list = registros.value;
  if (movementFilter.value === 'all') return list;
  const want = movementFilter.value === 'entrada' ? 'Entrada' : 'Salida';
  return list.filter((r) => getEntradaSalida(r) === want);
});

function movementLabel(r: { checklist_tracto: Record<string, unknown> | null }): string {
  const v = getEntradaSalida(r);
  return v === 'Entrada' ? 'Entrada' : v === 'Salida' ? 'Salida' : '—';
}

function movementBadgeClass(r: { checklist_tracto: Record<string, unknown> | null }): string {
  const v = getEntradaSalida(r);
  if (v === 'Entrada') return 'bg-blue-100 text-blue-800';
  if (v === 'Salida') return 'bg-slate-200 text-slate-800';
  return 'bg-slate-100 text-slate-600';
}

async function loadRegistros() {
  loadingRegistros.value = true;
  if (navigator.onLine) {
    await authStore.refreshSessionForApi();
  }
  const {
    data: { user },
    error: userErr
  } = await supabase.auth.getUser();
  if (userErr && isSessionExpiredError(userErr.message, userErr.code)) {
    await authStore.signOutDueToExpiredSession();
    registros.value = [];
    loadingRegistros.value = false;
    return;
  }
  if (!user?.id) {
    registros.value = [];
    loadingRegistros.value = false;
    return;
  }
  const { data, error } = await supabase
    .from('registros_ctpat')
    .select('id, folio_pdf, created_at, sync_status, drive_file_id, checklist_tracto')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error cargando registros', error);
    if (isSessionExpiredError(error.message, error.code)) {
      await authStore.signOutDueToExpiredSession();
    }
    registros.value = [];
  } else {
    registros.value = data ?? [];
    // Rehidrata la cola desde BD para registros que existen pero aún no se han subido a Drive.
    // Esto evita falsos "Sincronización al día" después de recargas o cambios de dispositivo.
    const pendingDriveSync = (data ?? []).filter(
      (r) => r.sync_status !== 'synced' || !r.drive_file_id
    );
    for (const row of pendingDriveSync) {
      if (row?.id) {
        await syncStore.enqueueGeneratePdf({
          registroId: row.id,
          folio: row.folio_pdf ?? undefined
        });
      }
    }
    if (pendingDriveSync.length > 0) {
      await syncStore.processQueue();
    }
  }
  loadingRegistros.value = false;
}

onMounted(() => {
  loadRegistros();
  refreshCameraBlockedBanner();
});

watch(
  () => router.currentRoute.value.name,
  (name) => {
    if (name === 'home') {
      loadRegistros();
      refreshCameraBlockedBanner();
    }
  }
);


function goNew() {
  router.push({ name: 'registro-new' });
}

function triggerLogoPicker() {
  logoInputRef.value?.click();
}

async function saveOnedriveFolderDraft() {
  savingOnedriveFolder.value = true;
  try {
    await authStore.saveOnedriveSubfolderLabel(onedriveFolderDraft.value);
    toastStore.success(
      'Carpeta guardada',
      'Los próximos PDF enviarán este nombre a Power Automate como onedriveSubfolder.'
    );
  } catch (e) {
    toastStore.error('Carpeta', e instanceof Error ? e.message : 'No se pudo guardar.');
  } finally {
    savingOnedriveFolder.value = false;
  }
}

async function onPickLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploadingLogo.value = true;
  try {
    await authStore.uploadServiceLogo(file);
    toastStore.success('Logo actualizado', 'El logo se guardó para tu servicio.');
  } catch (e) {
    toastStore.error('Logo', e instanceof Error ? e.message : 'No se pudo actualizar el logo.');
  } finally {
    uploadingLogo.value = false;
    input.value = '';
  }
}

function retrySyncErrors() {
  void syncStore.retryErroredItems();
}

async function clearSyncErrors() {
  await syncStore.clearErroredItems();
  toastStore.info('Errores limpiados', 'Se eliminaron los elementos con error de la cola.');
}

function syncNow() {
  void syncStore.processQueue();
}

async function installPwa() {
  const outcome = await pwa.promptInstall();
  if (outcome === 'accepted') {
    toastStore.success('App instalada', 'Ya puedes abrirla desde tu pantalla de inicio.');
    return;
  }
  if (outcome === 'dismissed') {
    toastStore.info('Instalación cancelada', 'Puedes intentarlo nuevamente cuando quieras.');
  }
}
</script>

