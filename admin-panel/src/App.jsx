import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import AdminLayout    from './components/layout/AdminLayout';
import LoginPage      from './pages/LoginPage';
import RegisterPage   from './pages/RegisterPage';
import DashboardPage  from './pages/DashboardPage';
import UsersPage      from './pages/UsersPage';
import UserDetailPage from './pages/UserDetailPage';
import FarmsPage      from './pages/FarmsPage';
import FarmDetailPage from './pages/FarmDetailPage';
import GatewaysPage   from './pages/GatewaysPage';
import NodesPage      from './pages/NodesPage';
import AlertsPage     from './pages/AlertsPage';
import AnalyticsPage  from './pages/AnalyticsPage';
import OtaPage        from './pages/OtaPage';
import SettingsPage   from './pages/SettingsPage';

// 3D twin pulls in three.js + R3F (~1.2 MB) — load it only when visited.
const FarmTwinPage = lazy(() => import('./pages/FarmTwinPage'));

function PrivateRoute({ children }) {
  const token = useAuthStore(s => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login"    element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Protected — admin layout */}
      <Route path="/" element={<PrivateRoute><AdminLayout /></PrivateRoute>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"  element={<DashboardPage />} />
        <Route path="users"      element={<UsersPage />} />
        <Route path="users/:id"  element={<UserDetailPage />} />
        <Route path="farms"      element={<FarmsPage />} />
        <Route path="farms/:id"  element={<FarmDetailPage />} />
        <Route path="gateways"   element={<GatewaysPage />} />
        <Route path="nodes"      element={<NodesPage />} />
        <Route path="alerts"     element={<AlertsPage />} />
        <Route path="analytics"  element={<AnalyticsPage />} />
        <Route path="twin"       element={
          <Suspense fallback={<div className="p-8 text-sm text-gray-500">Loading 3D twin…</div>}>
            <FarmTwinPage />
          </Suspense>
        } />
        <Route path="ota"        element={<OtaPage />} />
        <Route path="settings"   element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
