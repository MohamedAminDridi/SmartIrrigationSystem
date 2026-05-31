import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
export default function WaterUsageChart({ data=[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="bucket" tick={{ fontSize:11 }} />
        <YAxis tick={{ fontSize:11 }} />
        <Tooltip />
        <Bar dataKey="total_litres" fill="#15803d" radius={[4,4,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
