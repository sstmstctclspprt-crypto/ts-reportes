<template>
  <div class="space-y-1 text-xs">
    <label class="font-semibold text-slate-700">{{ label }}</label>
    <div
      class="border border-dashed border-slate-300 rounded-md h-40 flex items-center justify-center bg-slate-50 relative overflow-hidden"
    >
      <div v-if="!image" class="flex flex-col items-center gap-1 text-slate-500">
        <span class="text-2xl">📷</span>
        <span>Toque para capturar</span>
      </div>
      <img v-else :src="image" :alt="label" class="w-full h-full object-contain" />
      <input
        type="file"
        accept="image/*"
        capture="environment"
        class="absolute inset-0 opacity-0 cursor-pointer"
        @change="$emit('pick', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  image: string;
}>();

defineEmits<{
  (e: 'pick', event: Event): void;
}>();
</script>

