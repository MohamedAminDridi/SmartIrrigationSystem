import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
const COLORS = ['#15803d','#1d4ed8','#b45309','#be185d'];
export default function SensorChart({ data=[], keys=[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="bucket" tick={{ fontSize:11 }} />
        <YAxis tick={{ fontSize:11 }} />
        <Tooltip /><Legend />
        {keys.map((k,i) => <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i%4]} strokeWidth={2} dot={false} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}
