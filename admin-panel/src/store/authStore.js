import { create } from 'zustand';

export const useAuthStore = create((set) => ({
  token:        localStorage.getItem('adm_token')   || null,
  refreshToken: localStorage.getItem('adm_refresh') || null,
  user:         null,

  setTokens: (access, refresh) => {
    localStorage.setItem('adm_token',   access);
    localStorage.setItem('adm_refresh', refresh);
    set({ token: access, refreshToken: refresh });
  },

  setUser: (user) => set({ user }),

  logout: () => {
    localStorage.removeItem('adm_token');
    localStorage.removeItem('adm_refresh');
    set({ token: null, refreshToken: null, user: null });
  },
}));
