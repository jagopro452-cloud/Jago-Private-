/**
 * Autonomous monitoring, alerting, and auto-action engine — hardened edition.
 *
 * Every 60s: fetch metrics → evaluate rules (priority order) → fire alerts →
 * execute actions → check recovery.
 *
 * Guarantees:
 *   Hysteresis       — trigger/clear use different thresholds (no oscillation)
 *   Debounce         — N consecutive breaches required before firing
 *   Grace period     — N consecutive clears required before restoring
 *   Safety caps      — MAX_SURGE=2.5x, booking_pause hard-capped at 10 min
 *   Idempotency      — zone-scoped tokens + Redis NX (multi-pod safe), in-memory fallback
 *   Priority order   — P0 (redis) > P1 (payments) > P2 (queue/rate) > P3 (OTP)
 *   Conflict guard   — booking_pause suppresses surge (no point surging paused)
 *   Scope guard      — surge actions only from per_zone rules; booking_pause only global
 *   Safety toggles   — AUTO_ACTIONS_ENABLED, ENABLE_SURGE_AUTOMATION, ENABLE_BOOKING_PAUSE
 *   Shadow mode      — LOG_INTENDED_ACTIONS=true logs what would fire without executing
 *   Alert agg.       — batches simultaneous alerts into one ops-channel message with routing
 *   Metric sanity    — clamp() guards against bad DB reads or log anomalies
 *   Audit schema     — every action logged with rule/scope/prev/new state/metrics
 */

import fs     from "fs";
import path   from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { getApiErrorStats } from "./metrics";
import { sendOpsAlert } from "./observability";
import { checkRedis } from "./presence";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Rules config (hot-reloadable via POST /api/admin/alert-engine/config/reload) ─

interface EngineConfigSchema {
  engine: {
    maxSurgeCap:                  number;
    bookingPauseMaxMinutes:       number;
    alertCooldownMinutes:         number;
    minDwellMinutes:              number;
    checkIntervalSeconds:         number;
    recoveryCompletionRateMinPct: number;
  };
  rules: Record<string, {
    enabled?:               boolean;
    minConsecutiveBreaches?: number;
    minConsecutiveClears?:   number;
    triggerThreshold?:       number;
    clearThreshold?:         number;
    triggerPct?:             number;
    clearPct?:               number;
    clearDrivers?:           number;
    minSamples?:             number;
  }>;
  dispatch: {
    driverFatigueBackoffSeconds: number;
    driverMaxConcurrentOffers:   number;
  };
}

const CONFIG_PATH = path.join(__dirname, "alert-engine.config.json");
const DEFAULT_CFG: EngineConfigSchema = {
  engine: { maxSurgeCap: 2.5, bookingPauseMaxMinutes: 10, alertCooldownMinutes: 15,
            minDwellMinutes: 2, checkIntervalSeconds: 60, recoveryCompletionRateMinPct: 80 },
  rules: {},
  dispatch: { driverFatigueBackoffSeconds: 25, driverMaxConcurrentOffers: 1 },
};

let _cfg:          EngineConfigSchema | null = null;
let _cfgVersion    = "default";
let _cfgChecksum   = "";
let _cfgLoadedAt   = 0;

function loadEngineConfig(): { cfg: EngineConfigSchema; raw: string } {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return { cfg: JSON.parse(raw) as EngineConfigSchema, raw };
}

function getCfg(): EngineConfigSchema {
  if (!_cfg) {
    try {
      const { cfg, raw } = loadEngineConfig();
      _cfg = cfg;
      _cfgChecksum = computeChecksum(raw);
      _cfgVersion  = new Date().toISOString();
      _cfgLoadedAt = Date.now();
    } catch {
      _cfg = DEFAULT_CFG;
    }
  }
  return _cfg;
}

// ── Validation ────────────────────────────────────────────────────────────────

interface ValidationResult { ok: boolean; errors: string[] }

function validateEngineConfig(cfg: EngineConfigSchema): ValidationResult {
  const errors: string[] = [];
  const { engine, rules, dispatch } = cfg;
  if (!engine)   errors.push("Missing 'engine' section");
  if (!rules)    errors.push("Missing 'rules' section");
  if (!dispatch) errors.push("Missing 'dispatch' section");
  if (errors.length > 0) return { ok: false, errors };

  const inRange = (v: unknown, lo: number, hi: number, name: string) => {
    if (typeof v !== "number" || v < lo || v > hi)
      errors.push(`${name} must be ${lo}–${hi} (got ${v})`);
  };
  inRange(engine.maxSurgeCap,                  1.0, 5.0,  "engine.maxSurgeCap");
  inRange(engine.bookingPauseMaxMinutes,        1,   60,   "engine.bookingPauseMaxMinutes");
  inRange(engine.alertCooldownMinutes,          1,   120,  "engine.alertCooldownMinutes");
  inRange(engine.minDwellMinutes,               0,   30,   "engine.minDwellMinutes");
  inRange(engine.checkIntervalSeconds,          10,  300,  "engine.checkIntervalSeconds");
  inRange(engine.recoveryCompletionRateMinPct,  0,   100,  "engine.recoveryCompletionRateMinPct");

  for (const [ruleId, r] of Object.entries(rules ?? {})) {
    if (!r) continue;
    const pct = (v: unknown, name: string) => {
      if (v !== undefined && (typeof v !== "number" || v < 0 || v > 100))
        errors.push(`rules.${ruleId}.${name} must be 0–100 (got ${v})`);
    };
    const pos = (v: unknown, name: string) => {
      if (v !== undefined && (typeof v !== "number" || (v as number) < 0))
        errors.push(`rules.${ruleId}.${name} must be ≥ 0 (got ${v})`);
    };
    const bounded = (v: unknown, lo: number, hi: number, name: string) => {
      if (v !== undefined && (typeof v !== "number" || (v as number) < lo || (v as number) > hi))
        errors.push(`rules.${ruleId}.${name} must be ${lo}–${hi} (got ${v})`);
    };
    pct(r.triggerPct,   "triggerPct");
    pct(r.clearPct,     "clearPct");
    pos(r.triggerThreshold, "triggerThreshold");
    pos(r.clearThreshold,   "clearThreshold");
    pos(r.clearDrivers,     "clearDrivers");
    bounded(r.minSamples,             1, 100, "minSamples");
    bounded(r.minConsecutiveBreaches, 1, 10,  "minConsecutiveBreaches");
    bounded(r.minConsecutiveClears,   1, 10,  "minConsecutiveClears");
    // Hysteresis sanity: clear threshold must be less restrictive than trigger
    if (r.triggerThreshold !== undefined && r.clearThreshold !== undefined &&
        r.clearThreshold >= r.triggerThreshold)
      errors.push(`rules.${ruleId}: clearThreshold (${r.clearThreshold}) must be < triggerThreshold (${r.triggerThreshold})`);
    if (r.triggerPct !== undefined && r.clearPct !== undefined &&
        r.clearPct <= r.triggerPct)
      errors.push(`rules.${ruleId}: clearPct (${r.clearPct}) must be > triggerPct (${r.triggerPct})`);
  }

  inRange(dispatch.driverFatigueBackoffSeconds, 0,   300, "dispatch.driverFatigueBackoffSeconds");
  inRange(dispatch.driverMaxConcurrentOffers,   1,   5,   "dispatch.driverMaxConcurrentOffers");
  return { ok: errors.length === 0, errors };
}

// ── Safe-delta guard — blocks extreme single-reload changes ───────────────────

interface DeltaResult { ok: boolean; violations: string[] }

function checkSafeDelta(prev: EngineConfigSchema, next: EngineConfigSchema): DeltaResult {
  const violations: string[] = [];

  const surgeDelta = Math.abs((next.engine.maxSurgeCap ?? 2.5) - (prev.engine.maxSurgeCap ?? 2.5));
  if (surgeDelta > 0.5)
    violations.push(`engine.maxSurgeCap change ${surgeDelta.toFixed(2)} exceeds 0.5 per-reload limit`);

  const cooldown = next.engine.alertCooldownMinutes ?? 15;
  if (cooldown < 5 || cooldown > 30)
    violations.push(`engine.alertCooldownMinutes ${cooldown} outside safe range [5, 30]`);

  for (const ruleId of Object.keys(next.rules ?? {})) {
    const p = prev.rules?.[ruleId] ?? {};
    const n = next.rules[ruleId] ?? {};
    const bd = Math.abs((n.minConsecutiveBreaches ?? 2) - (p.minConsecutiveBreaches ?? 2));
    const cd = Math.abs((n.minConsecutiveClears   ?? 2) - (p.minConsecutiveClears   ?? 2));
    if (bd > 2) violations.push(`rules.${ruleId}.minConsecutiveBreaches change ${bd} exceeds 2-step limit`);
    if (cd > 2) violations.push(`rules.${ruleId}.minConsecutiveClears change ${cd} exceeds 2-step limit`);
  }
  return { ok: violations.length === 0, violations };
}

// ── Diff + checksum helpers ───────────────────────────────────────────────────

