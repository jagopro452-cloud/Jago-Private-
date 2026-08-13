import { describe, expect, it } from "vitest";
import { ADMIN_PERMISSION_MATRIX, ADMIN_ROLES, adminHasPermission } from "../../shared/permissions";

// Formalizes the manual role-matrix verification performed during the RBAC
// implementation into a permanent regression guard. This is the SAME file
// server/routes.ts and client/src/pages/admin/layout.tsx import - a change
// here changes production behavior on both sides simultaneously, so any
// unintended drift is caught here before it ships.

const ALL_ROLES = [
  "superadmin", "admin", "finance", "finance_admin", "support",
  "operations_head", "zone_head", "zone_manager",
  "driver_onboarding_exec", "support_agent", "marketing_exec",
];

describe("RBAC permission matrix", () => {
  it("defines every role referenced anywhere in the codebase", () => {
    for (const role of ALL_ROLES) {
      expect(ADMIN_PERMISSION_MATRIX[role], `matrix missing role "${role}"`).toBeDefined();
    }
  });

  it("ADMIN_ROLES (Employee Setup dropdown) uses the correctly-spelled superadmin, never super_admin", () => {
    expect(ADMIN_ROLES).toContain("superadmin");
    expect(ADMIN_ROLES).not.toContain("super_admin");
  });

  it("superadmin has unrestricted access (wildcard)", () => {
    expect(adminHasPermission("superadmin", "admin.write")).toBe(true);
    expect(adminHasPermission("superadmin", "anything.at.all")).toBe(true);
  });

  it("an unknown/empty role has zero permissions", () => {
    expect(adminHasPermission("", "ops.read")).toBe(false);
    expect(adminHasPermission(undefined, "ops.read")).toBe(false);
    expect(adminHasPermission("not_a_real_role", "ops.read")).toBe(false);
  });

  it("role lookups are case-insensitive", () => {
    expect(adminHasPermission("SuperAdmin", "admin.write")).toBe(true);
    expect(adminHasPermission("Operations_Head", "ops.write")).toBe(true);
  });

  describe("Business Authorization Matrix escalation guards", () => {
    it("admin.write (employee/account provisioning) is held ONLY by admin/superadmin", () => {
      for (const role of ALL_ROLES) {
        const expected = role === "admin" || role === "superadmin";
        expect(adminHasPermission(role, "admin.write"), `role "${role}" admin.write`).toBe(expected);
      }
    });

    it("withdrawals.write (money movement) excludes zone_manager", () => {
      expect(adminHasPermission("zone_manager", "withdrawals.write")).toBe(false);
      expect(adminHasPermission("zone_manager", "withdrawals.read")).toBe(true);
    });

    it("withdrawals.write is held by senior ops + finance roles, not junior/unrelated roles", () => {
      for (const role of ["admin", "superadmin", "finance", "finance_admin", "operations_head", "zone_head"]) {
        expect(adminHasPermission(role, "withdrawals.write"), `role "${role}" should hold withdrawals.write`).toBe(true);
      }
      for (const role of ["support", "zone_manager", "driver_onboarding_exec", "support_agent", "marketing_exec"]) {
        expect(adminHasPermission(role, "withdrawals.write"), `role "${role}" should NOT hold withdrawals.write`).toBe(false);
      }
    });

    it("users.write (identity verification) excludes zone_manager and support_agent", () => {
      expect(adminHasPermission("zone_manager", "users.write")).toBe(false);
      expect(adminHasPermission("support_agent", "users.write")).toBe(false);
      expect(adminHasPermission("zone_manager", "users.read")).toBe(true);
      expect(adminHasPermission("support_agent", "users.read")).toBe(true);
    });

    it("users.write is held by the roles whose job is driver/customer verification", () => {
      for (const role of ["admin", "superadmin", "operations_head", "zone_head", "driver_onboarding_exec"]) {
        expect(adminHasPermission(role, "users.write"), `role "${role}" should hold users.write`).toBe(true);
      }
    });

    it("marketing_exec has no operational, financial, or account-provisioning write access", () => {
      for (const permission of ["ops.write", "finance.write", "withdrawals.write", "users.write", "admin.write", "pricing.write"]) {
        expect(adminHasPermission("marketing_exec", permission), `marketing_exec should NOT hold ${permission}`).toBe(false);
      }
      expect(adminHasPermission("marketing_exec", "marketing.write")).toBe(true);
    });

    it("support_agent has no operational or financial write access", () => {
      for (const permission of ["ops.write", "finance.write", "withdrawals.write", "users.write", "pricing.write"]) {
        expect(adminHasPermission("support_agent", permission), `support_agent should NOT hold ${permission}`).toBe(false);
      }
      expect(adminHasPermission("support_agent", "support.write")).toBe(true);
    });

    it("driver_onboarding_exec is scoped to users + vehicles only", () => {
      expect(adminHasPermission("driver_onboarding_exec", "users.write")).toBe(true);
      expect(adminHasPermission("driver_onboarding_exec", "vehicles.write")).toBe(true);
      for (const permission of ["ops.write", "finance.write", "withdrawals.write", "admin.write", "marketing.write"]) {
        expect(adminHasPermission("driver_onboarding_exec", permission), `driver_onboarding_exec should NOT hold ${permission}`).toBe(false);
      }
    });

    it("finance/finance_admin backend-only roles retain withdrawal authority (referral pay/expire moved off finance.write)", () => {
      expect(adminHasPermission("finance", "withdrawals.write")).toBe(true);
      expect(adminHasPermission("finance_admin", "withdrawals.write")).toBe(true);
    });
  });

  describe("Force-cancel-ride role set (High-risk endpoint)", () => {
    const allowed = ["admin", "superadmin", "operations_head", "zone_head", "zone_manager"];
    const denied = ["finance", "finance_admin", "support", "driver_onboarding_exec", "support_agent", "marketing_exec"];

    it.each(allowed)("%s CAN force-cancel a ride", (role) => {
      expect(adminHasPermission(role, "ops.write")).toBe(true);
    });

    it.each(denied)("%s CANNOT force-cancel a ride", (role) => {
      expect(adminHasPermission(role, "ops.write")).toBe(false);
    });
  });

  describe("Withdrawal approve/reject role set (High-risk endpoint)", () => {
    const allowed = ["admin", "superadmin", "finance", "finance_admin", "operations_head", "zone_head"];
    const denied = ["support", "zone_manager", "driver_onboarding_exec", "support_agent", "marketing_exec"];

    it.each(allowed)("%s CAN approve/reject withdrawals", (role) => {
      expect(adminHasPermission(role, "withdrawals.write")).toBe(true);
    });

    it.each(denied)("%s CANNOT approve/reject withdrawals", (role) => {
      expect(adminHasPermission(role, "withdrawals.write")).toBe(false);
    });
  });
});
