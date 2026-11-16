import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/auth/ProtectedRoute';
import { RoleRoute } from '@/auth/RoleGate';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';
import { AppLayout } from '@/layout/AppLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { ReactorsPage } from '@/pages/reactors/ReactorsPage';
import { ReactorDetailPage } from '@/pages/reactors/ReactorDetailPage';
import { DevicesPage } from '@/pages/devices/DevicesPage';
import { ProcessesPage } from '@/pages/processes/ProcessesPage';
import { ProcessDetailPage } from '@/pages/processes/ProcessDetailPage';
import { AlarmsPage } from '@/pages/alarms/AlarmsPage';
import { NotificationsPage } from '@/pages/notifications/NotificationsPage';
import { CalibrationsPage } from '@/pages/calibrations/CalibrationsPage';
import { AdminPage } from '@/pages/admin/AdminPage';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <RealtimeProvider>
              <ErrorBoundary>
                <AppLayout />
              </ErrorBoundary>
            </RealtimeProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="reactors" element={<ReactorsPage />} />
        <Route path="reactors/:id" element={<ReactorDetailPage />} />
        <Route
          path="devices"
          element={
            <RoleRoute roles={['ADMIN']}>
              <DevicesPage />
            </RoleRoute>
          }
        />
        <Route path="processes" element={<ProcessesPage />} />
        <Route path="processes/:id" element={<ProcessDetailPage />} />
        <Route path="alarms" element={<AlarmsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route
          path="calibrations"
          element={
            <RoleRoute roles={['ADMIN', 'BOROSIL_ADMIN']}>
              <CalibrationsPage />
            </RoleRoute>
          }
        />
        <Route
          path="admin"
          element={
            <RoleRoute roles={['ADMIN', 'BOROSIL_ADMIN']}>
              <AdminPage />
            </RoleRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