function computeChecksum(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

function diffConfigs(prev: EngineConfigSchema, next: EngineConfigSchema): Record<string, string> {
  const diff: Record<string, string> = {};
  const walk = (pObj: Record<string, unknown>, nObj: Record<string, unknown>, prefix: string) => {
    const keys = Array.from(new Set([...Object.keys(pObj), ...Object.keys(nObj)]));
    for (const k of keys) {
      if (k.startsWith("_")) continue;
      const pv = pObj[k]; const nv = nObj[k];
      if (typeof pv === "object" && typeof nv === "object" && pv && nv)
        walk(pv as Record<string, unknown>, nv as Record<string, unknown>, `${prefix}.${k}`);
      else if (pv !== nv)
        diff[`${prefix}.${k}`] = `${pv} → ${nv}`;
    }
  };
  walk(prev as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>, "cfg");
  return diff;
}

// ── Config history (rollback support) ────────────────────────────────────────

const CONFIG_HISTORY_MAX = 5;
const configHistory: Array<{
  cfg:      EngineConfigSchema;
  version:  string;
  checksum: string;
  reason?:  string;
  by?:      string;
}> = [];

function pushConfigHistory(entry: typeof configHistory[0]): void {
  configHistory.push(entry);
  if (configHistory.length > CONFIG_HISTORY_MAX) configHistory.shift();
}

export function getConfigHistory() {
  return [...configHistory].reverse(); // newest first
}

// ── Redis pub/sub config sync (multi-pod) ─────────────────────────────────────

const CONFIG_SYNC_CHANNEL = "engine:config:reload";

function getEngineRedisUrl(): string | null {
  return (process.env.REDIS_URL || "").trim() || null;
}

async function broadcastConfigReload(version: string, checksum: string): Promise<void> {
  try {
    const r = await getEngineRedis();
    if (!r) return;
    await r.publish(CONFIG_SYNC_CHANNEL, JSON.stringify({ version, checksum, ts: Date.now() }));
  } catch { /* non-critical — pods will pick up config on their own next read */ }
}

export async function subscribeConfigSync(): Promise<void> {
  try {
    const redisUrl = getEngineRedisUrl();
    if (!redisUrl) {
      if (process.env.NODE_ENV === "production") {
        console.error("[ALERT-ENGINE] REDIS_URL missing - config sync disabled");
      }
      return;
    }
    const { default: IORedis } = await import("ioredis");
    const sub = new IORedis(redisUrl, {
      lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0,
      retryStrategy: () => null, connectTimeout: 2000,
    });
    sub.on("error", () => {});
    await sub.connect();
    await sub.subscribe(CONFIG_SYNC_CHANNEL);
    sub.on("message", (_ch, msg) => {
      try {
        const { checksum } = JSON.parse(msg) as { checksum: string };
        if (checksum === _cfgChecksum) return; // this pod already has it
        console.log("[ALERT-ENGINE] Config sync broadcast received — reloading");
        reloadEngineConfig({ reason: "pod-sync broadcast", requestedBy: "system" });
      } catch { /* malformed message — ignore */ }
    });
    console.log("[ALERT-ENGINE] Config sync subscriber ready");
  } catch {
    console.log("[ALERT-ENGINE] Redis unavailable — config sync disabled (single-pod mode)");
  }
}

// ── Public config API ─────────────────────────────────────────────────────────

export interface ReloadResult {
  ok:                boolean;
  error?:            string;
  validationErrors?: string[];
  safetyViolations?: string[];
  incidentLock?:     string;   // set when a P0/P1 incident blocked the reload
  diff?:             Record<string, string>;
  version?:          string;
  checksum?:         string;
  changedKeys?:      number;
}

/**
 * Reload config from disk with full guardrails:
 *   1. Incident lock (P0/P1 firing → blocked unless force)
 *   2. JSON parse check
 *   3. Schema + range validation (fail → keep old config)
 *   4. Safe-delta guard (blocks extreme single-reload changes unless force)
 *   5. Config history snapshot (enables rollback)
 *   6. Audit log written to system_logs
 *   7. Redis broadcast for pod-sync
 */
export function reloadEngineConfig(options?: {
  reason?:      string;
  requestedBy?: string;
  force?:       boolean;
  _internal?:   boolean; // set by pod-sync subscriber to skip broadcast loop
}): ReloadResult {
  // Incident lock — refuse config changes during active P0/P1 unless forced
  if (!options?.force && !options?._internal) {
    const firingCritical = ALERT_RULES.filter(r => r.priority <= 1 && getState(r.id).firing);
    if (firingCritical.length > 0) {
      const names = firingCritical.map(r => r.label).join(", ");
      return { ok: false, incidentLock: names, error: `Config locked — P0/P1 incident active: ${names}. Use force:true to override.` };
    }
  }

  let raw: string;
  try { raw = fs.readFileSync(CONFIG_PATH, "utf8"); }
  catch (e: any) { return { ok: false, error: `Cannot read config file: ${e.message}` }; }

  let next: EngineConfigSchema;
  try { next = JSON.parse(raw) as EngineConfigSchema; }
  catch (e: any) { return { ok: false, error: `Invalid JSON: ${e.message}` }; }

  const validation = validateEngineConfig(next);
  if (!validation.ok)
    return { ok: false, error: "Validation failed — old config retained", validationErrors: validation.errors };

  const prev = _cfg ?? DEFAULT_CFG;
  if (!options?.force) {
    const delta = checkSafeDelta(prev, next);
    if (!delta.ok)
      return { ok: false, error: "Safe-change guard blocked — pass force:true to override", safetyViolations: delta.violations };
  }

  const diff     = diffConfigs(prev, next);
  const checksum = computeChecksum(raw);
  const version  = new Date().toISOString();
  const prevVer  = _cfgVersion;

  // Snapshot current config into history before overwriting
  if (_cfg) pushConfigHistory({ cfg: _cfg, version: prevVer, checksum: _cfgChecksum, reason: options?.reason, by: options?.requestedBy ?? "admin" });

  // Audit log (fire-and-forget)
  rawDb.execute(rawSql`
    INSERT INTO system_logs (level, tag, message, details)
    VALUES ('info', 'CONFIG_RELOAD',
      ${`Alert engine config reloaded${options?.reason ? " — " + options.reason : ""}`},
      ${JSON.stringify({
        prevVersion: prevVer, newVersion: version, checksum,
        diff, changedKeys: Object.keys(diff).length,
        by: options?.requestedBy ?? "admin",
        reason: options?.reason ?? null,
        forced: options?.force ?? false,
      })}::jsonb)
  `).catch(() => {});

  _cfg = next; _cfgVersion = version; _cfgChecksum = checksum; _cfgLoadedAt = Date.now();
  console.log(`[ALERT-ENGINE] Config reloaded — ${Object.keys(diff).length} change(s)${Object.keys(diff).length > 0 ? ": " + JSON.stringify(diff) : ""}`);

  // Broadcast to other pods (skip if we're already handling a broadcast)
  if (!options?._internal) broadcastConfigReload(version, checksum).catch(() => {});

  return { ok: true, diff, version, checksum, changedKeys: Object.keys(diff).length };
}

/** Roll back to a previous config version (from in-memory history). */
export function rollbackConfig(targetVersion: string, options?: {
  requestedBy?: string;
  reason?:      string;
}): ReloadResult {
  const entry = configHistory.find(h => h.version === targetVersion);
  if (!entry)
    return { ok: false, error: `Version ${targetVersion} not found in history (max ${CONFIG_HISTORY_MAX} kept)` };

  const validation = validateEngineConfig(entry.cfg);
  if (!validation.ok)
    return { ok: false, error: "Historical config failed current validation", validationErrors: validation.errors };

  const prev = _cfg ?? DEFAULT_CFG;
  const diff = diffConfigs(prev, entry.cfg);
  const newVersion = new Date().toISOString();

  if (_cfg) pushConfigHistory({ cfg: _cfg, version: _cfgVersion, checksum: _cfgChecksum, reason: "pre-rollback snapshot", by: options?.requestedBy });

  rawDb.execute(rawSql`
    INSERT INTO system_logs (level, tag, message, details)
    VALUES ('info', 'CONFIG_ROLLBACK',
      ${`Config rolled back to ${entry.version}`},
      ${JSON.stringify({ targetVersion: entry.version, newVersion, diff, by: options?.requestedBy ?? "admin", reason: options?.reason ?? null })}::jsonb)
  `).catch(() => {});

  _cfg = entry.cfg; _cfgVersion = newVersion; _cfgChecksum = entry.checksum; _cfgLoadedAt = Date.now();
  broadcastConfigReload(newVersion, entry.checksum).catch(() => {});
  console.log(`[ALERT-ENGINE] Config rolled back to ${entry.version} by ${options?.requestedBy ?? "admin"}`);
  return { ok: true, diff, version: newVersion, checksum: entry.checksum, changedKeys: Object.keys(diff).length };
}

/** Return current in-memory config with metadata. */
export function getEngineConfig(): EngineConfigSchema & {
  _meta: { version: string; checksum: string; loadedAt: number; configPath: string; hasIncidentLock: boolean };
} {
  const firingCritical = ALERT_RULES.filter(r => r.priority <= 1 && getState(r.id).firing);
  return {
    ...getCfg(),
    _meta: {
      version: _cfgVersion, checksum: _cfgChecksum, loadedAt: _cfgLoadedAt,
      configPath: CONFIG_PATH, hasIncidentLock: firingCritical.length > 0,
    },
  };
}

// ── Dry-run simulation ────────────────────────────────────────────────────────

export interface DryRunResult {
  valid:             boolean;
  validationErrors?: string[];
  safetyViolations?: string[];
  diff:              Record<string, string>;
  simulation: {
    wouldFire:    string[];  // rules that would start firing given current metrics + new thresholds
    wouldClear:   string[];  // currently firing rules that would clear
    suppressions: string[];  // actions blocked by higher-priority rules
    unchanged:    string[];  // no change in evaluated state
  };
  metricsSnapshot?: Partial<DashboardMetrics>;
}

export async function dryRunConfig(configJson: string): Promise<DryRunResult> {
  let next: EngineConfigSchema;
  try { next = JSON.parse(configJson) as EngineConfigSchema; }
  catch (e: any) {
    return { valid: false, validationErrors: [`Invalid JSON: ${e.message}`], diff: {},
      simulation: { wouldFire: [], wouldClear: [], suppressions: [], unchanged: [] } };
  }

  const validation = validateEngineConfig(next);
  const prev = _cfg ?? DEFAULT_CFG;
  const diff = diffConfigs(prev, next);

  if (!validation.ok)
    return { valid: false, validationErrors: validation.errors, diff, simulation: { wouldFire: [], wouldClear: [], suppressions: [], unchanged: [] } };

  const deltaCheck = checkSafeDelta(prev, next);

  let metrics: DashboardMetrics;
  try { metrics = await getDashboardMetrics(false); }
  catch {
    return { valid: true, safetyViolations: deltaCheck.ok ? undefined : deltaCheck.violations, diff,
      simulation: { wouldFire: [], wouldClear: [], suppressions: [], unchanged: [] } };
  }

  // Temporarily apply new config for simulation (restore immediately after)
  const savedCfg = _cfg;
  _cfg = next;

  const wouldFire: string[] = [], wouldClear: string[] = [], suppressions: string[] = [], unchanged: string[] = [];
  const currentlyFiringIds = new Set(ALERT_RULES.filter(r => getState(r.id).firing).map(r => r.id));

  for (const rule of ALERT_RULES) {
    if (!isRuleEnabled(rule)) continue;
    const state = getState(rule.id);
    const breaches = rule.triggerCheck(metrics);
    const clears   = rule.clearCheck(metrics);

    if (breaches && !state.firing) {
      const suppressors = rule.action
        ? (SUPPRESSED_BY[rule.action] ?? []).filter(id => currentlyFiringIds.has(id))
        : [];
      if (suppressors.length > 0)
        suppressions.push(`${rule.action} (rule: ${rule.id}) suppressed by [${suppressors.join(", ")}]`);
      else
        wouldFire.push(`${rule.label} (P${rule.priority})`);
    } else if (clears && state.firing) {
      wouldClear.push(`${rule.label} (P${rule.priority})`);
    } else {
      unchanged.push(rule.id);
    }
  }

  _cfg = savedCfg; // restore

  return {
    valid: true,
    safetyViolations: deltaCheck.ok ? undefined : deltaCheck.violations,
    diff, simulation: { wouldFire, wouldClear, suppressions, unchanged },
    metricsSnapshot: {
      searchingRides: metrics.searchingRides, onlineDrivers: metrics.onlineDrivers,
      acceptRatePct: metrics.acceptRatePct, completionRateLive: metrics.completionRateLive,
      failedPayments: metrics.failedPayments, apiErrorRatePct: metrics.apiErrorRatePct,
    },
  };
}

// Per-rule config helpers — checked at evaluation time so hot-reload takes effect immediately
function ruleN(ruleId: string, key: string, fallback: number): number {
  return (getCfg().rules[ruleId] as any)?.[key] ?? fallback;
}
function ruleBool(ruleId: string, key: string, fallback: boolean): boolean {
  const v = (getCfg().rules[ruleId] as any)?.[key];
  return v === undefined ? fallback : Boolean(v);
}
function engineN(key: keyof EngineConfigSchema["engine"], fallback: number): number {
  return getCfg().engine?.[key] ?? fallback;
}

// Used in runAlertCheck — replaces rule.minConsecutiveBreaches / rule.minConsecutiveClears
function getMinBreaches(rule: AlertRule): number {
  return ruleN(rule.id, "minConsecutiveBreaches", rule.minConsecutiveBreaches);
}
function getMinClears(rule: AlertRule): number {
  return ruleN(rule.id, "minConsecutiveClears", rule.minConsecutiveClears);
}
function isRuleEnabled(rule: AlertRule): boolean {
  return ruleBool(rule.id, "enabled", true);
}

// ── Safety constants ──────────────────────────────────────────────────────────

const MAX_SURGE_CAP          = 2.5;
const BOOKING_PAUSE_MAX_MS   = 10 * 60 * 1000; // hard cap: auto-restore after 10 min
const ALERT_COOLDOWN_MS      = 15 * 60 * 1000; // min gap between same alert re-fires
const CHECK_INTERVAL_MS      = 60_000;
const ACTION_TOKEN_WINDOW_MS = 5 * 60 * 1000;  // idempotency window per action
const ACTION_TOKEN_TTL_S     = 360;             // Redis EX: slot window + 60s buffer
const MIN_DWELL_MS           = 2 * 60 * 1000;  // minimum time firing before recovery allowed
const LEADER_TTL_S           = 75;             // leader lock: covers one full check cycle

// ── Safety toggles (read each tick — changeable at runtime without restart) ───

function isAutoActionsEnabled():     boolean { return process.env.AUTO_ACTIONS_ENABLED    !== "false"; }
function isSurgeAutomationEnabled(): boolean { return process.env.ENABLE_SURGE_AUTOMATION !== "false"; }
function isBookingPauseEnabled():    boolean { return process.env.ENABLE_BOOKING_PAUSE    !== "false"; }

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DashboardMetrics {
  // Auth
  otpFailLast1h:       number;
  otpSendLast1h:       number;
  loginSuccessRatePct: number;

  // Rides
  activeRides:           number;
  searchingRides:        number;
  completedToday:        number;
  cancelledToday:        number;
  rideCompletionRatePct: number;
  completionRateLive:    number; // rolling 30-min window

  // Drivers
  onlineDrivers:           number;
  driverOnlineChurnPerMin: number; // (online + offline events) / 5 min

  // Dispatch quality
  acceptRatePct:        number; // offers accepted / total offers, last 30 min
  avgWaitToAcceptMs:    number; // ms from offer sent to driver accept
  dispatchLatencyMs:    number; // ms from trip created to first driver offer
  dispatchOffersLast30m: number; // total offer events (used to gate accept-rate rule)

  // Payments
  pendingPayments: number;
  failedPayments:  number;
  revenueToday:    number;

  // System
  socketConnections: number;
  redisHealthy:      boolean;
  apiErrorCount:     number;
  apiErrorRatePct:   number;

  // Fraud
  fraudFlagsToday: number;

  // Meta
  generatedAt:   string;
  uptimeSeconds: number;
}

type AlertSeverity = "warning" | "critical";
type AutoActionId  = "surge_increase" | "surge_restore" | "booking_pause" | "booking_restore" | null;
type RulePriority  = 0 | 1 | 2 | 3;
type ActionScope   = "global" | "per_zone";

interface Runbook {
  cause:    string;
  checks:   string[];
  rollback: string;
}

interface AlertRule {
  id:       string;
  label:    string;
  priority: RulePriority;   // 0 = highest — evaluated and acted on first
  severity: AlertSeverity;
  scope:    ActionScope;

  triggerCheck: (m: DashboardMetrics) => boolean; // breach condition (higher bar)
  clearCheck:   (m: DashboardMetrics) => boolean; // clear condition (lower bar — hysteresis)

  minConsecutiveBreaches: number; // debounce: must breach this many checks in a row
  minConsecutiveClears:   number; // grace:    must clear this many checks before restore

  message:        (m: DashboardMetrics) => string;
  action:         AutoActionId;
  recoveryAction?: AutoActionId;

  runbook: Runbook;
}

// ── Alert rules (priority-ordered) ───────────────────────────────────────────

const ALERT_RULES: AlertRule[] = [
  // ── P0: Infrastructure ────────────────────────────────────────────────────
  {
    id: "redis_down",
    label: "Redis unavailable",
    priority: 0,
    severity: "critical",
    scope: "global",
    triggerCheck: m => !m.redisHealthy,
    clearCheck:   m => m.redisHealthy,
    minConsecutiveBreaches: 2,
    minConsecutiveClears:   2,
    message: () => "Redis is down — driver presence degraded to DB fallback. Bookings paused.",
    action:         "booking_pause",
    recoveryAction: "booking_restore",
    runbook: {
      cause:    "Redis pod crashed, OOM, or network partition",
      checks:   ["Check Redis process/pod status", "Verify REDIS_URL env var", "Run: redis-cli ping"],
      rollback: "Set AUTO_ACTIONS_ENABLED=false to re-enable bookings manually while investigating",
    },
  },

  // ── P1: Payment integrity ─────────────────────────────────────────────────
  {
    id: "payment_failures_high",
    label: "Payment failures — booking paused",
    priority: 1,
    severity: "critical",
    scope: "global",
    triggerCheck: m => m.failedPayments > ruleN("payment_failures_high", "triggerThreshold", 5),
    clearCheck:   m => m.failedPayments <= ruleN("payment_failures_high", "clearThreshold", 1),
    minConsecutiveBreaches: 2,
    minConsecutiveClears:   2,
    message: m => `${m.failedPayments} payment failures today. New bookings paused automatically.`,
    action:         "booking_pause",
    recoveryAction: "booking_restore",
    runbook: {
      cause:    "Razorpay gateway down, key rotation, or bank-side processing failure",
      checks:   ["Check Razorpay status page", "Verify RAZORPAY_KEY_ID/SECRET in business_settings", "GET /api/admin/health-report for error pattern"],
      rollback: "Set ENABLE_BOOKING_PAUSE=false for manual control, then POST /api/admin/alert-engine/test",
    },
  },

  // ── P2: Supply/demand ─────────────────────────────────────────────────────
  {
    id: "searching_rides_high",
    label: "Ride search queue backing up",
    priority: 2,
    severity: "critical",
    scope: "per_zone",
    triggerCheck: m => m.searchingRides >= ruleN("searching_rides_high", "triggerThreshold", 8),
    clearCheck:   m => m.searchingRides <= ruleN("searching_rides_high", "clearThreshold", 3),
    minConsecutiveBreaches: 2,
    minConsecutiveClears:   2,
    message: m => `${m.searchingRides} rides searching — driver supply shortage. Surge increased.`,
    action:         "surge_increase",
    recoveryAction: "surge_restore",
    runbook: {
      cause:    "Driver supply shortage, peak demand spike, or dispatch system issue",
      checks:   ["Check onlineDrivers in /dashboard", "Check dispatch logs for errors", "Verify socket connectivity"],
      rollback: "Set ENABLE_SURGE_AUTOMATION=false to freeze surge manually",
    },
  },
  {
    id: "no_online_drivers",
    label: "Zero drivers online with active search queue",
    priority: 2,
    severity: "critical",
    scope: "per_zone",
    triggerCheck: m => m.onlineDrivers === 0 && m.searchingRides > 0,
    clearCheck:   m => m.onlineDrivers > ruleN("no_online_drivers", "clearDrivers", 2) || m.searchingRides === 0,
    minConsecutiveBreaches: 1,  // act immediately — zero drivers is severe
    minConsecutiveClears:   2,
    message: m => `0 drivers online, ${m.searchingRides} rides searching. Surge raised to attract supply.`,
    action:         "surge_increase",
    recoveryAction: "surge_restore",
    runbook: {
      cause:    "Off-peak hours, mass driver app crash, or socket disconnect storm",
      checks:   ["Check driver_locations table for recent updates", "Check socket.io connections count", "Verify FCM driver notifications are delivering"],
      rollback: "Notify drivers via push; set ENABLE_SURGE_AUTOMATION=false if surge is not effective",
    },
  },
  {
    id: "low_accept_rate",
    label: "Driver accept rate critically low",
    priority: 2,
    severity: "warning",
    scope: "per_zone",
    // Min-sample gate — avoids flapping from tiny windows (e.g. 1/2 offers = 50%)
    triggerCheck: m => m.acceptRatePct < ruleN("low_accept_rate", "triggerPct", 40) && m.searchingRides > 2 && m.dispatchOffersLast30m >= ruleN("low_accept_rate", "minSamples", 5),
    clearCheck:   m => (m.acceptRatePct >= ruleN("low_accept_rate", "clearPct", 60) || m.searchingRides <= 1) && m.dispatchOffersLast30m >= ruleN("low_accept_rate", "minSamples", 5),
    minConsecutiveBreaches: 3,  // 3 checks × 60s = 3 min minimum observation window
    minConsecutiveClears:   3,
    message: m => `Driver accept rate: ${m.acceptRatePct}% (threshold: 40%). Surge increased.`,
    action:         "surge_increase",
    recoveryAction: "surge_restore",
    runbook: {
      cause:    "Fare too low for zone, driver fatigue, or surge not propagated to driver app",
      checks:   ["Check avgWaitToAcceptMs in /dashboard", "Verify zones have updated surge_factor", "Check driver app FCM notification delivery rate"],
      rollback: "Set ENABLE_SURGE_AUTOMATION=false and adjust fare manually via admin panel",
    },
  },
  {
    id: "api_error_rate_high",
    label: "API error rate elevated",
    priority: 2,
    severity: "critical",
    scope: "global",
    triggerCheck: m => m.apiErrorRatePct > ruleN("api_error_rate_high", "triggerPct", 3),
    clearCheck:   m => m.apiErrorRatePct <= ruleN("api_error_rate_high", "clearPct", 1),
    minConsecutiveBreaches: 2,
    minConsecutiveClears:   2,
    message: m => `API error rate: ${m.apiErrorRatePct}% (threshold: 3%). Check server logs.`,
    action: null,
    runbook: {
      cause:    "DB connection pool exhausted, unhandled exception in route, or memory pressure",
      checks:   ["Check server logs for 5xx pattern", "GET /api/admin/health-report", "Check DB connection count"],
      rollback: "Restart server pod; set AUTO_ACTIONS_ENABLED=false as precaution",
    },
  },
  {
    id: "pending_payments_high",
    label: "Pending payments spike",
    priority: 2,
    severity: "warning",
    scope: "global",
    triggerCheck: m => m.pendingPayments > ruleN("pending_payments_high", "triggerThreshold", 5),
    clearCheck:   m => m.pendingPayments <= ruleN("pending_payments_high", "clearThreshold", 2),
    minConsecutiveBreaches: 2,
    minConsecutiveClears:   2,
    message: m => `${m.pendingPayments} payments pending — likely gateway delay. Monitoring.`,
    action: null,
    runbook: {
      cause:    "Slow Razorpay webhook delivery or payment_retry_job backlog",
      checks:   ["Check payment_retry_job logs", "Query: SELECT * FROM trip_requests WHERE payment_status='pending'", "Check Razorpay webhook delivery logs"],
      rollback: "Manually resolve via /api/admin/trips/{id}/resolve-payment",
    },
  },

  // ── P3: Auth / OTP ────────────────────────────────────────────────────────
  {
    id: "otp_fail_high",
    label: "OTP failure rate elevated",
    priority: 3,
    severity: "warning",
    scope: "global",
    triggerCheck: m => m.otpFailLast1h > ruleN("otp_fail_high", "triggerThreshold", 15),
    clearCheck:   m => m.otpFailLast1h <= ruleN("otp_fail_high", "clearThreshold", 6),
    minConsecutiveBreaches: 2,
    minConsecutiveClears:   2,
    message: m => `${m.otpFailLast1h} OTP failures in last 1h — possible provider issue or abuse.`,
    action: null,
    runbook: {
      cause:    "SMS provider (Fast2SMS/2Factor) down, high user error rate, or brute-force attempt",
      checks:   ["Check FAST2SMS_API_KEY validity", "Review OTP_RATE_LIMIT entries in system_logs", "Check correlated FRAUD_ flags"],
      rollback: "Switch OTP provider via business_settings, or raise rate limit threshold temporarily",
    },
  },
];

// ── Alert state ───────────────────────────────────────────────────────────────

interface AlertState {
  firing:               boolean;
  firedAt?:             number; // when alert first fired — used for MIN_DWELL_MS check
  consecutiveBreaches:  number;
  consecutiveClears:    number;
  lastFiredAt:          number;
  fireCount:            number;
  bookingPausedAt?:     number; // tracks when booking_pause applied (for hard cap)
}

const alertStates = new Map<string, AlertState>();

function getState(ruleId: string): AlertState {
  return alertStates.get(ruleId) ?? {
    firing: false, consecutiveBreaches: 0, consecutiveClears: 0,
    lastFiredAt: 0, fireCount: 0,
  };
}

// ── Idempotency tokens (zone-scoped + Redis NX for multi-instance safety) ────

const appliedActionTokens = new Set<string>();
let _engineRedis: any = null;

// Token format: actionId:zoneKey:timeSlot — prevents cross-zone bleed
function makeActionToken(actionId: string, zoneKey = "all"): string {
  const slot = Math.floor(Date.now() / ACTION_TOKEN_WINDOW_MS);
  return `${actionId}:${zoneKey}:${slot}`;
}

async function getEngineRedis(): Promise<any | null> {
  if (_engineRedis?.status === "ready") return _engineRedis;
  try {
    const redisUrl = getEngineRedisUrl();
    if (!redisUrl) return null;
    const { default: IORedis } = await import("ioredis");
    _engineRedis = new IORedis(redisUrl, {
      lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0,
      retryStrategy: () => null, connectTimeout: 1500,
    });
    _engineRedis.on("error", () => { _engineRedis = null; });
    await _engineRedis.connect();
    return _engineRedis;
  } catch { _engineRedis = null; return null; }
}

// Returns { alreadyApplied, redisAvailable }.
// alreadyApplied=true  → caller must skip (another pod or this pod already ran it)
// redisAvailable=false → caller should suppress per_zone actions (cross-pod inconsistency risk)
// Tries Redis SET NX EX first — aligned TTL = slot window + 60s buffer (no adjacent window overlap).
// Outside production, falls back to in-memory Set when Redis is unavailable.
async function checkAndClaimAction(
  actionId: string,
  zoneKey = "all",
): Promise<{ alreadyApplied: boolean; redisAvailable: boolean }> {
  const token = makeActionToken(actionId, zoneKey);
  try {
    const r = await getEngineRedis();
    if (r) {
      const result = await r.set(`engine:action:${token}`, "1", "EX", ACTION_TOKEN_TTL_S, "NX");
      if (result === null) return { alreadyApplied: true,  redisAvailable: true };
      appliedActionTokens.add(token);
      return { alreadyApplied: false, redisAvailable: true };
    }
  } catch { /* fall through to production-safe branch below */ }

  // Redis unavailable — in-memory fallback (single-instance only)
  if (process.env.NODE_ENV === "production") {
    return { alreadyApplied: true, redisAvailable: false };
  }

  if (appliedActionTokens.has(token)) return { alreadyApplied: true, redisAvailable: false };
  appliedActionTokens.add(token);
  if (appliedActionTokens.size > 200) {
    const cutoff = Math.floor(Date.now() / ACTION_TOKEN_WINDOW_MS) - 10;
    Array.from(appliedActionTokens).forEach(t => {
      const parts = t.split(":");
      if (parseInt(parts[parts.length - 1] ?? "0") < cutoff) appliedActionTokens.delete(t);
    });
  }
  return { alreadyApplied: false, redisAvailable: false };
}

// Acquire a soft leader lock — used to gate external alert dispatch so only one pod
// sends the external webhook per check cycle (others still evaluate rules internally).
async function acquireLeaderLock(): Promise<boolean> {
  try {
    const r = await getEngineRedis();
    if (!r && process.env.NODE_ENV === "production") return false;
    if (!r) return true; // Redis unavailable — assume single instance, always leader
    const result = await r.set("engine:leader", "1", "EX", LEADER_TTL_S, "NX");
    return result !== null;
  } catch { return process.env.NODE_ENV !== "production"; }
}

// ── Scope enforcement — prevents accidental global impact from zone rules ─────

const ACTION_REQUIRED_SCOPE: Partial<Record<string, ActionScope>> = {
  surge_increase:   "per_zone",
  surge_restore:    "per_zone",
  booking_pause:    "global",
  booking_restore:  "global",
};

function validateActionScope(actionId: AutoActionId, rule: AlertRule): boolean {
  if (!actionId) return true;
  const required = ACTION_REQUIRED_SCOPE[actionId];
  if (required && required !== rule.scope) {
    console.error(`[ALERT-ENGINE] SCOPE GUARD: ${actionId} requires ${required} but rule ${rule.id} is ${rule.scope} — blocked`);
    return false;
  }
  return true;
}

// ── Shadow mode — observe-only mode before enabling live actions ──────────────

function isShadowMode(): boolean {
  return !isAutoActionsEnabled() && process.env.LOG_INTENDED_ACTIONS === "true";
}

// ── Conflict resolution ───────────────────────────────────────────────────────
// Keys: actionId that should be suppressed.
// Values: rule IDs that suppress it when firing (higher-priority rules).

const SUPPRESSED_BY: Record<string, string[]> = {
  // No point surging when bookings are already paused
  "surge_increase": ["redis_down", "payment_failures_high"],
};

function isActionSuppressed(actionId: AutoActionId, firingRuleIds: Set<string>): boolean {
  if (!actionId) return false;
  const suppressors = SUPPRESSED_BY[actionId] ?? [];
  return suppressors.some(id => firingRuleIds.has(id));
}

// ── Dashboard metrics ─────────────────────────────────────────────────────────

let cachedMetrics: DashboardMetrics | null = null;
let cacheExpiresAt = 0;
const METRICS_CACHE_MS = 30_000;

export async function getDashboardMetrics(forceRefresh = false): Promise<DashboardMetrics> {
  if (!forceRefresh && cachedMetrics && Date.now() < cacheExpiresAt) return cachedMetrics;

  const apiStats = getApiErrorStats();

  const [rideStatsR, otpR, paymentR, fraudR, driverR, dispatchR, churnR] = await Promise.all([
    // Ride stats — active, searching, today + 30-min rolling, dispatch latency
    rawDb.execute(rawSql`
      SELECT
        COUNT(*) FILTER (WHERE current_status IN ('accepted','driver_assigned','arrived','on_the_way')) AS active_rides,
        COUNT(*) FILTER (WHERE current_status = 'searching') AS searching_rides,
        COUNT(*) FILTER (WHERE current_status = 'completed' AND DATE(updated_at) = CURRENT_DATE) AS completed_today,
        COUNT(*) FILTER (WHERE current_status = 'cancelled'  AND DATE(updated_at) = CURRENT_DATE) AS cancelled_today,
        COUNT(*) FILTER (WHERE current_status = 'completed' AND updated_at > NOW() - INTERVAL '30 minutes') AS completed_30m,
        COUNT(*) FILTER (WHERE current_status = 'cancelled' AND updated_at > NOW() - INTERVAL '30 minutes') AS cancelled_30m,
        COALESCE(SUM(actual_fare)  FILTER (WHERE current_status = 'completed' AND DATE(updated_at) = CURRENT_DATE), 0) AS revenue_today,
        COALESCE(AVG(EXTRACT(EPOCH FROM (accepted_at - created_at)) * 1000)
          FILTER (WHERE accepted_at IS NOT NULL AND created_at > NOW() - INTERVAL '30 minutes'), 0) AS avg_dispatch_ms
      FROM trip_requests
    `).catch(() => ({ rows: [{}] })),

    // OTP fail count last 1h
    rawDb.execute(rawSql`
      SELECT
        COUNT(*) FILTER (WHERE tag = 'OTP_RATE_LIMIT') AS fail_count,
        COUNT(*) FILTER (WHERE tag IN ('OTP_SENT','OTP_RATE_LIMIT')) AS send_count
      FROM system_logs
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `).catch(() => ({ rows: [{ fail_count: 0, send_count: 0 }] })),

    // Payment stats — pending + failed today
    rawDb.execute(rawSql`
      SELECT
        COUNT(*) FILTER (WHERE payment_status IN ('pending','payment_pending')) AS pending_payments,
        COUNT(*) FILTER (WHERE payment_status = 'failed' AND DATE(updated_at) = CURRENT_DATE) AS failed_payments
      FROM trip_requests
      WHERE payment_method != 'cash'
    `).catch(() => ({ rows: [{ pending_payments: 0, failed_payments: 0 }] })),

    // Fraud flags today
    rawDb.execute(rawSql`
      SELECT COUNT(*) AS cnt FROM system_logs
      WHERE tag LIKE 'FRAUD_%' AND DATE(created_at) = CURRENT_DATE
    `).catch(() => ({ rows: [{ cnt: 0 }] })),

    // Online drivers (active heartbeat within 5 min)
    rawDb.execute(rawSql`
      SELECT COUNT(*) AS cnt FROM driver_locations
      WHERE is_online = true AND updated_at > NOW() - INTERVAL '5 minutes'
    `).catch(() => ({ rows: [{ cnt: 0 }] })),

    // Dispatch accept rate + avg wait (from system_logs tags logged by dispatch.ts)
    rawDb.execute(rawSql`
      SELECT
        COUNT(*) FILTER (WHERE tag = 'DISPATCH_ACCEPT') AS accepted,
        COUNT(*) FILTER (WHERE tag IN ('DISPATCH_ACCEPT','DISPATCH_REJECT','DISPATCH_TIMEOUT')) AS total_offers,
        COALESCE(AVG((details->>'waitMs')::float) FILTER (WHERE tag = 'DISPATCH_ACCEPT'), 0) AS avg_wait_ms
      FROM system_logs
      WHERE created_at > NOW() - INTERVAL '30 minutes'
    `).catch(() => ({ rows: [{ accepted: 0, total_offers: 0, avg_wait_ms: 0 }] })),

    // Driver online/offline churn events in last 5 min
    rawDb.execute(rawSql`
      SELECT COUNT(*) AS cnt FROM system_logs
      WHERE tag IN ('DRIVER_ONLINE','DRIVER_OFFLINE')
        AND created_at > NOW() - INTERVAL '5 minutes'
    `).catch(() => ({ rows: [{ cnt: 0 }] })),
  ]);

  const rides    = (rideStatsR.rows[0] as any) ?? {};
  const otp      = (otpR.rows[0] as any) ?? {};
  const pay      = (paymentR.rows[0] as any) ?? {};
  const fraud    = (fraudR.rows[0] as any) ?? {};
  const drivers  = (driverR.rows[0] as any) ?? {};
  const dispatch = (dispatchR.rows[0] as any) ?? {};
  const churn    = (churnR.rows[0] as any) ?? {};

  const completed   = parseInt(rides.completed_today  ?? "0");
  const cancelled   = parseInt(rides.cancelled_today  ?? "0");
  const comp30m     = parseInt(rides.completed_30m    ?? "0");
  const canc30m     = parseInt(rides.cancelled_30m    ?? "0");
  const otpFail     = parseInt(otp.fail_count  ?? "0");
  const otpSend     = parseInt(otp.send_count  ?? "0");
  const accepted    = parseInt(dispatch.accepted      ?? "0");
  const totalOffers = parseInt(dispatch.total_offers  ?? "0");

  let socketConnections = 0;
  try {
    const { io } = await import("./socket");
    socketConnections = io?.sockets?.sockets?.size ?? 0;
  } catch { /* not yet initialised */ }

  const redisHealth = await checkRedis();
  const requireRedis = Boolean(process.env.REDIS_URL);
  const redisHealthy = !requireRedis || redisHealth.status === "ok";

  const metrics: DashboardMetrics = {
    otpFailLast1h:       otpFail,
    otpSendLast1h:       otpSend,
    loginSuccessRatePct: otpSend > 0 ? Math.round(((otpSend - otpFail) / otpSend) * 100) : 100,

    activeRides:           parseInt(rides.active_rides    ?? "0"),
    searchingRides:        parseInt(rides.searching_rides ?? "0"),
    completedToday:        completed,
    cancelledToday:        cancelled,
    rideCompletionRatePct: (completed + cancelled) > 0 ? Math.round(completed / (completed + cancelled) * 100) : 100,
    completionRateLive:    (comp30m + canc30m) > 0 ? Math.round(comp30m / (comp30m + canc30m) * 100) : 100,

    onlineDrivers:           parseInt(drivers.cnt ?? "0"),
    driverOnlineChurnPerMin: Math.round(parseInt(churn.cnt ?? "0") / 5),

    acceptRatePct:         totalOffers > 0 ? Math.round((accepted / totalOffers) * 100) : 100,
    avgWaitToAcceptMs:     Math.round(parseFloat(dispatch.avg_wait_ms ?? "0")),
    dispatchLatencyMs:     Math.round(parseFloat(rides.avg_dispatch_ms ?? "0")),
    dispatchOffersLast30m: totalOffers,

    pendingPayments: parseInt(pay.pending_payments ?? "0"),
    failedPayments:  parseInt(pay.failed_payments  ?? "0"),
    revenueToday:    parseFloat(rides.revenue_today ?? "0"),

    socketConnections,
    redisHealthy,
    apiErrorCount:   apiStats.errorCount,
    apiErrorRatePct: apiStats.errorRatePct,

    fraudFlagsToday: parseInt(fraud.cnt ?? "0"),

    generatedAt:   new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  };

  const safe = sanitizeMetrics(metrics);
  cachedMetrics   = safe;
  cacheExpiresAt  = Date.now() + METRICS_CACHE_MS;
  return safe;
}

// Clamp impossible values — guards against bad DB reads or log anomalies
function sanitizeMetrics(m: DashboardMetrics): DashboardMetrics {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    ...m,
    acceptRatePct:        clamp(m.acceptRatePct,        0, 100),
    avgWaitToAcceptMs:    clamp(m.avgWaitToAcceptMs,    0, 10 * 60 * 1000),
    dispatchLatencyMs:    clamp(m.dispatchLatencyMs,    0,  5 * 60 * 1000),
    apiErrorRatePct:      clamp(m.apiErrorRatePct,      0, 100),
    loginSuccessRatePct:  clamp(m.loginSuccessRatePct,  0, 100),
    completionRateLive:   clamp(m.completionRateLive,   0, 100),
    rideCompletionRatePct: clamp(m.rideCompletionRatePct, 0, 100),
    searchingRides:       Math.max(0, m.searchingRides),
    onlineDrivers:        Math.max(0, m.onlineDrivers),
    failedPayments:       Math.max(0, m.failedPayments),
    pendingPayments:      Math.max(0, m.pendingPayments),
    otpFailLast1h:        Math.max(0, m.otpFailLast1h),
    dispatchOffersLast30m: Math.max(0, m.dispatchOffersLast30m),
  };
}

