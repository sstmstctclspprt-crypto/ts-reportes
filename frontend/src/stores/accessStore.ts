import { defineStore } from 'pinia';
import { supabase } from '../supabaseClient';

export type UserAccessStatus = 'pending' | 'approved' | 'rejected';

export interface AccessUserRow {
  user_id: string;
  email: string | null;
  status: UserAccessStatus;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccessCodeRow {
  id: string;
  label: string | null;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

interface AccessState {
  ready: boolean;
  loading: boolean;
  status: UserAccessStatus | null;
  isAdmin: boolean;
}

export const useAccessStore = defineStore('access', {
  state: (): AccessState => ({
    ready: false,
    loading: false,
    status: null,
    isAdmin: false
  }),
  getters: {
    isApproved: (s) => s.status === 'approved',
    isPending: (s) => s.status === 'pending',
    isRejected: (s) => s.status === 'rejected'
  },
  actions: {
    reset() {
      this.ready = false;
      this.loading = false;
      this.status = null;
      this.isAdmin = false;
    },
    async syncContext(): Promise<void> {
      this.loading = true;
      try {
        const { data, error } = await supabase.rpc('sync_user_access_context');
        if (error) {
          console.error('[accessStore] sync_user_access_context:', error.message);
          this.status = 'pending';
          this.isAdmin = false;
          return;
        }
        const row = data as { ok?: boolean; status?: UserAccessStatus; is_admin?: boolean } | null;
        if (row?.ok) {
          this.status = row.status ?? 'pending';
          this.isAdmin = row.is_admin === true;
        } else {
          this.status = 'pending';
          this.isAdmin = false;
        }
      } finally {
        this.ready = true;
        this.loading = false;
      }
    },
    async redeemCode(code: string): Promise<{ ok: boolean; error?: string }> {
      const trimmed = code.trim();
      if (!trimmed) {
        return { ok: false, error: 'Escribe el código de acceso.' };
      }
      const { data, error } = await supabase.rpc('redeem_access_code', { p_code: trimmed });
      if (error) {
        return { ok: false, error: error.message };
      }
      const row = data as { ok?: boolean; error?: string; status?: UserAccessStatus } | null;
      if (!row?.ok) {
        return { ok: false, error: row?.error ?? 'Código inválido.' };
      }
      this.status = row.status ?? 'approved';
      return { ok: true };
    },
    async adminCreateCode(options?: {
      label?: string;
      maxUses?: number;
      expiresDays?: number | null;
    }): Promise<{ ok: boolean; code?: string; error?: string }> {
      const { data, error } = await supabase.rpc('admin_create_access_code', {
        p_label: options?.label?.trim() || null,
        p_max_uses: options?.maxUses ?? 1,
        p_expires_days: options?.expiresDays ?? null
      });
      if (error) {
        return { ok: false, error: error.message };
      }
      const row = data as { ok?: boolean; code?: string; error?: string } | null;
      if (!row?.ok || !row.code) {
        return { ok: false, error: row?.error ?? 'No se pudo crear el código.' };
      }
      return { ok: true, code: row.code };
    },
    async adminSetUserAccess(
      userId: string,
      status: UserAccessStatus
    ): Promise<{ ok: boolean; error?: string }> {
      const { data, error } = await supabase.rpc('admin_set_user_access', {
        p_user_id: userId,
        p_status: status
      });
      if (error) {
        return { ok: false, error: error.message };
      }
      const row = data as { ok?: boolean; error?: string } | null;
      if (!row?.ok) {
        return { ok: false, error: row?.error ?? 'No se pudo actualizar.' };
      }
      return { ok: true };
    },
    async adminListUsers(): Promise<{ ok: boolean; users: AccessUserRow[]; error?: string }> {
      const { data, error } = await supabase.rpc('admin_list_user_access');
      if (error) {
        return { ok: false, users: [], error: error.message };
      }
      const row = data as { ok?: boolean; users?: AccessUserRow[]; error?: string } | null;
      if (!row?.ok) {
        return { ok: false, users: [], error: row?.error ?? 'No autorizado.' };
      }
      return { ok: true, users: row.users ?? [] };
    },
    async adminListCodes(): Promise<{ ok: boolean; codes: AccessCodeRow[]; error?: string }> {
      const { data, error } = await supabase.rpc('admin_list_access_codes');
      if (error) {
        return { ok: false, codes: [], error: error.message };
      }
      const row = data as { ok?: boolean; codes?: AccessCodeRow[]; error?: string } | null;
      if (!row?.ok) {
        return { ok: false, codes: [], error: row?.error ?? 'No autorizado.' };
      }
      return { ok: true, codes: row.codes ?? [] };
    }
  }
});
