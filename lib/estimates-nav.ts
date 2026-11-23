import type { UserWithRoles } from '@/lib/rbac-types';

/** Visibility hint only. The account-scoped server APIs and database RPCs
 * enforce the real per-account finance permission on every request. */
export function canShowEstimatesMenu(profile: UserWithRoles | null | undefined): boolean {
  if (!profile || profile.is_client) return false;
  if (profile.is_superadmin) return true;

  return (profile.user_roles ?? []).some((assignment) =>
    !assignment.removed_at && assignment.roles?.permissions?.view_estimates === true,
  );
}