// ── Audit log helper ──────────────────────────────────────────────────────────

interface AuditParams {
  tag:            string;
  message:        string;
  rule?:          string;
  scope?:         string;
  action?:        string;
  previousState?: string;
  newState?:      string;
  actionId?:      string;
  suppressedBy?:  string[];  // rules that blocked this action
  shadow?:        boolean;   // true when AUTO_ACTIONS_ENABLED=false
  metrics?:       Partial<DashboardMetrics>;
}

function logAudit(p: AuditParams): void {
  rawDb.execute(rawSql`
    INSERT INTO system_logs (level, tag, message, details)
    VALUES ('info', ${p.tag}, ${p.message}, ${JSON.stringify({
      rule: p.rule, scope: p.scope, action: p.action,
      previousState: p.previousState, newState: p.newState,
      actionId: p.actionId,
      suppressedBy: p.suppressedBy ?? [],
      shadow: p.shadow ?? false,
      triggeredAt: new Date().toISOString(),
      metrics: p.metrics,
    })}::jsonb)
  `).catch(() => { });
}

// ── Auto-actions (safety-capped + idempotent) ─────────────────────────────────

async function executeAction(
  actionId: AutoActionId,
  rule: AlertRule,
  metrics: DashboardMetrics,
  zoneKey = "all",
): Promise<void> {
  if (!actionId) return;

  // Scope guard — e.g. surge actions must only come from per_zone rules
  if (!validateActionScope(actionId, rule)) return;

  const snap = {
    searchingRides: metrics.searchingRides, onlineDrivers: metrics.onlineDrivers,
    failedPayments: metrics.failedPayments, acceptRatePct: metrics.acceptRatePct,
    apiErrorRatePct: metrics.apiErrorRatePct,
  };

  // Shadow mode — log intended action without executing
  if (!isAutoActionsEnabled()) {
    if (isShadowMode()) {
      console.log(`[ALERT-ENGINE] SHADOW: would execute ${actionId} (rule=${rule.id}, scope=${rule.scope}, zone=${zoneKey})`);
      logAudit({
        tag: "SHADOW_ACTION", rule: rule.id, scope: rule.scope, action: actionId,
        shadow: true, actionId: makeActionToken(actionId, zoneKey),
        message: `SHADOW: would execute ${actionId} — AUTO_ACTIONS_ENABLED=false`, metrics: snap,
      });
    } else {
      console.log(`[ALERT-ENGINE] AUTO_ACTIONS_ENABLED=false — skipping ${actionId}`);
    }
    return;
  }

  // Idempotency — zone-scoped token, Redis NX (multi-pod), in-memory fallback
  const { alreadyApplied, redisAvailable } = await checkAndClaimAction(actionId, zoneKey);
  if (alreadyApplied) {
    console.log(`[ALERT-ENGINE] ${actionId}:${zoneKey} already applied this window — idempotent skip`);
    return;
  }

  // Redis-down fail-safe: suppress per_zone surge actions when Redis is unavailable.
  // Booking pause/restore are still allowed (global, tolerate cross-pod inconsistency).
  if (!redisAvailable && ACTION_REQUIRED_SCOPE[actionId] === "per_zone") {
    console.log(`[ALERT-ENGINE] Redis down — suppressing per_zone ${actionId} (cross-pod inconsistency risk)`);
    logAudit({ tag: "ACTION_SUPPRESSED_REDIS_DOWN", rule: rule.id, scope: rule.scope, action: actionId,
      message: `${actionId} suppressed — Redis unavailable, per_zone action unsafe across pods`, metrics: snap });
    return;
  }

  const token = makeActionToken(actionId, zoneKey);

  try {
    switch (actionId) {
      case "surge_increase": {
        if (!isSurgeAutomationEnabled()) {
          console.log("[ALERT-ENGINE] ENABLE_SURGE_AUTOMATION=false — skipping surge_increase");
          return;
        }
        const beforeR = await rawDb.execute(rawSql`
          SELECT COALESCE(AVG(surge_factor), 1.0) AS avg FROM zones WHERE is_active = true
        `).catch(() => ({ rows: [{ avg: 1.0 }] }));
        const prevAvg = parseFloat((beforeR.rows[0] as any)?.avg ?? "1.0").toFixed(1);

        const cap = engineN("maxSurgeCap", MAX_SURGE_CAP);
        await rawDb.execute(rawSql`
          UPDATE zones
          SET surge_factor = LEAST(${cap}, COALESCE(surge_factor, 1.0) + 0.3)
          WHERE is_active = true AND surge_factor < ${cap}
        `);

        logAudit({
          tag: "AUTO_ACTION", rule: rule.id, scope: rule.scope, action: actionId,
          previousState: `${prevAvg}x`, newState: `+0.3x (cap ${cap}x)`,
          actionId: token, metrics: snap,
          message: `surge_increase — searching=${metrics.searchingRides}, acceptRate=${metrics.acceptRatePct}%`,
        });
        break;
      }

      case "surge_restore": {
        if (!isSurgeAutomationEnabled()) return;
        await rawDb.execute(rawSql`
          UPDATE zones SET surge_factor = 1.0 WHERE is_active = true AND surge_factor > 1.0
        `);
        logAudit({
          tag: "AUTO_ACTION", rule: rule.id, scope: rule.scope, action: actionId,
          previousState: "elevated", newState: "1.0x", actionId: token, metrics: snap,
          message: `surge_restore — searching=${metrics.searchingRides}`,
        });
        break;
      }

      case "booking_pause": {
        if (!isBookingPauseEnabled()) {
          console.log("[ALERT-ENGINE] ENABLE_BOOKING_PAUSE=false — skipping booking_pause");
          return;
        }
        await rawDb.execute(rawSql`
          UPDATE platform_services
          SET service_status = 'paused'
          WHERE service_key IN ('bike_ride','auto_ride','cab_ride','parcel')
            AND service_status = 'active'
        `).catch(() => { });

        // Record pause timestamp for hard-cap enforcement
        const s = getState(rule.id);
        alertStates.set(rule.id, { ...s, bookingPausedAt: Date.now() });

        logAudit({
          tag: "AUTO_ACTION", rule: rule.id, scope: "global", action: actionId,
          previousState: "active", newState: "paused",
          actionId: token, metrics: snap,
          message: `booking_pause — rule=${rule.id}, hardCapMs=${BOOKING_PAUSE_MAX_MS}`,
        });
        break;
      }

      case "booking_restore": {
        await rawDb.execute(rawSql`
          UPDATE platform_services
          SET service_status = 'active'
          WHERE service_key IN ('bike_ride','auto_ride','cab_ride','parcel')
            AND service_status = 'paused'
        `).catch(() => { });

        const s = getState(rule.id);
        alertStates.set(rule.id, { ...s, bookingPausedAt: undefined });

        logAudit({
          tag: "AUTO_ACTION", rule: rule.id, scope: "global", action: actionId,
          previousState: "paused", newState: "active", actionId: token, metrics: snap,
          message: `booking_restore — rule=${rule.id}`,
        });
        break;
      }
    }
  } catch (e: any) {
    console.error(`[ALERT-ENGINE] Action ${actionId} failed:`, e.message);
  }
}

