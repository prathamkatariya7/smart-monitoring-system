import { create } from 'zustand';
import type { Notification } from '@/api/types';

interface NotificationsState {
  items: Notification[];
  unseenCount: number;
  push: (n: Notification) => void;
  updateItem: (n: Notification) => void;
  setAll: (items: Notification[]) => void;
  /** Mark a single notification seen in local state and remove it from the active list. */
  markSeenLocal: (id: string) => void;
  /** Mark all notifications seen and clear the active list. */
  markAllSeenLocal: () => void;
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  items: [],
  unseenCount: 0,
  push: (n) =>
    set((s) => {
      const idx = s.items.findIndex((i) => i.id === n.id);
      let items: Notification[];
      if (idx >= 0) {
        items = [...s.items];
        items[idx] = { ...items[idx], ...n };
      } else {
        items = [n, ...s.items];
      }
      return { items, unseenCount: items.filter((i) => !i.seenAt).length };
    }),
  updateItem: (n) =>
    set((s) => {
      const idx = s.items.findIndex((i) => i.id === n.id);
      if (idx >= 0) {
        const items = [...s.items];
        items[idx] = { ...items[idx], ...n };
        return { items, unseenCount: items.filter((i) => !i.seenAt).length };
      }
      const items = [n, ...s.items];
      return { items, unseenCount: items.filter((i) => !i.seenAt).length };
    }),
  setAll: (items) => set({ items, unseenCount: items.filter((i) => !i.seenAt).length }),
  markSeenLocal: (id) =>
    set((s) => {
      const items = s.items.filter((i) => i.id !== id);
      return { items, unseenCount: items.filter((i) => !i.seenAt).length };
    }),
  markAllSeenLocal: () => set({ items: [], unseenCount: 0 }),
}));

