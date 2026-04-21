<template>
  <div class="fixed top-4 right-4 z-50 space-y-3 max-w-[360px]">
    <div
      v-for="t in toast.items"
      :key="t.id"
      class="card p-3 flex items-start gap-3"
      :class="toastClass(t.type)"
      role="status"
      aria-live="polite"
    >
      <div class="mt-0.5">
        <svg
          v-if="t.type === 'success'"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-5 w-5 text-green-700"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <svg
          v-else-if="t.type === 'error'"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-5 w-5 text-red-700"
          aria-hidden="true"
        >
          <path d="M18 6 6 18" />
          <path d="M6 6l12 12" />
        </svg>
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-5 w-5 text-blue-700"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </div>

      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold" :class="textClass(t.type)">{{ t.title }}</p>
        <p v-if="t.message" class="text-sm mt-0.5 text-slate-600" :class="subTextClass(t.type)">
          {{ t.message }}
        </p>
      </div>

      <button
        type="button"
        class="text-slate-500 hover:text-slate-700"
        aria-label="Cerrar notificacion"
        @click="toast.remove(t.id)"
      >
        <span class="text-lg leading-none">×</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToastStore } from '../stores/toastStore';

const toast = useToastStore();

function toastClass(type: string) {
  if (type === 'success') return 'border-green-200/80 bg-green-50/70';
  if (type === 'error') return 'border-red-200/80 bg-red-50/70';
  return 'border-blue-200/80 bg-blue-50/70';
}

function textClass(type: string) {
  if (type === 'success') return 'text-green-800';
  if (type === 'error') return 'text-red-800';
  return 'text-blue-800';
}

function subTextClass(type: string) {
  if (type === 'success') return 'text-green-700';
  if (type === 'error') return 'text-red-700';
  return 'text-blue-700';
}
</script>

