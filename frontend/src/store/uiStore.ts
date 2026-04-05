import { create } from 'zustand';
import type { NotificationItem } from '../types/models';

const TOAST_TTL_MS = 4500;

interface UiState {
  sidebarOpen: boolean;
  compactMode: boolean;
  search: string;
  notifications: NotificationItem[];
  setSearch: (value: string) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (value: boolean) => void;
  setCompactMode: (value: boolean) => void;
  pushNotification: (item: NotificationItem) => void;
  dismissNotification: (id: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  compactMode: false,
  search: '',
  notifications: [],
  setSearch: (search) => set({ search }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setCompactMode: (compactMode) => set({ compactMode }),
  pushNotification: (item) => {
    set((state) => ({
      notifications: [item, ...state.notifications].slice(0, 8),
    }));

    setTimeout(() => {
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== item.id),
      }));
    }, TOAST_TTL_MS);
  },
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
}));