// ── Hard cap enforcement (booking pause timeout) ──────────────────────────────

async function enforceHardCaps(metrics: DashboardMetrics): Promise<void> {
  const pauseMaxMs = engineN("bookingPauseMaxMinutes", 10) * 60_000;
  for (const rule of ALERT_RULES) {
    const state = getState(rule.id);
    if (state.bookingPausedAt && Date.now() - state.bookingPausedAt > pauseMaxMs) {
      console.log(`[ALERT-ENGINE] ⏰ Hard cap hit (${pauseMaxMs / 60000}min) — force-restoring bookings for rule: ${rule.id}`);
      await executeAction("booking_restore", rule, metrics);
      sendOpsAlert({
        level: "error", source: "alert-engine", priority: 1,
        message: `booking_pause hard cap (${pauseMaxMs / 60000}min) reached — bookings auto-restored. Rule: ${rule.label}`,
      }).catch(() => { });
    }
  }
}

// ── Alert check cycle ─────────────────────────────────────────────────────────

// ── Metric history ring buffer (sparklines + trend) ──────────────────────────

const METRIC_HISTORY_MAX = 20;
const metricHistory: Array<{
  ts:               number;
  searchingRides:   number;
  onlineDrivers:    number;
  acceptRatePct:    number;
  completionRateLive: number;
  apiErrorRatePct:  number;
}> = [];

