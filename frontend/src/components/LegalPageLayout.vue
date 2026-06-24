<template>
  <section class="card p-6 sm:p-8 space-y-6">
    <header class="space-y-2">
      <h2 class="text-xl font-bold text-tactical-blue">{{ title }}</h2>
      <p class="text-sm text-slate-500">
        Tactical Support · Última actualización: 17 de junio de 2026
      </p>
    </header>

    <nav
      class="flex flex-wrap gap-1 border-b border-slate-200 pb-px"
      aria-label="Secciones legales"
    >
      <router-link
        v-for="tab in legalPageTabs"
        :key="tab.to"
        :to="tab.to"
        class="rounded-t-md px-3 py-2 text-xs font-semibold transition-colors sm:text-sm"
        :class="
          route.path === tab.to
            ? 'border-b-2 border-tactical-blue text-tactical-blue bg-slate-50'
            : 'text-slate-600 hover:text-tactical-blue hover:bg-slate-50'
        "
      >
        {{ tab.label }}
      </router-link>
    </nav>

    <div class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Documentación de referencia
      </p>
      <div
        class="flex flex-wrap gap-2"
        role="tablist"
        aria-label="Enlaces a documentación de cumplimiento y seguridad"
      >
        <a
          v-for="ref in legalReferenceLinks"
          :key="ref.id"
          :href="ref.href"
          target="_blank"
          rel="noopener noreferrer"
          role="tab"
          class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-tactical-blue hover:text-tactical-blue"
        >
          {{ ref.label }}
          <span aria-hidden="true" class="text-[10px] opacity-60">↗</span>
        </a>
      </div>
    </div>

    <div class="space-y-4 text-sm text-slate-700 leading-6">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';
import { legalPageTabs, legalReferenceLinks } from '../constants/legalReferences';

defineProps<{
  title: string;
}>();

const route = useRoute();
</script>
