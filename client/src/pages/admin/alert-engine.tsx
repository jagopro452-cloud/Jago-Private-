import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "@/lib/queryClient";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await adminFetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json() as Promise<T>;
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface EngineStatus {
  running: boolean; uptimeMs: number;
  autoActionsEnabled: boolean; surgeAutomationEnabled: boolean; bookingPauseEnabled: boolean;
  configPath: string; effectiveMaxSurgeCap: number;
  activeAlerts: { ruleId: string; label: string; priority: number; severity: string; since: number; fireCount: number; scope: string }[];
  allRules: {
    id: string; label: string; priority: number; severity: string;
    enabled: boolean; firing: boolean; consecutiveBreaches: number; consecutiveClears: number; scope: string;
    runbook: { cause: string; checks: string[]; rollback: string };
  }[];
}

interface EngineConfig {
  _meta?: { version: string; checksum: string; loadedAt: number; configPath: string };
  engine: { maxSurgeCap: number; bookingPauseMaxMinutes: number; alertCooldownMinutes: number; minDwellMinutes: number; checkIntervalSeconds: number; recoveryCompletionRateMinPct: number };
  rules: Record<string, { enabled?: boolean; minConsecutiveBreaches?: number; minConsecutiveClears?: number; triggerThreshold?: number; clearThreshold?: number; triggerPct?: number; clearPct?: number; clearDrivers?: number; minSamples?: number }>;
  dispatch: { driverFatigueBackoffSeconds: number; driverMaxConcurrentOffers: number };
}

interface ReloadResult {
  ok: boolean; error?: string; validationErrors?: string[]; safetyViolations?: string[];
  diff?: Record<string, string>; version?: string; checksum?: string; changedKeys?: number;
}

interface MetricSnap {
  ts: number; searchingRides: number; onlineDrivers: number;
  acceptRatePct: number; completionRateLive: number; apiErrorRatePct: number;
}

interface RecentAction { tag: string; message: string; details: any; created_at: string }
interface RuleEvent    { tag: string; message: string; details: any; created_at: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

const PC: Record<number, string> = { 0: "#dc2626", 1: "#d97706", 2: "#2563eb", 3: "#6b7280" };

function fmtAge(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: ok ? "#16a34a" : "#dc2626", display: "inline-block", flexShrink: 0 }} />
      {label}
    </span>
  );
}

// Simple SVG sparkline
function Sparkline({ data, color = "#2563eb", h = 30, w = 72 }: { data: number[]; color?: string; h?: number; w?: number }) {
  if (data.length < 2) return <span style={{ fontSize: 10, color: "#94a3b8" }}>–</span>;
  const max = Math.max(...data, 1); const min = Math.min(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / rng) * (h - 6) - 3}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(data.length - 1) / (data.length - 1) * w} cy={h - ((data[data.length - 1] - min) / rng) * (h - 6) - 3} r={2.5} fill={color} />
    </svg>
  );
}

// Health score from status
function computeHealth(status: EngineStatus | undefined): { score: "GOOD" | "WARNING" | "CRITICAL"; color: string; icon: string } {
  if (!status) return { score: "GOOD", color: "#16a34a", icon: "🟢" };
  const firing = ensureArray<EngineStatus["activeAlerts"][number]>(status.activeAlerts);
  const hasCrit = firing.some(a => a.priority <= 1);
  const hasWarn = firing.some(a => a.priority >= 2);
  if (hasCrit || !status.autoActionsEnabled && firing.length > 0)
    return { score: "CRITICAL", color: "#dc2626", icon: "🔴" };
  if (hasWarn)
    return { score: "WARNING", color: "#d97706", icon: "🟡" };
  return { score: "GOOD", color: "#16a34a", icon: "🟢" };
}

// Read-only guard — checks admin role from localStorage
function useAdminRole(): { canEdit: boolean; role: string } {
  try {
    const admin = JSON.parse(localStorage.getItem("jago-admin") || "{}");
    const role = admin.role ?? "admin";
    return { canEdit: role !== "view_only", role };
  } catch { return { canEdit: true, role: "admin" }; }
}

// ── Manual Action Confirm Modal ───────────────────────────────────────────────

