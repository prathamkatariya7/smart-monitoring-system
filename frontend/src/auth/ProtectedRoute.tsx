import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/api/auth';
import type { AuthUser } from '@/api/types';

// Module-level (not per-component-instance) so React 18 StrictMode's
// deliberate dev-only double-mount reuses the same in-flight `.me()` call
// instead of firing two near-simultaneous requests -- each of which would
// otherwise independently hit a 401 (no access token yet after a reload)
// and trigger the axios refresh-and-retry interceptor, showing as two
// confusing-looking console errors even though both silently recover.
let inFlightMe: Promise<AuthUser> | null = null;
function meOnce(): Promise<AuthUser> {
  if (!inFlightMe) {
    inFlightMe = authApi.me().finally(() => {
      inFlightMe = null;
    });
  }
  return inFlightMe;
}

/**
 * Guards a route behind a valid session. If a user is already resolved in
 * memory, or there's no refresh token at all, no async check is needed --
 * those cases are handled synchronously. Otherwise (e.g. page reload with a
 * refresh token but no in-memory user yet), it calls GET /auth/me, which
 * itself triggers the axios 401-refresh interceptor if the access token in
 * memory has expired/is missing, before deciding whether to redirect to /login.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, refreshToken, setUser } = useAuthStore();
  const location = useLocation();
  const [checking, setChecking] = useState(() => !user && !!refreshToken);

  useEffect(() => {
    if (!checking) return;
    meOnce()
      .then(setUser)
      .catch(() => useAuthStore.getState().logout())
      .finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!useAuthStore.getState().user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
