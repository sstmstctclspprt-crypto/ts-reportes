<template>
  <div class="min-h-screen flex flex-col bg-slate-50">
    <ToastContainer />

    <header class="bg-white border-b border-slate-200/80 shadow-card sticky top-0 z-10">
      <div class="max-w-4xl mx-auto px-4 sm:px-6">
        <div class="flex items-center justify-between h-16">
          <router-link
            to="/"
            class="flex items-center gap-3 text-slate-800 no-underline hover:opacity-90 transition-opacity"
          >
            <img src="/logo.png" alt="Tactical Support" class="h-9 w-9 object-contain flex-shrink-0" />
            <div>
              <h1 class="text-base font-bold text-tactical-blue uppercase tracking-wide leading-tight">
                Tactical Support
              </h1>
              <p class="text-xs text-slate-500 leading-tight">Registros</p>
            </div>
          </router-link>

          <div class="flex items-center gap-3">
            <template v-if="auth.isSignedIn">
              <router-link
                v-if="access.isAdmin"
                to="/admin"
                class="hidden sm:inline text-xs font-semibold text-tactical-blue hover:underline"
              >
                Admin
              </router-link>
              <div class="hidden sm:block text-right">
                <p class="text-xs text-slate-500">Conectado como</p>
                <p class="text-sm font-medium text-slate-800 truncate max-w-[160px]">
                  {{ auth.displayName || auth.email }}
                </p>
              </div>
              <button
                type="button"
                class="btn-secondary py-2 px-3 text-xs"
                @click="auth.signOut"
              >
                Cerrar sesión
              </button>
            </template>
            <template v-else>
              <button
                type="button"
                class="btn-primary py-2 px-4 text-sm"
                :disabled="auth.loading"
                @click="auth.signInWithGoogle"
              >
                <span v-if="auth.loading" class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span v-else>Iniciar con Google</span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </header>

    <main class="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <router-view />
    </main>

    <footer class="border-t border-slate-200 bg-white">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 py-4 text-xs text-slate-600">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <router-link to="/privacidad" class="hover:text-tactical-blue">Política de Privacidad</router-link>
          <router-link to="/terminos" class="hover:text-tactical-blue">Términos y Condiciones</router-link>
          <router-link to="/seguridad-soporte" class="hover:text-tactical-blue">Seguridad y Soporte</router-link>
        </div>
        <p class="mt-2">Tactical Support</p>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useAccessStore } from './stores/accessStore';
import { useAuthStore } from './stores/authStore';
import { usePwaStore } from './stores/pwaStore';
import { useSyncStore } from './stores/syncStore';
import ToastContainer from './components/ToastContainer.vue';
import { supabase } from './supabaseClient';

const auth = useAuthStore();
const access = useAccessStore();
const sync = useSyncStore();
const pwa = usePwaStore();

let authSubscription: { unsubscribe: () => void } | null = null;
/** Renueva JWT antes de que caduque si el usuario deja la pestaña abierta (cola vacía no llama a processQueue). */
let sessionKeepAliveId: ReturnType<typeof setInterval> | null = null;
const SESSION_KEEPALIVE_MS = 3 * 60 * 1000;

function clearSessionKeepAlive() {
  if (sessionKeepAliveId != null) {
    clearInterval(sessionKeepAliveId);
    sessionKeepAliveId = null;
  }
}

function scheduleSessionKeepAlive() {
  clearSessionKeepAlive();
  sessionKeepAliveId = setInterval(() => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    if (!auth.isSignedIn) return;
    void auth.refreshSessionForApi({ force: false });
  }, SESSION_KEEPALIVE_MS);
}

function refreshSessionIfVisible() {
  if (document.visibilityState !== 'visible' || !navigator.onLine) return;
  if (!auth.isSignedIn) return;
  void auth.refreshSessionForApi({ force: false });
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') refreshSessionIfVisible();
}

onMounted(() => {
  pwa.init();
  void auth.initSession();

  watch(
    () => auth.isSignedIn,
    (signedIn) => {
      if (signedIn) {
        scheduleSessionKeepAlive();
      } else {
        clearSessionKeepAlive();
      }
    },
    { immediate: true }
  );

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', refreshSessionIfVisible);

  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN') {
      void auth.initSession();
    }
  });
  authSubscription = data.subscription;

  void (async () => {
    await sync.loadFromStorage();
    sync.attachOnlineListener();
    sync.attachLifecycleListeners();
    sync.attachPeriodicSync(45000);
    await sync.updateConnectivity(typeof navigator !== 'undefined' && navigator.onLine ? 2 : 1);
    if (sync.connectivity === 'online') {
      await sync.processQueue();
    }
  })();
});

onBeforeUnmount(() => {
  authSubscription?.unsubscribe();
  clearSessionKeepAlive();
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('focus', refreshSessionIfVisible);
});
</script>
