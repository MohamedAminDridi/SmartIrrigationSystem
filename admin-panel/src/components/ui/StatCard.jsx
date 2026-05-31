export default function StatCard({ label, value, unit = '', color = 'green', trend }) {
  const colors = {
    green:  'bg-green-50  text-green-700',
    blue:   'bg-blue-50   text-blue-700',
    amber:  'bg-amber-50  text-amber-700',
    red:    'bg-red-50    text-red-700',
  };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">
        {value ?? '—'}<span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>
      </p>
      {trend && <p className="text-xs text-gray-500 mt-1">{trend}</p>}
    </div>
  );
}
