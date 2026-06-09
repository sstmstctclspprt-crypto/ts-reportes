<template>
  <div class="max-w-md mx-auto card p-6 sm:p-8 space-y-6">
    <div class="text-center space-y-2">
      <h2 class="text-xl font-bold text-slate-800">Activar acceso</h2>
      <p class="text-sm text-slate-600 leading-snug">
        Tu cuenta de Google está conectada. Para usar Tactical Support necesitas un código de acceso
        o la aprobación del administrador.
      </p>
    </div>

    <div
      v-if="access.isRejected"
      class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
    >
      Tu acceso fue rechazado. Contacta al administrador si crees que es un error.
    </div>

    <div
      v-else-if="access.isPending"
      class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      Estado: <strong>pendiente</strong>. Introduce el código que te proporcionó el administrador o espera
      su aprobación manual.
    </div>

    <form class="space-y-4" @submit.prevent="submitCode">
      <div>
        <label for="access-code" class="block text-sm font-medium text-slate-700 mb-1">
          Código de acceso
        </label>
        <input
          id="access-code"
          v-model="codeDraft"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="Ej. TS-AB12CD34"
          class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-tactical-blue/30 focus:border-tactical-blue"
        />
      </div>
      <button type="submit" class="btn-primary w-full" :disabled="submitting">
        {{ submitting ? 'Validando…' : 'Activar con código' }}
      </button>
    </form>

    <p class="text-xs text-slate-500 text-center">
      Conectado como {{ auth.email || auth.displayName }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAccessStore } from '../stores/accessStore';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

const router = useRouter();
const access = useAccessStore();
const auth = useAuthStore();
const toast = useToastStore();

const codeDraft = ref('');
const submitting = ref(false);

async function submitCode() {
  submitting.value = true;
  try {
    const result = await access.redeemCode(codeDraft.value);
    if (!result.ok) {
      toast.error('Código inválido', result.error ?? 'Intenta de nuevo.');
      return;
    }
    toast.success('Acceso activado', 'Ya puedes usar la aplicación.');
    await auth.initSession();
    await router.replace({ name: 'home' });
  } finally {
    submitting.value = false;
  }
}
</script>
