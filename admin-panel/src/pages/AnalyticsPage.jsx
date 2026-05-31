import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../services/api';

export default function AnalyticsPage() {
  const [farms, setFarms]  = useState([]);
  const [farmId, setFarmId] = useState('');
  const [history, setHistory] = useState([]);

  useEffect(() => { api.get('/farms').then(r => setFarms(r.data.data.farms)); }, []);

  useEffect(() => {
    if (!farmId) return;
    api.get(`/nodes/undefined/history`).then(r => setHistory(r.data.data?.history || [])).catch(() => setHistory([]));
  }, [farmId]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold text-gray-900 flex-1">Analytics</h1>
        <select value={farmId} onChange={e => setFarmId(e.target.value)}
          className="border border-gray-300 rounded-lg text-sm px-3 py-2">
          <option value="">Select farm</option>
          {farms.map(f => <option key={f._id} value={f._id}>{f.name}</option>)}
        </select>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Soil moisture — 24h</h2>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={history}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="soil_moisture_pct" stroke="#15803d" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
