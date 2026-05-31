import { useState } from 'react';

export default function SettingsPage() {
  const [saved,setSaved]=useState(false);
  const [form,setForm]=useState({ jwt_expires:'15m', cors_origin:'http://localhost:5173',
    timezone:'Africa/Tunis', smtp_host:'', smtp_port:'587', twilio_sid:'', twilio_token:'', twilio_from:'' });
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const save=()=>{ setSaved(true); setTimeout(()=>setSaved(false),2500); };
  const Field=({label,k,type='text'})=>(
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={form[k]} onChange={e=>set(k,e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
    </div>
  );
  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
      {saved && <p className="text-sm text-green-700 bg-green-50 px-4 py-2 rounded-lg">Saved (wire to backend to persist)</p>}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">System</h2>
        <Field label="JWT expiry"    k="jwt_expires" />
        <Field label="CORS origin"   k="cors_origin" />
        <Field label="Timezone"      k="timezone" />
      </section>
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">SMTP</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Host" k="smtp_host" />
          <Field label="Port" k="smtp_port" />
        </div>
      </section>
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Twilio</h2>
        <Field label="Account SID" k="twilio_sid"   type="password" />
        <Field label="Auth token"  k="twilio_token" type="password" />
        <Field label="From number" k="twilio_from" />
      </section>
      <button onClick={save} className="bg-green-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-green-800">Save settings</button>
    </div>
  );
}
