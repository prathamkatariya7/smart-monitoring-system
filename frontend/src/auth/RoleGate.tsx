import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { Role } from '@/api/types';
import { useAuthStore } from '@/store/auth.store';

/** Renders children only if the current user has at least one of the given roles. */
export function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  if (!user.isAdmin && !roles.some((r) => user.roles.includes(r))) return null;
  return <>{children}</>;
}

/** Route guard that redirects unauthorized users to home (/) instead of letting them mount restricted admin pages. */
export function RoleRoute({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  const hasAccess = user.isAdmin || roles.some((r) => user.roles.includes(r));
  if (!hasAccess) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
