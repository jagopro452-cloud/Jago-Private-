import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guards for Final Production Hardening (Phase 8: DB indexing;
// Phase 9: security) findings.

const repoRoot = process.cwd();
const routesSource = readFileSync(join(repoRoot, "server", "routes.ts"), "utf8");

describe("Phase 8: parcel_orders driver-scoped queries have supporting indexes", () => {
  it("migration 0014 adds driver_id and (driver_id, current_status) indexes", () => {
    const migrationSql = readFileSync(join(repoRoot, "migrations", "0014_parcel_orders_driver_indexes.sql"), "utf8");
    expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS idx_parcel_orders_driver_id");
    expect(migrationSql).toContain("ON public.parcel_orders (driver_id)");
    expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS idx_parcel_orders_driver_status");
    expect(migrationSql).toContain("ON public.parcel_orders (driver_id, current_status)");
  });
});

describe("Phase 9 P0: safety-alerts IDOR closed", () => {
  it("PATCH /api/app/ai/safety-alerts/:alertId only updates an alert belonging to the requesting user", () => {
    const idx = routesSource.indexOf('app.patch("/api/app/ai/safety-alerts/:alertId"');
    const nextIdx = routesSource.indexOf('app.post("/api/app/ai/sos"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("AND (customer_id = ${user.id}::uuid OR driver_id = ${user.id}::uuid)");
    expect(body).toContain('res.status(404).json({ message: "Safety alert not found" })');
  });

  it("also fixed in the same pass: no longer writes the nonexistent ai_safety_alerts.acknowledged column", () => {
    const idx = routesSource.indexOf('app.patch("/api/app/ai/safety-alerts/:alertId"');
    const nextIdx = routesSource.indexOf('app.post("/api/app/ai/sos"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).not.toMatch(/SET acknowledged/);
    expect(body).toContain("SET resolved = ${resolved}");
  });

  it("GET /api/app/ai/driver-stats/:driverId only allows a driver to view their own stats", () => {
    const idx = routesSource.indexOf('app.get("/api/app/ai/driver-stats/:driverId"');
    const nextIdx = routesSource.indexOf("setInterval(() => {");
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("if (String(driverId) !== String(user.id)) return res.status(403)");
  });
});

describe("Phase 9 P1: admin finance-sensitive deletes require requireFinanceWrite", () => {
  it("DELETE /api/admin/surge-configs/:id is gated by requireFinanceWrite", () => {
    const idx = routesSource.indexOf('app.delete("/api/admin/surge-configs/:id"');
    expect(routesSource.slice(idx, idx + 200)).toContain("requireAdminAuth, requireFinanceWrite");
  });

  it("DELETE /api/admin/franchisees/:id is gated by requireFinanceWrite", () => {
    const idx = routesSource.indexOf('app.delete("/api/admin/franchisees/:id"');
    expect(routesSource.slice(idx, idx + 200)).toContain("requireAdminAuth, requireFinanceWrite");
  });
});

describe("Phase 9 P1: B2B bulk CSV upload has a bounded row count", () => {
  it("rejects uploads over 1000 rows before processing any of them", () => {
    const idx = routesSource.indexOf('app.post("/api/b2b/:companyId/bulk-csv-upload"');
    const nextIdx = idx + 3000;
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("if (csvRows.length > 1000)");
    const capIdx = body.indexOf("csvRows.length > 1000");
    const loopIdx = body.indexOf("for (let i = 0; i < csvRows.length; i++)");
    expect(capIdx).toBeGreaterThan(-1);
    expect(capIdx).toBeLessThan(loopIdx);
  });
});
