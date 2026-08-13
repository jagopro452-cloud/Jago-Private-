// Single source of truth for admin role -> permission grants, imported by
// BOTH the backend (server/routes.ts authorization guards) and the frontend
// (client/src/pages/admin/layout.tsx nav/button visibility, employees.tsx
// role dropdown). Do not duplicate this list anywhere else - see the RBAC
// unification / Business Authorization Matrix design work this codifies.

export const ADMIN_PERMISSION_MATRIX: Record<string, string[]> = {
  superadmin: ["*"],
  admin: [
    "ops.read", "ops.write",
    "pricing.read", "pricing.write",
    "support.write",
    "finance.read", "finance.write",
    "withdrawals.read", "withdrawals.write",
    "users.read", "users.write",
    "vehicles.write",
    "marketing.write",
    "admin.write",
    "platform.read",
  ],
  // Backend-only roles kept for compatibility - not assigned to any account
  // via the current UI (Employee Setup does not offer these as options).
  finance: ["finance.read", "finance.write", "withdrawals.read", "withdrawals.write"],
  finance_admin: ["finance.read", "finance.write", "withdrawals.read", "withdrawals.write"],
  support: ["support.write"],

  // Employee Setup roles (client/src/pages/admin/employees.tsx). Grants were
  // derived from the Business Authorization Matrix, not raw category
  // visibility - money-movement (withdrawals.write) and identity-verification
  // (users.write) permissions are deliberately withheld from zone_manager and
  // support_agent even though both can see the pages that contain them.
  operations_head: [
    "ops.read", "ops.write",
    "pricing.read", "pricing.write",
    "finance.read",
    "withdrawals.read", "withdrawals.write",
    "users.read", "users.write",
    "support.write",
  ],
  zone_head: [
    "ops.read", "ops.write",
    "pricing.read", "pricing.write",
    "finance.read",
    "withdrawals.read", "withdrawals.write",
    "users.read", "users.write",
    "support.write",
  ],
  zone_manager: [
    "ops.read", "ops.write",
    "pricing.read", "pricing.write",
    "withdrawals.read",
    "users.read",
  ],
  driver_onboarding_exec: [
    "users.read", "users.write",
    "vehicles.write",
  ],
  support_agent: [
    "support.write",
    "users.read",
    "ops.read",
  ],
  marketing_exec: [
    "marketing.write",
    "users.read",
  ],
};

// Canonical, correctly-spelled role list for account creation UI. "superadmin"
// (no underscore) matches admins.role/isPrivilegedAdminRole/ADMIN_PERMISSION_MATRIX
// exactly - never use "super_admin" anywhere new.
export const ADMIN_ROLES = [
  "superadmin",
  "operations_head",
  "zone_head",
  "zone_manager",
  "driver_onboarding_exec",
  "support_agent",
  "marketing_exec",
] as const;

export function adminHasPermission(role: string | null | undefined, permission: string): boolean {
  const normalizedRole = String(role || "").toLowerCase();
  const permissions = ADMIN_PERMISSION_MATRIX[normalizedRole] || [];
  return permissions.includes("*") || permissions.includes(permission);
}
