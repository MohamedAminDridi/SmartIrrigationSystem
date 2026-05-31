import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';

export default function RegisterPage() {
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '', phone: '', role: 'farmer',
  });
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handle = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');

    if (form.password !== form.confirmPassword)
      return setError('Passwords do not match');

    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        name:     form.name,
        email:    form.email,
        password: form.password,
        phone:    form.phone || undefined,
        role:     form.role,
      });
      setSuccess(`Account created for ${data.data.user.name}! Redirecting to login…`);
      setTimeout(() => nav('/login'), 2000);
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.details?.[0] || 'Registration failed');
    } finally { setLoading(false); }
  };

  const roleInfo = {
    farmer:     'Can view and control their assigned farms',
    viewer:     'Read-only access to farm data',
    technician: 'Can deploy firmware OTA updates',
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-10">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 w-full max-w-md">
        <div className="text-center mb-7">
          <span className="text-4xl">💧</span>
          <h1 className="text-xl font-semibold text-gray-900 mt-2">Create account</h1>
          <p className="text-sm text-gray-500">Smart Irrigation Platform</p>
        </div>

        <form onSubmit={handle} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Full name *</label>
            <input required value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="Ahmed Ben Ali"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
            <input required type="email" value={form.email} onChange={e => set('email', e.target.value)}
              placeholder="ahmed@farm.tn"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Phone <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input value={form.phone} onChange={e => set('phone', e.target.value)}
              placeholder="+216 XX XXX XXX"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Role *</label>
            <select value={form.role} onChange={e => set('role', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="farmer">Farmer</option>
              <option value="viewer">Viewer</option>
              <option value="technician">Technician</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">{roleInfo[form.role]}</p>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Password *</label>
            <input required type="password" value={form.password} onChange={e => set('password', e.target.value)}
              placeholder="Min 8 chars, 1 uppercase, 1 number"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            <p className="text-xs text-gray-400 mt-1">Example: Ahmed@1234</p>
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Confirm password *</label>
            <input required type="password" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)}
              placeholder="Repeat password"
              className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${
                form.confirmPassword && form.password !== form.confirmPassword
                  ? 'border-red-300' : 'border-gray-300'}`} />
            {form.confirmPassword && form.password !== form.confirmPassword && (
              <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
            )}
          </div>

          {/* Messages */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <p className="text-xs text-green-700">{success}</p>
            </div>
          )}

          <button disabled={loading || (form.confirmPassword && form.password !== form.confirmPassword)}
            className="w-full bg-green-700 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-green-800 transition-colors disabled:opacity-60">
            {loading ? 'Creating account…' : 'Create account'}
          </button>

          <p className="text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link to="/login" className="text-green-700 font-medium hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
