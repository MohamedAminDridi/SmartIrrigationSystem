import { create } from 'zustand';

export const useAlertStore = create((set) => ({
  unreadCount: 0,
  toasts:      [],

  setUnreadCount:  (n)     => set({ unreadCount: n }),
  incrementUnread: ()      => set((s) => ({ unreadCount: s.unreadCount + 1 })),
  decrementUnread: ()      => set((s) => ({ unreadCount: Math.max(0, s.unreadCount - 1) })),

  addToast:    (alert) => set((s) => ({ toasts: [...s.toasts.slice(-2), { ...alert, _toastId: Date.now() }] })),
  removeToast: (toastId) => set((s) => ({ toasts: s.toasts.filter(t => t._toastId !== toastId) })),
}));