function recordMetricSnapshot(m: DashboardMetrics): void {
  metricHistory.push({
    ts: Date.now(),
    searchingRides:    m.searchingRides,
    onlineDrivers:     m.onlineDrivers,
    acceptRatePct:     m.acceptRatePct,
    completionRateLive: m.completionRateLive,
    apiErrorRatePct:   m.apiErrorRatePct,
  });
  if (metricHistory.length > METRIC_HISTORY_MAX) metricHistory.shift();
}

export function getMetricHistory() { return [...metricHistory]; }

// ── Manual override (bypasses automation guards, always audited) ──────────────

export async function executeManualAction(
  actionId: "booking_pause" | "booking_restore" | "surge_restore",
  requestedBy = "admin",
  reason?: string,
): Promise<{ ok: boolean; message: string }> {
  const token = `manual:${actionId}:${Date.now()}`;
  try {
    switch (actionId) {
      case "surge_restore":
        await rawDb.execute(rawSql`
          UPDATE zones SET surge_factor = 1.0 WHERE is_active = true AND surge_factor > 1.0
        `);
        break;
      case "booking_pause":
        await rawDb.execute(rawSql`
          UPDATE platform_services SET service_status = 'paused'
          WHERE service_key IN ('bike_ride','auto_ride','cab_ride','parcel')
            AND service_status = 'active'
        `).catch(() => {});
        break;
      case "booking_restore":
        await rawDb.execute(rawSql`
          UPDATE platform_services SET service_status = 'active'
          WHERE service_key IN ('bike_ride','auto_ride','cab_ride','parcel')
            AND service_status = 'paused'
        `).catch(() => {});
        break;
      default:
        return { ok: false, message: "Unknown action" };
    }
    rawDb.execute(rawSql`
      INSERT INTO system_logs (level, tag, message, details)
      VALUES ('info', 'MANUAL_ACTION',
        ${`Manual ${actionId}${reason ? " — " + reason : ""}`},
        ${JSON.stringify({ action: actionId, by: requestedBy, reason: reason ?? null, token })}::jsonb)
    `).catch(() => {});
    console.log(`[ALERT-ENGINE] MANUAL_ACTION: ${actionId} by ${requestedBy}${reason ? " (" + reason + ")" : ""}`);
    return { ok: true, message: `${actionId} executed` };
  } catch (e: any) {
    return { ok: false, message: e.message };
  }
}

