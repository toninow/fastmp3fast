import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clearUserScopedData, db } from '../lib/db/database';
import type { UserProfile } from '../types/models';

interface AuthState {
  user: UserProfile | null;
  token: string | null;
  hydrated: boolean;
  setSession: (user: UserProfile, token: string) => Promise<void>;
  clearSession: () => Promise<void>;
  markHydrated: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      hydrated: false,
      setSession: async (user, token) => {
        const previousUser = get().user;
        if (previousUser && String(previousUser.id) !== String(user.id)) {
          await clearUserScopedData();
        }

        set({ user, token });
        await db.cachedUser.put({
          id: 'current',
          user,
          token,
          lastValidatedAt: new Date().toISOString(),
        });
      },
      clearSession: async () => {
        await clearUserScopedData();
        set({ user: null, token: null });
        await db.cachedUser.delete('current');
      },
      markHydrated: () => {
        if (!get().hydrated) {
          set({ hydrated: true });
        }
      },
    }),
    {
      name: 'fastmp3fast-auth',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
      }),
      onRehydrateStorage: () => (state) => {
        state?.markHydrated();
      },
    }
  )
);
