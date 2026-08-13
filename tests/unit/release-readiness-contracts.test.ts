import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const routesSource = read("server", "routes.ts");
const socketSource = read("server", "socket.ts");
const indexSource = read("server", "index.ts");
const customerAuthSource = read("flutter_apps", "customer_app", "lib", "services", "auth_service.dart");
const driverAuthSource = read("flutter_apps", "driver_app", "lib", "services", "auth_service.dart");

describe("production client telemetry", () => {
  it("records bounded client version, platform, user-agent, endpoint, and auth state", () => {
    expect(routesSource).toContain('req.get("x-client-version") || req.get("x-app-version")');
    expect(routesSource).toContain('req.get("x-client-platform")');
    expect(routesSource).toContain('req.get("user-agent")');
    expect(routesSource).toContain('authenticated: Boolean((req as any).appUser)');
    for (const endpoint of [
      "/api/app/eta",
      "/api/app/eta/realtime",
      "/api/app/driver/heatmap",
      "/api/app/driver/heatmap/intelligence",
    ]) {
      expect(routesSource).toContain(`recordClientVersionTelemetry(req, "${endpoint}")`);
    }
    expect(customerAuthSource).toContain("'X-Client-Version': '1.0.62+62'");
    expect(customerAuthSource).toContain("'X-Client-Platform': 'android'");
    expect(driverAuthSource).toContain("'X-Client-Version': '1.0.63+63'");
    expect(driverAuthSource).toContain("'X-Client-Platform': 'android'");
  });
});

describe("Socket.IO reconnect and failover guards", () => {
  it("registers driver online handling before awaited bootstrap work", () => {
    const registration = socketSource.indexOf('socket.on("driver:online", handleDriverOnline);');
    const bootstrap = socketSource.indexOf("await disconnectDuplicateUserSockets(userId, socket.id)");
    expect(registration).toBeGreaterThan(-1);
    expect(bootstrap).toBeGreaterThan(registration);
    expect(socketSource).toContain("driverOnlineHandlerMovedEarlier = true");
  });

  it("disconnects superseded sockets and preserves a reconnect grace period", () => {
    expect(socketSource).toContain("candidate.id !== currentSocketId");
    expect(socketSource).toContain("candidate.disconnect(true)");
    expect(socketSource).toContain("const DRIVER_OFFLINE_GRACE_MS = 90_000");
    expect(socketSource).toContain("clearTimeout(pendingTimer)");
    expect(socketSource).toContain("pendingOfflineTimers.delete(userId)");
  });

  it("maintains cross-instance presence and a safe Redis adapter fallback", () => {
    expect(socketSource).toContain('addSocketPresence("driver", userId, socket.id)');
    expect(socketSource).toContain('touchSocketPresence("driver", userId, socket.id)');
    expect(socketSource).toContain('removeSocketPresence("driver", userId, socket.id)');
    expect(indexSource).toContain("socketIo.adapter(createAdapter(pubClient, subClient))");
    expect(indexSource).toContain("Redis unavailable, using in-memory adapter");
  });
});

describe("deprecated module reachability", () => {
  it("keeps the verified deprecated-module inventory explicit", () => {
    const deprecated = [
      "admin-service",
      "coupon-engine",
      "fraud",
      "local-pool-dispatch",
      "qa",
      "surge",
    ];
    for (const moduleName of deprecated) {
      const importableSources = readdirSync(join(root, "server"), { recursive: true })
        .map(String)
        .filter((name) => name.endsWith(".ts") && name.replaceAll("\\", "/") !== `${moduleName}.ts`)
        .map((name) => read("server", name))
        .join("\n");
      expect(importableSources).not.toContain(`from "./${moduleName}"`);
      expect(importableSources).not.toContain(`import("./${moduleName}")`);
    }
  });
});