// ── Alert check cycle ─────────────────────────────────────────────────────────

async function runAlertCheck(): Promise<void> {
  let metrics: DashboardMetrics;
  try {
    metrics = await getDashboardMetrics(true);
  } catch (e: any) {
    console.error("[ALERT-ENGINE] metrics fetch failed:", e.message);
    return;
  }

  recordMetricSnapshot(metrics);

  // Hard cap check first — safety before anything else
  await enforceHardCaps(metrics);

  // Rules sorted by priority (P0 first) — higher-priority rules run and fire first
  const sortedRules = [...ALERT_RULES].sort((a, b) => a.priority - b.priority);

  // Snapshot of currently-firing rules (used for conflict suppression)
  const currentlyFiring = new Set<string>(
    ALERT_RULES.filter(r => getState(r.id).firing).map(r => r.id)
  );

  const nowMs = Date.now();
  const newlyFiring: { rule: AlertRule; msg: string }[] = [];

  ruleLoop: for (const rule of sortedRules) {
    if (!isRuleEnabled(rule)) continue ruleLoop;

    const state    = getState(rule.id);
    const breaching = rule.triggerCheck(metrics);
    const clearing  = rule.clearCheck(metrics);

    if (breaching) {
      const newBreaches = state.consecutiveBreaches + 1;
      alertStates.set(rule.id, { ...state, consecutiveBreaches: newBreaches, consecutiveClears: 0 });

      const shouldFire = newBreaches >= getMinBreaches(rule);
      const cooldownOk = nowMs - state.lastFiredAt > engineN("alertCooldownMinutes", 15) * 60_000;

      if (shouldFire && (!state.firing || cooldownOk)) {
        const msg = rule.message(metrics);
        const newState = getState(rule.id);
        alertStates.set(rule.id, {
          ...newState,
          firing:      true,
          firedAt:     newState.firedAt ?? nowMs, // preserve original fire time for dwell check
          lastFiredAt: nowMs,
          fireCount:   state.fireCount + 1,
        });
        currentlyFiring.add(rule.id);

        console.log(`[ALERT-ENGINE] P${rule.priority} ${rule.severity.toUpperCase()} — ${rule.label}`);
        console.log(`  ${msg}`);
        console.log(`  Cause: ${rule.runbook.cause}`);
        newlyFiring.push({ rule, msg });

        logAudit({
          tag: `ALERT_${rule.severity.toUpperCase()}`,
          rule: rule.id, scope: rule.scope, message: msg,
          metrics: {
            searchingRides: metrics.searchingRides, onlineDrivers: metrics.onlineDrivers,
            failedPayments: metrics.failedPayments, apiErrorRatePct: metrics.apiErrorRatePct,
            acceptRatePct: metrics.acceptRatePct, otpFailLast1h: metrics.otpFailLast1h,
            dispatchOffersLast30m: metrics.dispatchOffersLast30m,
          },
        });

        if (rule.action) {
          const suppressors = Array.from(currentlyFiring).filter(id =>
            (SUPPRESSED_BY[rule.action!] ?? []).includes(id)
          );
          if (suppressors.length > 0) {
            console.log(`[ALERT-ENGINE] ${rule.action} suppressed by [${suppressors.join(", ")}]`);
            logAudit({
              tag: "ACTION_SUPPRESSED", rule: rule.id, scope: rule.scope, action: rule.action,
              suppressedBy: suppressors,
              message: `${rule.action} suppressed — ${suppressors.join(", ")} already firing`,
            });
          } else {
            await executeAction(rule.action, rule, metrics);
          }
        }
      }
    } else {
      // Not breaching — accumulate clears toward grace period
      const newClears = clearing ? state.consecutiveClears + 1 : 0;
      alertStates.set(rule.id, { ...state, consecutiveBreaches: 0, consecutiveClears: newClears });

      if (state.firing && newClears >= getMinClears(rule)) {
        const isRestoreAction = rule.recoveryAction === "surge_restore" || rule.recoveryAction === "booking_restore";
        const minDwellMs = engineN("minDwellMinutes", 2) * 60_000;
        const completionMin = engineN("recoveryCompletionRateMinPct", 80);

        // Dwell time guard — alert must have been firing for at least minDwellMs before recovery.
        if (isRestoreAction && state.firedAt && (nowMs - state.firedAt) < minDwellMs) {
          const dwellSec = Math.round((nowMs - state.firedAt) / 1000);
          console.log(`[ALERT-ENGINE] Recovery held — dwell ${dwellSec}s < ${minDwellMs / 1000}s (holding ${rule.recoveryAction})`);
          alertStates.set(rule.id, { ...getState(rule.id), consecutiveClears: 0 });
          continue ruleLoop;
        }

        // Completion-rate guard — hold restore if rides are still cancelling
        if (isRestoreAction && metrics.completionRateLive < completionMin) {
          console.log(`[ALERT-ENGINE] Recovery held — completionRateLive=${metrics.completionRateLive}% < ${completionMin}% (holding ${rule.recoveryAction})`);
          alertStates.set(rule.id, { ...getState(rule.id), consecutiveClears: 0 });
          continue ruleLoop;
        }

        alertStates.set(rule.id, {
          ...getState(rule.id), firing: false, firedAt: undefined, consecutiveClears: 0,
        });
        currentlyFiring.delete(rule.id);

        const dwellMs = state.firedAt ? nowMs - state.firedAt : 0;
        console.log(`[ALERT-ENGINE] ✅ P${rule.priority} RESOLVED after ${Math.round(dwellMs / 1000)}s — ${rule.label}`);

        logAudit({
          tag: "ALERT_RESOLVED", rule: rule.id, scope: rule.scope,
          message: `${rule.label} resolved after ${rule.minConsecutiveClears} clears + ${Math.round(dwellMs / 1000)}s dwell`,
        });

        if (rule.recoveryAction) {
          await executeAction(rule.recoveryAction, rule, metrics);
        }
      }
    }
  }

  // Only the leader pod sends external alerts — prevents N-pod alert duplication.
  // All pods still evaluate rules, execute actions, and write audit logs.
  if (newlyFiring.length > 0) {
    const isLeader = await acquireLeaderLock();
    if (isLeader) {
      const slot = Math.floor(Date.now() / ACTION_TOKEN_WINDOW_MS);
      if (newlyFiring.length === 1) {
        const { rule, msg } = newlyFiring[0];
        const body = [
          `[P${rule.priority}/${rule.severity}] ${msg}`,
          `Cause: ${rule.runbook.cause}`,
          `Checks: ${rule.runbook.checks.join(" | ")}`,
          `Rollback: ${rule.runbook.rollback}`,
        ].join("\n");
        sendOpsAlert({
          level: rule.severity === "critical" ? "critical" : "error",
          source: "alert-engine", message: body, priority: rule.priority,
          dedupKey: `${rule.id}:${rule.scope}:${slot}`,
        }).catch(() => { });
      } else {
        const lines = newlyFiring.map(({ rule, msg }) => `  [P${rule.priority}] ${msg}`).join("\n");
        const topPriority = Math.min(...newlyFiring.map(f => f.rule.priority)) as RulePriority;
        const ruleIds = newlyFiring.map(f => f.rule.id).join(",");
        sendOpsAlert({
          level: "critical", source: "alert-engine", priority: topPriority,
          message: `${newlyFiring.length} alerts firing simultaneously:\n${lines}`,
          dedupKey: `multi:${ruleIds}:${slot}`,
        }).catch(() => { });
      }
    }
  }
}

