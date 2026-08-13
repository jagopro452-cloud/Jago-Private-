import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), "utf8");

const routesSource = read("server", "routes.ts");
const mappingSource = read("server", "mapping-unified.ts");
const intelligenceSource = read("server", "intelligence.ts");
const aiBrainSource = read("server", "ai-brain.ts");
const socketSource = read("server", "socket.ts");
const driverApiConfigSource = read("flutter_apps", "driver_app", "lib", "config", "api_config.dart");
const driverHeatmapServiceSource = read("flutter_apps", "driver_app", "lib", "services", "heatmap_service.dart");

const occurrences = (source: string, value: string) => source.split(value).length - 1;

describe("ETA API contract evidence", () => {
  it("keeps the legacy contract and exposes real-time ETA on a versioned path", () => {
    const legacy = 'app.get("/api/app/eta", authApp';
    const realtime = 'app.get("/api/app/eta/realtime", authApp';

    expect(occurrences(routesSource, 'app.get("/api/app/eta",')).toBe(1);
    expect(occurrences(routesSource, 'app.get("/api/app/eta/realtime",')).toBe(1);
    expect(routesSource.indexOf(legacy)).toBeGreaterThan(-1);
    expect(routesSource.indexOf(realtime)).toBeGreaterThan(routesSource.indexOf(legacy));
  });

  it("preserves the reachable legacy parameter, status, auth, and response contract", () => {
    expect(routesSource).toContain('const { originLat, originLng, destLat, destLng } = req.query');
    expect(routesSource).toContain('return res.status(400).json({ message: "originLat, originLng, destLat, destLng required" });');
    expect(routesSource).toContain("res.json({ etaMinutes, distanceKm, source });");
    expect(routesSource).toContain("WHERE key_name='google_maps_api_key'");
  });

  it("accepts canonical real-time parameters with backward-compatible aliases", () => {
    expect(routesSource).toContain("const dLat = Number(req.query.originLat ?? req.query.driverLat);");
    expect(routesSource).toContain("const dLng = Number(req.query.originLng ?? req.query.driverLng);");
    expect(routesSource).toContain("const destLat = Number(req.query.destinationLat ?? req.query.destLat);");
    expect(routesSource).toContain("const destLng = Number(req.query.destinationLng ?? req.query.destLng);");
    expect(routesSource).toContain('return res.status(400).json({ message: "Driver and destination coordinates required" });');
    expect(routesSource).toContain("const eta = await getRealTimeETA(dLat, dLng, destLat, destLng);");
    expect(routesSource).toContain("res.json(eta);");
  });

  it("locks the real-time response schema and bounded two-minute cache", () => {
    for (const field of ["etaMinutes: number", "distanceKm: number", "trafficCondition:", "updatedAt: string"]) {
      expect(mappingSource).toContain(field);
    }
    expect(mappingSource).toContain("const etaCache = new SimpleCache<ETAResult>(3000, 2 * 60 * 1000)");
    expect(mappingSource).toContain("const cached = etaCache.get(key);");
    expect(mappingSource).toContain("if (cached) return cached;");
    expect(mappingSource).toContain("etaCache.set(key, result);");
  });
});

describe("Driver heatmap contract evidence", () => {
  it("keeps cached and intelligence heatmaps on distinct authenticated paths", () => {
    const route = 'app.get("/api/app/driver/heatmap", authApp';
    const intelligenceRoute = 'app.get("/api/app/driver/heatmap/intelligence", authApp';
    const first = routesSource.indexOf(route);
    const second = routesSource.indexOf(intelligenceRoute);

    expect(occurrences(routesSource, route)).toBe(1);
    expect(occurrences(routesSource, intelligenceRoute)).toBe(1);
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(routesSource.slice(first, second)).toContain("FROM heatmap_grid_cache");
    expect(routesSource.slice(second)).toContain("const zones = await computeDemandHeatmap();");
  });

  it("locks the current Driver App cached-grid response contract", () => {
    for (const field of [
      "key: z.grid_key",
      "requestCount: parseInt(z.request_count)",
      "activeDrivers: parseInt(z.active_drivers)",
      "demandScore: parseFloat(z.demand_score)",
      "demandLevel: z.demand_level",
      "serviceBreakdown: z.service_breakdown",
      "earningMin: parseInt(z.estimated_earning_min)",
      "earningMax: parseInt(z.estimated_earning_max)",
      "refreshIntervalSeconds:",
    ]) {
      expect(routesSource).toContain(field);
    }
    expect(driverApiConfigSource).toContain("/api/app/driver/heatmap?lat=$lat&lng=$lng&radius=$radius");
    for (const field of ["j['key']", "j['demandLevel']", "j['serviceBreakdown']", "j['earningMin']", "j['earningMax']"]) {
      expect(driverHeatmapServiceSource).toContain(field);
    }
  });

  it("keeps the incompatible AI schema separate and proves its internal consumers", () => {
    for (const field of ["zoneName: z.zoneName", "intensity: z.demandIntensity", "demandRatio: z.demandRatio", "surgeMultiplier: z.surgeMultiplier"]) {
      expect(routesSource).toContain(field);
    }
    expect(routesSource).toContain('app.get("/api/admin/demand-heatmap", requireAdminAuth');
    expect(intelligenceSource).toContain("export async function computeDemandHeatmap");
    expect(intelligenceSource).toContain("const heatmap = await computeDemandHeatmap();");
    expect(aiBrainSource).toContain("heatmapZones = await computeDemandHeatmap();");
    expect(socketSource).toContain("getRebalancingSuggestion");
  });
});
