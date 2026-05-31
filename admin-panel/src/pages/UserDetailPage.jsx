import { useParams, useNavigate } from 'react-router-dom';
export default function UserDetailPage() {
  const { id } = useParams(); const nav = useNavigate();
  return (
    <div className="space-y-4">
      <button onClick={()=>nav('/users')} className="text-sm text-gray-500 hover:text-gray-800">← Back</button>
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">
        Wire <code className="font-mono text-xs">GET /api/admin/users/{id}</code> to populate this page.
      </div>
    </div>
  );
}