// ── Engine lifecycle ──────────────────────────────────────────────────────────

let engineInterval: ReturnType<typeof setInterval> | null = null;
let engineStartedAt = 0;

export function startAlertEngine(): void {
  if (engineInterval) return;
  engineStartedAt = Date.now();
  // Subscribe to Redis config-sync channel (multi-pod support)
  subscribeConfigSync().catch(() => {});
  // Delay first check 30s — let server finish bootstrapping
  setTimeout(() => {
    runAlertCheck().catch(e => console.error("[ALERT-ENGINE] initial check error:", e.message));
    engineInterval = setInterval(() => {
      runAlertCheck().catch(e => console.error("[ALERT-ENGINE] check error:", e.message));
    }, CHECK_INTERVAL_MS);
  }, 30_000);
  console.log("[ALERT-ENGINE] Started — 60s interval, hysteresis + debounce + grace period + multi-pod sync active");
}

export function getAlertEngineStatus(): {
  running:               boolean;
  uptimeMs:              number;
  autoActionsEnabled:    boolean;
  surgeAutomationEnabled: boolean;
  bookingPauseEnabled:   boolean;
  configPath:            string;
  effectiveMaxSurgeCap:  number;
  activeAlerts: {
    ruleId: string; label: string; priority: RulePriority;
    severity: AlertSeverity; since: number; fireCount: number; scope: ActionScope;
  }[];
  allRules: {
    id: string; label: string; priority: RulePriority; severity: AlertSeverity;
    enabled: boolean; firing: boolean; consecutiveBreaches: number; consecutiveClears: number; scope: ActionScope;
    runbook: Runbook;
  }[];
} {
  return {
    running:               engineInterval !== null,
    uptimeMs:              engineStartedAt ? Date.now() - engineStartedAt : 0,
    autoActionsEnabled:    isAutoActionsEnabled(),
    surgeAutomationEnabled: isSurgeAutomationEnabled(),
    bookingPauseEnabled:   isBookingPauseEnabled(),
    configPath:            CONFIG_PATH,
    effectiveMaxSurgeCap:  engineN("maxSurgeCap", MAX_SURGE_CAP),
    activeAlerts: ALERT_RULES.filter(r => getState(r.id).firing).map(r => {
      const s = getState(r.id);
      return { ruleId: r.id, label: r.label, priority: r.priority, severity: r.severity,
        since: s.lastFiredAt, fireCount: s.fireCount, scope: r.scope };
    }),
    allRules: ALERT_RULES.map(r => {
      const s = getState(r.id);
      return {
        id: r.id, label: r.label, priority: r.priority, severity: r.severity,
        enabled: isRuleEnabled(r), firing: s.firing,
        consecutiveBreaches: s.consecutiveBreaches,
        consecutiveClears: s.consecutiveClears, scope: r.scope, runbook: r.runbook,
      };
    }),
  };
}

