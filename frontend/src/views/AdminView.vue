<template>
  <div class="space-y-6">
    <section>
      <h2 class="text-xl font-bold text-slate-800">Panel de administración</h2>
      <p class="text-sm text-slate-500 mt-1">
        Genera códigos de acceso y aprueba usuarios manualmente.
      </p>
    </section>

    <section class="card p-4 sm:p-5 space-y-4">
      <h3 class="text-sm font-semibold text-slate-800">Nuevo código de acceso</h3>
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="sm:col-span-2">
          <label class="block text-xs font-medium text-slate-600 mb-1">Etiqueta (opcional)</label>
          <input
            v-model="codeLabel"
            type="text"
            maxlength="80"
            placeholder="Ej. Cliente Castores"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1">Usos máx.</label>
          <input
            v-model.number="codeMaxUses"
            type="number"
            min="1"
            max="100"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <button type="button" class="btn-primary" :disabled="creatingCode" @click="createCode">
        {{ creatingCode ? 'Generando…' : 'Generar código' }}
      </button>
      <div
        v-if="generatedCode"
        class="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"
      >
        <p class="font-semibold">Código generado (cópialo ahora, no se volverá a mostrar):</p>
        <p class="mt-2 font-mono text-lg tracking-wider select-all">{{ generatedCode }}</p>
      </div>
    </section>

    <section class="card p-4 sm:p-5 space-y-3">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-slate-800">Usuarios</h3>
        <button type="button" class="text-xs text-tactical-blue font-semibold hover:underline" @click="loadUsers">
          Actualizar
        </button>
      </div>
      <p v-if="loadingUsers" class="text-sm text-slate-500">Cargando…</p>
      <div v-else-if="users.length === 0" class="text-sm text-slate-500">Sin usuarios registrados.</div>
      <ul v-else class="divide-y divide-slate-100">
        <li
          v-for="u in users"
          :key="u.user_id"
          class="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-slate-800 truncate">{{ u.email || u.user_id }}</p>
            <p class="text-xs text-slate-500">
              Estado: <span :class="statusClass(u.status)">{{ statusLabel(u.status) }}</span>
            </p>
          </div>
          <div class="flex flex-wrap gap-2 shrink-0">
            <button
              v-if="u.status !== 'approved'"
              type="button"
              class="btn-primary py-1.5 px-3 text-xs"
              :disabled="actingUserId === u.user_id"
              @click="setStatus(u.user_id, 'approved')"
            >
              Aprobar
            </button>
            <button
              v-if="u.status !== 'rejected'"
              type="button"
              class="btn-secondary py-1.5 px-3 text-xs"
              :disabled="actingUserId === u.user_id"
              @click="setStatus(u.user_id, 'rejected')"
            >
              Rechazar
            </button>
            <button
              v-if="u.status !== 'pending'"
              type="button"
              class="text-xs text-slate-600 hover:underline"
              :disabled="actingUserId === u.user_id"
              @click="setStatus(u.user_id, 'pending')"
            >
              Pendiente
            </button>
          </div>
        </li>
      </ul>
    </section>

    <section class="card p-4 sm:p-5 space-y-3">
      <h3 class="text-sm font-semibold text-slate-800">Códigos emitidos</h3>
      <p v-if="loadingCodes" class="text-sm text-slate-500">Cargando…</p>
      <ul v-else-if="codes.length > 0" class="text-xs text-slate-600 space-y-2">
        <li v-for="c in codes" :key="c.id" class="border-b border-slate-100 pb-2">
          <span class="font-medium">{{ c.label || 'Sin etiqueta' }}</span>
          — usos {{ c.use_count }}/{{ c.max_uses }}
          <span v-if="c.expires_at"> — expira {{ formatDate(c.expires_at) }}</span>
          <span v-if="!c.is_active" class="text-rose-600"> (inactivo)</span>
        </li>
      </ul>
      <p v-else class="text-sm text-slate-500">Aún no hay códigos.</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  useAccessStore,
  type AccessCodeRow,
  type AccessUserRow,
  type UserAccessStatus
} from '../stores/accessStore';
import { useToastStore } from '../stores/toastStore';

const access = useAccessStore();
const toast = useToastStore();

const users = ref<AccessUserRow[]>([]);
const codes = ref<AccessCodeRow[]>([]);
const loadingUsers = ref(false);
const loadingCodes = ref(false);
const creatingCode = ref(false);
const actingUserId = ref<string | null>(null);
const codeLabel = ref('');
const codeMaxUses = ref(1);
const generatedCode = ref('');

function statusLabel(s: UserAccessStatus): string {
  if (s === 'approved') return 'Aprobado';
  if (s === 'rejected') return 'Rechazado';
  return 'Pendiente';
}

function statusClass(s: UserAccessStatus): string {
  if (s === 'approved') return 'text-emerald-700 font-semibold';
  if (s === 'rejected') return 'text-rose-700 font-semibold';
  return 'text-amber-700 font-semibold';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function loadUsers() {
  loadingUsers.value = true;
  const res = await access.adminListUsers();
  loadingUsers.value = false;
  if (!res.ok) {
    toast.error('Error', res.error ?? 'No se pudo cargar usuarios.');
    return;
  }
  users.value = res.users;
}

async function loadCodes() {
  loadingCodes.value = true;
  const res = await access.adminListCodes();
  loadingCodes.value = false;
  if (!res.ok) {
    toast.error('Error', res.error ?? 'No se pudo cargar códigos.');
    return;
  }
  codes.value = res.codes;
}

async function createCode() {
  creatingCode.value = true;
  generatedCode.value = '';
  try {
    const res = await access.adminCreateCode({
      label: codeLabel.value,
      maxUses: codeMaxUses.value
    });
    if (!res.ok || !res.code) {
      toast.error('Error', res.error ?? 'No se pudo generar el código.');
      return;
    }
    generatedCode.value = res.code;
    toast.success('Código creado', 'Compártelo con el usuario autorizado.');
    await loadCodes();
  } finally {
    creatingCode.value = false;
  }
}

async function setStatus(userId: string, status: UserAccessStatus) {
  actingUserId.value = userId;
  try {
    const res = await access.adminSetUserAccess(userId, status);
    if (!res.ok) {
      toast.error('Error', res.error ?? 'No se pudo actualizar.');
      return;
    }
    toast.success('Actualizado', `Usuario marcado como ${statusLabel(status).toLowerCase()}.`);
    await loadUsers();
  } finally {
    actingUserId.value = null;
  }
}

onMounted(() => {
  void loadUsers();
  void loadCodes();
});
</script>