function ManualActionModal({ action, onConfirm, onClose, isPending }: {
  action: "booking_pause" | "booking_restore" | "surge_restore" | null;
  onConfirm: (reason: string) => void; onClose: () => void; isPending: boolean;
}) {
  const [reason, setReason] = useState("");
  if (!action) return null;
  const INFO: Record<string, { title: string; desc: string; color: string }> = {
    booking_pause:   { title: "Pause All Bookings",  desc: "Stops new rides / parcels immediately. Auto-restore after 10 min cap.", color: "#dc2626" },
    booking_restore: { title: "Restore Bookings",    desc: "Re-enables bookings. Clears any existing pause.", color: "#16a34a" },
    surge_restore:   { title: "Reset Surge to 1.0×", desc: "Resets surge_factor to 1.0 across all active zones.", color: "#d97706" },
  };
  const info = INFO[action];
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1001, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 440, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", background: info.color + "10" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: info.color }}>{info.title}</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{info.desc}</div>
        </div>
        <div style={{ padding: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
            Reason <span style={{ color: "#94a3b8", fontWeight: 400 }}>(logged in system_logs)</span>
          </label>
          <input autoFocus type="text" value={reason} onChange={e => setReason(e.target.value)}
            placeholder={`e.g. ${action === "booking_pause" ? "Payment gateway down" : action === "surge_restore" ? "Manual fare reset" : "Gateway restored"}`}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" }}
            onKeyDown={e => e.key === "Enter" && onConfirm(reason)}
          />
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>This action is immediate and audited. It does not affect engine auto-logic.</div>
        </div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onConfirm(reason)} disabled={isPending}
            style={{ padding: "7px 18px", borderRadius: 8, background: info.color, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: isPending ? 0.6 : 1 }}>
            {isPending ? "Executing…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rule History Panel ────────────────────────────────────────────────────────

function RuleHistory({ ruleId, onClose }: { ruleId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<RuleEvent[]>({
    queryKey: [`/api/admin/alert-engine/rule-history/${ruleId}`],
    queryFn: async () => ensureArray<RuleEvent>(await fetchJson<unknown>(`/api/admin/alert-engine/rule-history/${encodeURIComponent(ruleId)}`)),
  });
  const history = ensureArray<RuleEvent>(data);
  const TAG_COLOR: Record<string, string> = {
    ALERT_CRITICAL: "#dc2626", ALERT_WARNING: "#d97706", ALERT_RESOLVED: "#16a34a",
    AUTO_ACTION: "#2563eb", ACTION_SUPPRESSED: "#94a3b8",
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 560, maxHeight: "75vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 13, fontFamily: "monospace", color: "#1e40af" }}>{ruleId}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ overflow: "auto", flex: 1, padding: "8px 0" }}>
          {isLoading && <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>Loading…</div>}
          {!isLoading && history.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>No history yet — rule hasn't fired</div>
          )}
          {history.map((ev, i) => (
            <div key={i} style={{ padding: "8px 18px", borderBottom: "1px solid #f8fafc" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: (TAG_COLOR[ev.tag] ?? "#6b7280") + "18", color: TAG_COLOR[ev.tag] ?? "#6b7280" }}>{ev.tag}</span>
                <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: "auto" }}>{new Date(ev.created_at).toLocaleString("en-IN")}</span>
              </div>
              <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{ev.message}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Config Diff Preview ───────────────────────────────────────────────────────

function diffObjs(prev: any, next: any, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = Array.from(new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})]));
  for (const k of keys) {
    if (k.startsWith("_")) continue;
    const pv = (prev ?? {})[k]; const nv = (next ?? {})[k];
    if (typeof pv === "object" && typeof nv === "object" && pv && nv)
      Object.assign(out, diffObjs(pv, nv, prefix ? `${prefix}.${k}` : k));
    else if (pv !== nv)
      out[prefix ? `${prefix}.${k}` : k] = `${pv} → ${nv}`;
  }
  return out;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AlertEnginePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canEdit } = useAdminRole();

  // Modals / drawers
  const [manualAction, setManualAction] = useState<"booking_pause" | "booking_restore" | "surge_restore" | null>(null);
  const [historyRule, setHistoryRule] = useState<string | null>(null);
  const [reloadModalOpen, setReloadModalOpen] = useState(false);
  const [reloadReason, setReloadReason] = useState("");
  const [forceReload, setForceReload] = useState(false);
  const [editingConfig, setEditingConfig] = useState(false);
  const [configJson, setConfigJson] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [lastReload, setLastReload] = useState<ReloadResult | null>(null);

  // Data fetches
  const { data: status } = useQuery<EngineStatus>({
    queryKey: ["/api/admin/alert-engine/status"],
    queryFn: async () => fetchJson<EngineStatus>("/api/admin/alert-engine/status"),
    refetchInterval: 30_000,
  });

  const { data: config } = useQuery<EngineConfig>({
    queryKey: ["/api/admin/alert-engine/config"],
    queryFn: async () => fetchJson<EngineConfig>("/api/admin/alert-engine/config"),
  });

  const { data: history = [] } = useQuery<MetricSnap[]>({
    queryKey: ["/api/admin/alert-engine/metrics-history"],
    queryFn: async () => ensureArray<MetricSnap>(await fetchJson<unknown>("/api/admin/alert-engine/metrics-history")),
    refetchInterval: 65_000,
  });

  const { data: recentActions = [] } = useQuery<RecentAction[]>({
    queryKey: ["/api/admin/alert-engine/recent-actions"],
    queryFn: async () => ensureArray<RecentAction>(await fetchJson<unknown>("/api/admin/alert-engine/recent-actions")),
    refetchInterval: 30_000,
  });

  // Mutations
  const reloadMut = useMutation<ReloadResult, Error, { reason: string; force: boolean }>({
    mutationFn: async ({ reason, force }) => {
      const r = await adminFetch("/api/admin/alert-engine/config/reload", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined, force }),
      });
      return r.json();
    },
    onSuccess: (data) => {
      setLastReload(data); setReloadModalOpen(false); setReloadReason(""); setForceReload(false);
      if (data.ok) {
        toast({ title: "Config reloaded", description: `${data.changedKeys ?? 0} change(s) — takes effect next tick` });
        qc.invalidateQueries({ queryKey: ["/api/admin/alert-engine/config"] });
        qc.invalidateQueries({ queryKey: ["/api/admin/alert-engine/status"] });
      } else {
        toast({ title: "Reload blocked", description: data.error, variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Reload failed", description: e.message, variant: "destructive" }),
  });

  const testMut = useMutation({
    mutationFn: () => adminFetch("/api/admin/alert-engine/test", { method: "POST" }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Force check complete" });
      qc.invalidateQueries({ queryKey: ["/api/admin/alert-engine/status"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/alert-engine/metrics-history"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/alert-engine/recent-actions"] });
    },
  });

  const manualMut = useMutation<{ ok: boolean; message: string }, Error, { action: string; reason: string }>({
    mutationFn: async ({ action, reason }) => {
      const r = await adminFetch("/api/admin/alert-engine/manual-action", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason || undefined }),
      });
      return r.json();
    },
    onSuccess: (data, vars) => {
      setManualAction(null);
      if (data.ok) {
        toast({ title: `${vars.action} executed`, description: "Logged in system_logs" });
        qc.invalidateQueries({ queryKey: ["/api/admin/alert-engine/recent-actions"] });
        qc.invalidateQueries({ queryKey: ["/api/admin/alert-engine/status"] });
      } else {
        toast({ title: "Action failed", description: data.message, variant: "destructive" });
      }
    },
  });

  // Config diff preview
  const livePreviewDiff = useCallback(() => {
    if (!config || !configJson) return {};
    try { return diffObjs(config, JSON.parse(configJson)); }
    catch { return {}; }
  }, [config, configJson]);

  const activeAlerts = ensureArray<EngineStatus["activeAlerts"][number]>(status?.activeAlerts);
  const allRules = ensureArray<EngineStatus["allRules"][number]>(status?.allRules);
  const health = computeHealth(status);
  const sparkSearch     = history.map(h => h.searchingRides);
  const sparkAccept     = history.map(h => h.acceptRatePct);
  const sparkCompletion = history.map(h => h.completionRateLive);

  // Dangerous state flags
  const isBookingPaused = recentActions.some(a => a.tag === "AUTO_ACTION" && (a.details?.action === "booking_pause" || a.message?.includes("booking_pause"))) ||
    activeAlerts.some(a => a.ruleId === "redis_down" || a.ruleId === "payment_failures_high");
  const surgeHigh = (status?.effectiveMaxSurgeCap ?? 2.5) > 2.0 && activeAlerts.some(a => ["searching_rides_high","no_online_drivers","low_accept_rate"].includes(a.ruleId));

  return (
    <div style={{ padding: "24px 28px", fontFamily: "Inter, sans-serif", minHeight: "100vh", background: "#f8fafc" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h4 style={{ margin: 0, fontWeight: 700, color: "#0f172a", fontSize: 20 }}>
              <i className="bi bi-robot" style={{ marginRight: 8, color: "#2563eb" }} />Alert Engine
            </h4>
            {/* ── Health Score ── */}
            <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: 20, background: health.color + "18", color: health.color, border: `1px solid ${health.color}40` }}>
              {health.icon} {health.score}
            </span>
            {isBookingPaused && (
              <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 20, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", animation: "pulse 1.5s ease-in-out infinite" }}>
                ⚠ BOOKINGS PAUSED
              </span>
            )}
            {surgeHigh && (
              <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 20, background: "#fff7ed", color: "#d97706", border: "1px solid #fed7aa" }}>
                ⚡ SURGE ACTIVE
              </span>
            )}
          </div>
          <p style={{ margin: 0, color: "#64748b", fontSize: 12 }}>
            {status ? `${allRules.filter(r => r.firing).length} firing · ${allRules.filter(r => r.enabled).length} enabled · ${fmtAge(status.uptimeMs)} uptime` : "Connecting…"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-sm" style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, fontWeight: 600, padding: "6px 14px" }}
            onClick={() => testMut.mutate()} disabled={testMut.isPending}>
            <i className="bi bi-play-circle" style={{ marginRight: 5 }} />{testMut.isPending ? "Running…" : "Force Check"}
          </button>
          {canEdit && (
            <button className="btn btn-sm btn-primary" style={{ borderRadius: 8, fontSize: 12, fontWeight: 600, padding: "6px 14px" }}
              onClick={() => setReloadModalOpen(true)} disabled={reloadMut.isPending}>
              <i className="bi bi-arrow-clockwise" style={{ marginRight: 5 }} />{reloadMut.isPending ? "Reloading…" : "Reload Config"}
            </button>
          )}
        </div>
      </div>

      {/* ── Status bar ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 18 }}>
        {[
          { label: "Engine",       value: <Dot ok={status?.running ?? false} label={status?.running ? "Running" : "Stopped"} /> },
          { label: "Auto-Actions", value: <Dot ok={status?.autoActionsEnabled ?? false} label={status?.autoActionsEnabled ? "ON" : "SHADOW"} /> },
          { label: "Surge Auto",   value: <Dot ok={status?.surgeAutomationEnabled ?? false} label={status?.surgeAutomationEnabled ? "ON" : "OFF"} /> },
          { label: "Booking Ctrl", value: <Dot ok={status?.bookingPauseEnabled ?? false} label={status?.bookingPauseEnabled ? "ON" : "OFF"} /> },
          { label: "Surge Cap",    value: <strong style={{ fontSize: 13 }}>{status?.effectiveMaxSurgeCap ?? 2.5}×</strong> },
          { label: "Active Alerts",value: <span style={{ color: activeAlerts.length > 0 ? "#dc2626" : "#16a34a", fontWeight: 700, fontSize: 13 }}>{activeAlerts.length}</span> },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5 }}>{label}</div>
            <div>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Sparkline Metrics ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 18 }}>
        {[
          { label: "Searching Rides", data: sparkSearch, color: "#dc2626", latest: history[history.length - 1]?.searchingRides ?? "–" },
          { label: "Accept Rate",     data: sparkAccept,  color: "#2563eb", latest: history.length ? (history[history.length - 1]?.acceptRatePct ?? "–") + "%" : "–" },
          { label: "Completion Rate", data: sparkCompletion, color: "#16a34a", latest: history.length ? (history[history.length - 1]?.completionRateLive ?? "–") + "%" : "–" },
        ].map(({ label, data, color, latest }) => (
          <div key={label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color }}>{latest}</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>{history.length} snapshots</div>
            </div>
            <Sparkline data={data} color={color} />
          </div>
        ))}
      </div>

      {/* ── Active Alerts Banner ── */}
      {activeAlerts.length > 0 && (
        <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 10, padding: "12px 16px", marginBottom: 18 }}>
          <div style={{ fontWeight: 700, color: "#dc2626", marginBottom: 8, fontSize: 13 }}>
            <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />
            {activeAlerts.length} Alert{activeAlerts.length > 1 ? "s" : ""} Firing
          </div>
          {activeAlerts.map(a => (
            <div key={a.ruleId} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 5px", borderRadius: 3, background: PC[a.priority] ?? "#64748b", color: "#fff" }}>P{a.priority}</span>
              <span style={{ fontSize: 13, color: "#7f1d1d", fontWeight: 600 }}>{a.label}</span>
              <span style={{ fontSize: 11, color: "#ef4444" }}>· {a.fireCount}× fired · {fmtAge(Date.now() - a.since)} ago</span>
              <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: "auto" }}>{a.scope}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Last reload / error banners ── */}
      {lastReload && !lastReload.ok && (
        <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: "#dc2626", marginBottom: 6, fontSize: 13 }}>
            <i className="bi bi-x-circle-fill" style={{ marginRight: 6 }} />Reload blocked — {lastReload.error}
          </div>
          {[...(lastReload.validationErrors ?? []), ...(lastReload.safetyViolations ?? [])].map((e, i) => (
            <div key={i} style={{ fontSize: 12, color: "#7f1d1d", paddingLeft: 8, lineHeight: 1.7 }}>• {e}</div>
          ))}
          <button onClick={() => setLastReload(null)} style={{ marginTop: 8, fontSize: 11, color: "#dc2626", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}>Dismiss</button>
        </div>
      )}
      {lastReload?.ok && lastReload.diff && Object.keys(lastReload.diff).length > 0 && (
        <div style={{ background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: "#16a34a", marginBottom: 6, fontSize: 13 }}>
            <i className="bi bi-check-circle-fill" style={{ marginRight: 6 }} />
            Config reloaded — {lastReload.changedKeys} change(s) · <code style={{ fontSize: 11 }}>{lastReload.checksum}</code>
          </div>
          {Object.entries(lastReload.diff).map(([k, v]) => (
            <div key={k} style={{ fontSize: 11.5, color: "#15803d", fontFamily: "monospace", paddingLeft: 8, lineHeight: 1.8 }}>
              <span style={{ color: "#64748b" }}>{k}:</span> {v}
            </div>
          ))}
          <button onClick={() => setLastReload(null)} style={{ marginTop: 8, fontSize: 11, color: "#16a34a", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}>Dismiss</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 18, alignItems: "start" }}>

        {/* ── LEFT: Rules table + Manual overrides ── */}
        <div>
          {/* Manual Override buttons */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: "#0f172a", marginBottom: 10 }}>
              <i className="bi bi-hand-index-fill" style={{ marginRight: 6, color: "#d97706" }} />Manual Overrides
              {!canEdit && <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400, marginLeft: 8 }}>Read-only mode</span>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { action: "booking_pause"   as const, label: "Pause Bookings",   icon: "bi-pause-circle-fill",  color: "#dc2626" },
                { action: "booking_restore" as const, label: "Restore Bookings", icon: "bi-play-circle-fill",   color: "#16a34a" },
                { action: "surge_restore"   as const, label: "Reset Surge",      icon: "bi-arrow-counterclockwise", color: "#d97706" },
              ].map(({ action, label, icon, color }) => (
                <button key={action} onClick={() => canEdit && setManualAction(action)} disabled={!canEdit || manualMut.isPending}
                  style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${color}30`, background: color + "10", color, fontSize: 12, fontWeight: 700, cursor: canEdit ? "pointer" : "not-allowed", opacity: canEdit ? 1 : 0.5 }}>
                  <i className={`bi ${icon}`} style={{ marginRight: 5 }} />{label}
                </button>
              ))}
            </div>
          </div>

          {/* Rules table */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>Rules — Live State</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>click rule for history</span>
            </div>
            {allRules.map((rule, i) => (
              <div key={rule.id} onClick={() => setHistoryRule(rule.id)} style={{
                padding: "11px 16px", borderBottom: i < allRules.length - 1 ? "1px solid #f8fafc" : "none",
                background: rule.firing ? "#fef2f2" : rule.enabled ? "#fff" : "#f9fafb", cursor: "pointer",
                transition: "background 0.15s",
              }}
                onMouseEnter={e => (e.currentTarget.style.background = rule.firing ? "#fee2e2" : "#f8fafc")}
                onMouseLeave={e => (e.currentTarget.style.background = rule.firing ? "#fef2f2" : rule.enabled ? "#fff" : "#f9fafb")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 5px", borderRadius: 3, background: PC[rule.priority] ?? "#6b7280", color: "#fff", minWidth: 22, textAlign: "center" }}>P{rule.priority}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: rule.firing ? "#dc2626" : rule.enabled ? "#0f172a" : "#94a3b8" }}>{rule.label}</span>
                  {!rule.enabled && <span style={{ fontSize: 9.5, background: "#f1f5f9", color: "#64748b", padding: "1px 5px", borderRadius: 4, fontWeight: 600 }}>OFF</span>}
                  {rule.firing && <span style={{ fontSize: 9.5, background: "#fca5a5", color: "#7f1d1d", padding: "1px 5px", borderRadius: 4, fontWeight: 800, marginLeft: "auto" }}>FIRING</span>}
                  <i className="bi bi-chevron-right" style={{ fontSize: 10, color: "#94a3b8", marginLeft: rule.firing ? 0 : "auto" }} />
                </div>
                <div style={{ display: "flex", gap: 10, fontSize: 11, color: "#64748b" }}>
                  <span>{rule.scope}</span>
                  <span>breaches: <strong style={{ color: rule.consecutiveBreaches > 0 ? "#d97706" : "#94a3b8" }}>{rule.consecutiveBreaches}</strong></span>
                  <span>clears: <strong style={{ color: rule.consecutiveClears > 0 ? "#16a34a" : "#94a3b8" }}>{rule.consecutiveClears}</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── RIGHT: Config + Last actions ── */}
        <div>
          {/* Config version strip */}
          {config?._meta && (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 11.5 }}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "#64748b" }}>
                <span><span style={{ color: "#94a3b8" }}>version </span><code style={{ background: "#f1f5f9", padding: "1px 5px", borderRadius: 3 }}>{config._meta.version.slice(0, 19).replace("T", " ")}</code></span>
                <span><span style={{ color: "#94a3b8" }}>sha </span><code style={{ background: "#f1f5f9", padding: "1px 5px", borderRadius: 3 }}>{config._meta.checksum}</code></span>
              </div>
            </div>
          )}

          {/* Engine thresholds */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>Engine Thresholds</span>
              {canEdit && (
                <button onClick={() => { setConfigJson(JSON.stringify(config, null, 2)); setJsonError(""); setEditingConfig(true); }}
                  style={{ fontSize: 11, color: "#2563eb", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}>
                  Edit JSON
                </button>
              )}
            </div>
            <div style={{ padding: "10px 16px" }}>
              {config && (
                Object.keys(config.engine ?? {}).length > 0 ? (
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <tbody>
                      {Object.entries(config.engine ?? {}).map(([k, v]) => (
                        <tr key={k} style={{ borderBottom: "1px solid #f8fafc" }}>
                          <td style={{ padding: "4px 0", color: "#64748b", fontFamily: "monospace", fontSize: 11 }}>{k}</td>
                          <td style={{ padding: "4px 0", fontWeight: 700, color: "#0f172a", textAlign: "right" }}>{String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ fontSize: 12, color: "#94a3b8", padding: "6px 0" }}>No engine thresholds available.</div>
                )
              )}
            </div>
          </div>

          {/* Per-rule thresholds */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>Per-Rule Thresholds</span>
              <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 2 }}>
                Edit <code style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: 3, fontSize: 10 }}>alert-engine.config.json</code> → Reload Config
              </div>
            </div>
            <div style={{ padding: "10px 16px" }}>
              {config && Object.keys(config.rules ?? {}).length === 0 && (
                <div style={{ fontSize: 12, color: "#94a3b8", padding: "6px 0" }}>No per-rule thresholds available.</div>
              )}
              {config && Object.entries(config.rules ?? {}).map(([ruleId, vals]) => (
                <div key={ruleId} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #f8fafc" }}>
                  <div style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#1e40af", marginBottom: 3 }}>{ruleId}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 12px" }}>
                    {Object.entries((vals ?? {}) as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} style={{ fontSize: 10.5, color: "#475569" }}>
                        <span style={{ color: "#94a3b8" }}>{k}:</span>{" "}
                        <strong style={{ color: v === false ? "#dc2626" : v === true ? "#16a34a" : "#0f172a" }}>{String(v)}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Last action indicator */}
          {recentActions.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>Recent Actions</span>
              </div>
              {recentActions.slice(0, 5).map((a, i) => {
                const TAG_C: Record<string, string> = { AUTO_ACTION: "#2563eb", MANUAL_ACTION: "#7c3aed", CONFIG_RELOAD: "#0891b2", SHADOW_ACTION: "#94a3b8", ACTION_SUPPRESSED_REDIS_DOWN: "#dc2626" };
                const c = TAG_C[a.tag] ?? "#64748b";
                const ago = fmtAge(Date.now() - new Date(a.created_at).getTime());
                return (
                  <div key={i} style={{ padding: "9px 16px", borderBottom: i < 4 ? "1px solid #f8fafc" : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 5px", borderRadius: 3, background: c + "18", color: c }}>{a.tag}</span>
                      <span style={{ fontSize: 10.5, color: "#94a3b8", marginLeft: "auto" }}>{ago} ago</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "#374151", lineHeight: 1.4 }}>{a.message}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}

      <ManualActionModal action={manualAction}
        onConfirm={reason => manualMut.mutate({ action: manualAction!, reason })}
        onClose={() => setManualAction(null)} isPending={manualMut.isPending} />

      {historyRule && <RuleHistory ruleId={historyRule} onClose={() => setHistoryRule(null)} />}

      {/* Reload reason modal */}
      {reloadModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 500, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Reload Config</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Reads from disk, validates all fields, checks safe-delta limits.</div>
            </div>
            <div style={{ padding: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                Reason <span style={{ color: "#94a3b8", fontWeight: 400 }}>(optional)</span>
              </label>
              <input autoFocus type="text" value={reloadReason} onChange={e => setReloadReason(e.target.value)}
                placeholder="e.g. Raised searching_rides trigger to 10" onKeyDown={e => e.key === "Enter" && reloadMut.mutate({ reason: reloadReason, force: forceReload })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, cursor: "pointer", userSelect: "none" }}>
                <input type="checkbox" checked={forceReload} onChange={e => setForceReload(e.target.checked)} style={{ width: 14, height: 14 }} />
                <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>Force (bypass safe-delta guard)</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>— always logged</span>
              </label>
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => { setReloadModalOpen(false); setReloadReason(""); setForceReload(false); }}
                style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => reloadMut.mutate({ reason: reloadReason, force: forceReload })} disabled={reloadMut.isPending}
                className="btn btn-primary" style={{ padding: "7px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
                {reloadMut.isPending ? "Reloading…" : forceReload ? "⚠ Force Reload" : "Reload Config"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JSON editor modal */}
      {editingConfig && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 720, maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>Edit alert-engine.config.json</span>
              <button onClick={() => setEditingConfig(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
              {/* Editor */}
              <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 8 }}>
                  Edit → copy JSON → paste into server file → <strong>Reload Config</strong>
                </div>
                <textarea value={configJson} onChange={e => { setConfigJson(e.target.value); setJsonError(""); }}
                  style={{ flex: 1, fontFamily: "monospace", fontSize: 11.5, border: jsonError ? "1.5px solid #dc2626" : "1px solid #e2e8f0", borderRadius: 8, padding: 12, resize: "none", outline: "none", background: "#f8fafc", color: "#1e293b", lineHeight: 1.6 }}
                  spellCheck={false} />
                {jsonError && <div style={{ color: "#dc2626", fontSize: 11, marginTop: 4 }}>{jsonError}</div>}
              </div>
              {/* Live diff preview */}
              {(() => {
                const diff = livePreviewDiff();
                const keys = Object.keys(diff);
                return keys.length > 0 ? (
                  <div style={{ width: 240, background: "#f8fafc", borderLeft: "1px solid #e2e8f0", padding: "16px 14px", overflow: "auto", flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 10 }}>Preview Diff ({keys.length})</div>
                    {keys.map(k => (
                      <div key={k} style={{ marginBottom: 8 }}>
                        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b", marginBottom: 1 }}>{k}</div>
                        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#15803d" }}>{diff[k]}</div>
                      </div>
                    ))}
                  </div>
                ) : null;
              })()}
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => { navigator.clipboard.writeText(configJson); toast({ title: "Copied to clipboard" }); }}
                style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Copy JSON
              </button>
              <button onClick={() => setEditingConfig(false)}
                style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
