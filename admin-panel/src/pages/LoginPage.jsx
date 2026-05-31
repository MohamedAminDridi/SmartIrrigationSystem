import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

export default function LoginPage() {
  const [form,    setForm]    = useState({ email: '', password: '' });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const { setTokens, setUser } = useAuthStore();
  const nav = useNavigate();

  const handle = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
      setTokens(data.data.access, data.data.refresh);
      setUser(data.data.user);
      nav('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed — check email and password');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 w-full max-w-sm">
        <div className="text-center mb-7">
          <span className="text-4xl">💧</span>
          <h1 className="text-xl font-semibold text-gray-900 mt-2">IrriAdmin</h1>
          <p className="text-sm text-gray-500">Smart Irrigation Platform</p>
        </div>

        <form onSubmit={handle} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input type="email" required value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="admin@irrigation.io"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
            <input type="password" required value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="••••••••"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          <button disabled={loading}
            className="w-full bg-green-700 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-green-800 transition-colors disabled:opacity-60">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-center text-sm text-gray-500">
            New client?{' '}
            <Link to="/register" className="text-green-700 font-medium hover:underline">
              Create account
            </Link>
          </p>
        </form>

        {/* Quick fill for dev */}
        {import.meta.env.DEV && (
          <div className="mt-5 pt-5 border-t border-gray-100">
            <p className="text-xs text-gray-400 text-center mb-2">Dev quick login</p>
            <button
              onClick={() => setForm({ email: 'admin@irrigation.io', password: 'Admin@1234' })}
              className="w-full text-xs text-gray-500 border border-gray-200 rounded-lg py-2 hover:bg-gray-50">
              Fill admin credentials
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