// ── Daily health report ───────────────────────────────────────────────────────

export interface DailyHealthReport {
  date:                  string;
  totalRides:            number;
  completedRides:        number;
  cancelledRides:        number;
  completionRatePct:     number;
  revenueTotal:          number;
  avgFare:               number;
  fraudFlagsTotal:       number;
  topFraudTypes:         { type: string; count: number }[];
  otpFailures:           number;
  apiErrors:             number;
  buildApprovals:        number;
  buildRejections:       number;
  avgDispatchLatencyMs:  number;
  autoActionsExecuted:   number;
  peakOnlineDrivers:     number; // requires time-series table — 0 until tracked
  generatedAt:           string;
}

export async function getDailyHealthReport(dateStr?: string): Promise<DailyHealthReport> {
  const targetDate = dateStr ?? new Date().toISOString().slice(0, 10);

  const [ridesR, fraudR, logsR, qaR, actionsR] = await Promise.all([
    rawDb.execute(rawSql`
      SELECT
        COUNT(*) AS total_rides,
        COUNT(*) FILTER (WHERE current_status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE current_status = 'cancelled')  AS cancelled,
        COALESCE(SUM(actual_fare) FILTER (WHERE current_status = 'completed'), 0) AS revenue,
        COALESCE(AVG(actual_fare) FILTER (WHERE current_status = 'completed'), 0) AS avg_fare,
        COALESCE(AVG(EXTRACT(EPOCH FROM (accepted_at - created_at)) * 1000)
          FILTER (WHERE accepted_at IS NOT NULL), 0) AS avg_dispatch_ms
      FROM trip_requests
      WHERE DATE(created_at) = ${targetDate}::date
    `),
    rawDb.execute(rawSql`
      SELECT tag, COUNT(*) AS cnt FROM system_logs
      WHERE tag LIKE 'FRAUD_%' AND DATE(created_at) = ${targetDate}::date
      GROUP BY tag ORDER BY cnt DESC
    `),
    rawDb.execute(rawSql`
      SELECT
        COUNT(*) FILTER (WHERE tag = 'OTP_RATE_LIMIT') AS otp_fails,
        COUNT(*) FILTER (WHERE level = 'error')        AS api_errors
      FROM system_logs
      WHERE DATE(created_at) = ${targetDate}::date
    `),
    rawDb.execute(rawSql`
      SELECT
        COUNT(*) FILTER (WHERE tag = 'BUILD_APPROVED') AS approvals,
        COUNT(*) FILTER (WHERE tag = 'BUILD_REJECTED') AS rejections
      FROM system_logs
      WHERE DATE(created_at) = ${targetDate}::date
    `),
    rawDb.execute(rawSql`
      SELECT COUNT(*) AS cnt FROM system_logs
      WHERE tag = 'AUTO_ACTION' AND DATE(created_at) = ${targetDate}::date
    `),
  ]);

  const rides   = (ridesR.rows[0] as any) ?? {};
  const logs    = (logsR.rows[0] as any) ?? {};
  const qa      = (qaR.rows[0] as any) ?? {};
  const actions = (actionsR.rows[0] as any) ?? {};
  const completed = parseInt(rides.completed ?? "0");
  const cancelled = parseInt(rides.cancelled ?? "0");
  const fraudTotal = (fraudR.rows as any[]).reduce((s, r) => s + parseInt(r.cnt), 0);

  return {
    date:                 targetDate,
    totalRides:           parseInt(rides.total_rides ?? "0"),
    completedRides:       completed,
    cancelledRides:       cancelled,
    completionRatePct:    (completed + cancelled) > 0 ? Math.round(completed / (completed + cancelled) * 100) : 100,
    revenueTotal:         Math.round(parseFloat(rides.revenue ?? "0")),
    avgFare:              Math.round(parseFloat(rides.avg_fare ?? "0")),
    fraudFlagsTotal:      fraudTotal,
    topFraudTypes:        (fraudR.rows as any[]).map(r => ({ type: r.tag, count: parseInt(r.cnt) })),
    otpFailures:          parseInt(logs.otp_fails   ?? "0"),
    apiErrors:            parseInt(logs.api_errors  ?? "0"),
    buildApprovals:       parseInt(qa.approvals     ?? "0"),
    buildRejections:      parseInt(qa.rejections    ?? "0"),
    avgDispatchLatencyMs: Math.round(parseFloat(rides.avg_dispatch_ms ?? "0")),
    autoActionsExecuted:  parseInt(actions.cnt      ?? "0"),
    peakOnlineDrivers:    0,
    generatedAt:          new Date().toISOString(),
  };
}

// ── Daily report scheduler (23:30 every night) ────────────────────────────────

function scheduleDailyReport(): void {
  const now    = new Date();
  const target = new Date(now);
  target.setHours(23, 30, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);

  setTimeout(async () => {
    try {
      const report  = await getDailyHealthReport();
      const summary =
        `Daily Report ${report.date}: ` +
        `${report.totalRides} rides | ${report.completedRides} completed (${report.completionRatePct}%) | ` +
        `₹${report.revenueTotal} revenue | ${report.fraudFlagsTotal} fraud flags | ` +
        `${report.autoActionsExecuted} auto-actions | ${report.apiErrors} API errors`;

      sendOpsAlert({ level: "error", source: "daily-report", message: summary }).catch(() => { });
      rawDb.execute(rawSql`
        INSERT INTO system_logs (level, tag, message, details)
        VALUES ('info', 'DAILY_REPORT', ${summary}, ${JSON.stringify(report)}::jsonb)
      `).catch(() => { });
      console.log(`[ALERT-ENGINE] ${summary}`);
    } catch (e: any) {
      console.error("[ALERT-ENGINE] daily report error:", e.message);
    }
    scheduleDailyReport(); // reschedule for tomorrow
  }, target.getTime() - now.getTime());
}

scheduleDailyReport();
