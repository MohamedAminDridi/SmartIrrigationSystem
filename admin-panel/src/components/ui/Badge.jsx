const variants = {
  success:  'bg-green-100  text-green-700',
  warning:  'bg-amber-100  text-amber-700',
  danger:   'bg-red-100    text-red-700',
  info:     'bg-blue-100   text-blue-700',
  gray:     'bg-gray-100   text-gray-600',
  online:   'bg-green-100  text-green-700',
  offline:  'bg-red-100    text-red-600',
  unknown:  'bg-gray-100   text-gray-500',
};

export default function Badge({ label, variant = 'gray' }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant] || variants.gray}`}>
      {label}
    </span>
  );
}
