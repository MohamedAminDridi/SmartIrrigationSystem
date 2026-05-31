import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// Dev: VITE_API_URL is unset → relative '/api' uses Vite proxy → backend:5000
// Prod (Netlify): VITE_API_URL = 'https://your-public-backend.com' → direct call
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}/api`
    : '/api',
});

api.interceptors.request.use(cfg => {
  const token = useAuthStore.getState().token;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refresh = useAuthStore.getState().refreshToken;
        const { data } = await axios.post('/api/auth/refresh', { refresh_token: refresh });
        useAuthStore.getState().setTokens(data.data.access, data.data.refresh);
        original.headers.Authorization = `Bearer ${data.data.access}`;
        return api(original);
      } catch {
        useAuthStore.getState().logout();
      }
    }
    return Promise.reject(err);
  }
);

export default api;
