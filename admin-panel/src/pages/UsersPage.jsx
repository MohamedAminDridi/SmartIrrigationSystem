import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import Badge from '../components/ui/Badge';

const ROLE_VARIANT = { admin:'danger', farmer:'success', viewer:'info', technician:'warning' };

export default function UsersPage() {
  const [users,   setUsers]   = useState([]);
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [msg,     setMsg]     = useState('');
  const nav = useNavigate();

  const [form, setForm] = useState({
    name:'', email:'', password:'', phone:'', role:'farmer',
  });
  const set = (k,v) => setForm(f => ({...f, [k]:v}));

  // Load all users — calls GET /api/admin/users (we add this route below)
  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/users');
      setUsers(data.data.users);
    } catch {
      // fallback: show only current user if admin route not ready
      const { data } = await api.get('/auth/me');
      setUsers([data.data.user]);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const addUser = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/auth/register', form);
      setMsg(`✓ User ${form.name} created successfully`);
      setShowAdd(false);
      setForm({ name:'', email:'', password:'', phone:'', role:'farmer' });
      load();
    } catch (err) {
      setMsg(`✗ ${err.response?.data?.message || 'Failed to create user'}`);
    }
  };

  const filtered = users.filter(u =>
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-gray-900 flex-1">Clients & Users</h1>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-green-500" />
        <button onClick={() => setShowAdd(v => !v)}
          className="bg-green-700 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-800 transition-colors">
          {showAdd ? '✕ Cancel' : '+ Add client'}
        </button>
      </div>

      {/* Feedback message */}
      {msg && (
        <div className={`px-4 py-2 rounded-lg text-sm ${msg.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {msg}
        </div>
      )}

      {/* Add client form */}
      {showAdd && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">New client</h2>
          <form onSubmit={addUser} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Full name *</label>
              <input required value={form.name} onChange={e => set('name', e.target.value)}
                placeholder="Ahmed Ben Ali"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
              <input required type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="ahmed@farm.tn"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                placeholder="+216 XX XXX XXX"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role *</label>
              <select value={form.role} onChange={e => set('role', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="farmer">Farmer</option>
                <option value="viewer">Viewer</option>
                <option value="technician">Technician</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Password *</label>
              <input required type="password" value={form.password} onChange={e => set('password', e.target.value)}
                placeholder="Min 8 chars, 1 uppercase, 1 number — e.g. Ahmed@1234"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div className="col-span-2 flex gap-3 justify-end">
              <button type="button" onClick={() => setShowAdd(false)}
                className="text-sm text-gray-500 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
                Cancel
              </button>
              <button type="submit"
                className="bg-green-700 text-white text-sm px-6 py-2 rounded-lg hover:bg-green-800 transition-colors">
                Create client
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Name','Email','Role','Status','Phone','Joined'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No users found</td></tr>
            ) : filtered.map(u => (
              <tr key={u._id} onClick={() => nav(`/users/${u._id}`)}
                className="cursor-pointer hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-semibold text-sm">
                      {u.name?.[0]?.toUpperCase()}
                    </div>
                    <span className="font-medium text-gray-800">{u.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{u.email}</td>
                <td className="px-4 py-3">
                  <Badge label={u.role} variant={ROLE_VARIANT[u.role] || 'gray'} />
                </td>
                <td className="px-4 py-3">
                  <Badge label={u.isActive ? 'Active' : 'Suspended'} variant={u.isActive ? 'success' : 'danger'} />
                </td>
                <td className="px-4 py-3 text-gray-500">{u.phone || '—'}</td>
                <td className="px-4 py-3 text-gray-500">
                  {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
