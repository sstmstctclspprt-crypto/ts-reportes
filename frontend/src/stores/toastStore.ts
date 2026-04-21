import { defineStore } from 'pinia';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  createdAt: number;
}

export const useToastStore = defineStore('toasts', {
  state: (): { items: ToastItem[] } => ({
    items: []
  }),
  actions: {
    success(title: string, message?: string) {
      this.add('success', title, message);
    },
    error(title: string, message?: string) {
      this.add('error', title, message);
    },
    info(title: string, message?: string) {
      this.add('info', title, message);
    },
    add(type: ToastType, title: string, message?: string) {
      const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const item: ToastItem = {
        id,
        type,
        title,
        message,
        createdAt: Date.now()
      };

      this.items.push(item);

      // Auto-cerrar toast para no saturar la UI
      window.setTimeout(() => {
        this.remove(id);
      }, 5500);
    },
    remove(id: string) {
      this.items = this.items.filter((t) => t.id !== id);
    }
  }
});

