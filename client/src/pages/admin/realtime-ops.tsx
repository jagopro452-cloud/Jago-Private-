import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch, apiRequest, getSavedAdminSession } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminHasPermission } from "@shared/permissions";

interface RealtimeOpsConfig {
  trackingFreshnessTimeoutSec: number;
  frozenMovementTimeoutSec: number;
  socketHeartbeatTimeoutSec: number;
  reconnectStormThreshold: number;
  recoveryCooldownSec: number;
  replayLimit: number;
  heartbeatCadenceSec: number;
  gpsUpdateCadenceSec: number;
}

interface OpsAlert {
  id: string;
  tripId: string;
  driverId: string | null;
  customerId: string | null;
  type: string;
  severity: "warning" | "critical";
  message: string;
  createdAt: string;
  recoveryAttempts: number;
}

interface OpsRide {
  tripId: string;
  refId: string;
  tripType: string;
  authoritativeStatus: string;
  phase: string;
  operationalState: string;
  vehicleName: string | null;
  pickupAddress: string | null;
  destinationAddress: string | null;
  trackingFreshnessSec: number | null;
  socketHeartbeatAgeSec: number | null;
  reconnectCount: number;
  frozenDurationSec: number | null;
  recoveryCount: number;
  waitingDurationSec: number | null;
  waitingCharge: number;
  customer: { id: string | null; name: string | null; phone: string | null };
  driver: { id: string | null; name: string | null; phone: string | null; isOnline: boolean | null };
  alerts: OpsAlert[];
}

interface SnapshotResponse {
  generatedAt: string;
  config: RealtimeOpsConfig;
  summary: {
    activeRideCount: number;
    searchingRideCount: number;
    reconnectingRideCount: number;
    recoveredRideCount: number;
    staleRideCount: number;
    frozenRideCount: number;
    unhealthyRideCount: number;
    alertCount: number;
  };
  rides: OpsRide[];
  alerts: OpsAlert[];
}

function KpiCard({ label, value, tone, icon }: { label: string; value: string | number; tone: string; icon: string }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #E2E8F0",
      borderRadius: 18,
      padding: "18px 20px",
      boxShadow: "0 10px 24px rgba(15,23,42,0.05)",
      minHeight: 110,
      display: "flex",
      alignItems: "center",
      gap: 14,
    }}>
      <div style={{
        width: 46,
        height: 46,
        borderRadius: 14,
        background: `${tone}18`,
        color: tone,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 21,
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 25, fontWeight: 900, color: "#0F172A", lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#64748B", marginTop: 4 }}>{label}</div>
      </div>
    </div>
  );
}

function formatAge(sec: number | null | undefined) {
  if (sec == null) return "n/a";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function stateTone(state: string) {
  if (state === "healthy") return { bg: "#ECFDF5", fg: "#059669", label: "Healthy" };
  if (state === "recovered") return { bg: "#EEF2FF", fg: "#4F46E5", label: "Recovered" };
  if (state === "reconnecting") return { bg: "#FFF7ED", fg: "#EA580C", label: "Reconnecting" };
  return { bg: "#FEF2F2", fg: "#DC2626", label: state.replace(/_/g, " ") };
}

function ForceCancelModal({
  ride,
  onClose,
  onConfirm,
  isPending,
}: {
  ride: OpsRide;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="modal-backdrop-jago">
      <div className="modal-jago" style={{ maxWidth: 480 }}>
        <div className="modal-jago-header">
          <h5 className="modal-jago-title">
            <i className="bi bi-exclamation-triangle-fill me-2" style={{ color: "#DC2626" }} />
            Force Cancel Ride
          </h5>
          <button className="modal-jago-close" onClick={onClose} disabled={isPending}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>
        <div className="p-4">
          <p style={{ fontSize: 13, color: "#334155" }}>
            This will immediately cancel trip <strong>{ride.refId || ride.tripId}</strong> and notify
            the customer and driver. This action cannot be undone.
          </p>
          <div className="mb-3">
            <label className="form-label small fw-semibold">Reason (optional)</label>
            <textarea
              className="form-control"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Admin force-cancelled trip"
              data-testid="input-force-cancel-reason"
            />
          </div>
          <div className="d-flex gap-2">
            <button
              className="btn btn-outline-secondary flex-fill"
              onClick={onClose}
              disabled={isPending}
              data-testid="btn-force-cancel-dismiss"
            >
              Dismiss
            </button>
            <button
              className="btn btn-danger flex-fill"
              onClick={() => onConfirm(reason)}
              disabled={isPending}
              data-testid="btn-force-cancel-confirm"
            >
              {isPending ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Cancelling...
                </>
              ) : (
                "Confirm Force Cancel"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RealtimeOpsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  // Force-cancel directly disrupts a live ride and triggers refund/fee logic -
  // restricted to ops.write holders per the Business Authorization Matrix.
  const canForceCancel = adminHasPermission(getSavedAdminSession().role, "ops.write");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<OpsRide | null>(null);
  const [form, setForm] = useState<RealtimeOpsConfig>({
    trackingFreshnessTimeoutSec: 25,
    frozenMovementTimeoutSec: 90,
    socketHeartbeatTimeoutSec: 40,
    reconnectStormThreshold: 4,
    recoveryCooldownSec: 45,
    replayLimit: 6,
    heartbeatCadenceSec: 15,
    gpsUpdateCadenceSec: 5,
  });

  const snapshotQuery = useQuery<SnapshotResponse>({
    queryKey: ["/api/admin/realtime-ops/bootstrap"],
    queryFn: () => adminFetch("/api/admin/realtime-ops/bootstrap").then(async (r) => {
      if (!r.ok) throw new Error("Realtime Ops bootstrap failed");
      return r.json();
    }),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const configQuery = useQuery<{ config: RealtimeOpsConfig }>({
    queryKey: ["/api/admin/realtime-ops/config"],
    queryFn: () => adminFetch("/api/admin/realtime-ops/config").then(async (r) => {
      if (!r.ok) throw new Error("Realtime Ops config failed");
      return r.json();
    }),
    refetchInterval: autoRefresh ? 20000 : false,
  });

  useEffect(() => {
    if (configQuery.data?.config) {
      setForm(configQuery.data.config);
    }
  }, [configQuery.data]);

  const forceCancelMut = useMutation({
    mutationFn: ({ tripId, reason }: { tripId: string; reason: string }) =>
      apiRequest("POST", `/api/admin/rides/${tripId}/force-cancel`, reason ? { reason } : undefined),
    onSuccess: () => {
      toast({ title: "Ride force-cancelled", description: "Customer and driver have been notified." });
      setCancelTarget(null);
      qc.invalidateQueries({ queryKey: ["/api/admin/realtime-ops/bootstrap"] });
      snapshotQuery.refetch();
    },
    onError: (error: any) => {
      toast({
        title: "Force cancel failed",
        description: error?.message || "This trip may no longer be cancellable.",
        variant: "destructive",
      });
    },
  });

  const summary = snapshotQuery.data?.summary;
  const rides = snapshotQuery.data?.rides ?? [];
  const alerts = snapshotQuery.data?.alerts ?? [];

  const topAlerts = useMemo(() => {
    return [...alerts]
      .sort((a, b) => {
        const severityScore = (value: string) => value === "critical" ? 2 : 1;
        return severityScore(b.severity) - severityScore(a.severity);
      })
      .slice(0, 8);
  }, [alerts]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, Number(value)]),
      );
      await apiRequest("PATCH", "/api/admin/realtime-ops/config", payload);
      await Promise.all([snapshotQuery.refetch(), configQuery.refetch()]);
      toast({
        title: "Realtime Ops updated",
        description: "Live runtime thresholds were saved successfully.",
      });
    } catch (e: any) {
      toast({
        title: "Save failed",
        description: e.message || "Could not save realtime ops configuration.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const generatedAt = snapshotQuery.data?.generatedAt
    ? new Date(snapshotQuery.data.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "n/a";

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 50, height: 50, borderRadius: 16,
              background: "linear-gradient(135deg,#0F172A,#2563EB)",
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
              boxShadow: "0 12px 28px rgba(37,99,235,0.28)",
            }}>
              <i className="bi bi-broadcast-pin" />
            </div>
            <div>
              <h4 style={{ margin: 0, fontWeight: 900, color: "#0F172A", letterSpacing: -0.4 }}>Realtime Ops</h4>
              <div style={{ fontSize: 13, color: "#64748B" }}>
                Live ride-tracking health, reconnect telemetry, recovery visibility, and ops controls.
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#64748B", fontWeight: 700 }}>
            Snapshot updated: {generatedAt}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#334155", fontWeight: 700 }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh
          </label>
          <button
            onClick={() => {
              snapshotQuery.refetch();
              configQuery.refetch();
            }}
            className="btn btn-sm btn-outline-primary"
            style={{ borderRadius: 10 }}
          >
            <i className="bi bi-arrow-clockwise me-1" />
            Refresh
          </button>
        </div>
      </div>

      {snapshotQuery.error && (
        <div style={{ marginBottom: 18, padding: 14, borderRadius: 14, background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", fontWeight: 700 }}>
          <i className="bi bi-exclamation-triangle-fill me-2" />
          {(snapshotQuery.error as Error).message}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 24 }}>
        <KpiCard label="Active Rides" value={summary?.activeRideCount ?? 0} tone="#2563EB" icon="🚕" />
        <KpiCard label="Searching" value={summary?.searchingRideCount ?? 0} tone="#F59E0B" icon="🔎" />
        <KpiCard label="Unhealthy" value={summary?.unhealthyRideCount ?? 0} tone="#DC2626" icon="⚠️" />
        <KpiCard label="Reconnecting" value={summary?.reconnectingRideCount ?? 0} tone="#EA580C" icon="📶" />
        <KpiCard label="Recovered" value={summary?.recoveredRideCount ?? 0} tone="#4F46E5" icon="🛟" />
        <KpiCard label="Live Alerts" value={summary?.alertCount ?? 0} tone="#BE123C" icon="🚨" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.55fr) minmax(340px, 0.95fr)", gap: 18, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ background: "#fff", borderRadius: 20, border: "1px solid #E2E8F0", boxShadow: "0 12px 28px rgba(15,23,42,0.05)", overflow: "hidden" }}>
            <div style={{ padding: "18px 20px", borderBottom: "1px solid #EEF2F7", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 900, color: "#0F172A", fontSize: 16 }}>Live Ride Watchlist</div>
                <div style={{ fontSize: 12, color: "#64748B" }}>Operational state, heartbeat freshness, reconnect loops, and stuck ride visibility.</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#64748B" }}>{rides.length} rides</div>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              {snapshotQuery.isLoading && !rides.length ? (
                <div style={{ padding: 36, textAlign: "center", color: "#64748B" }}>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Loading realtime operations snapshot...
                </div>
              ) : rides.length === 0 ? (
                <div style={{ padding: 36, textAlign: "center", color: "#64748B", fontWeight: 700 }}>
                  No active realtime rides right now.
                </div>
              ) : rides.map((ride) => {
                const tone = stateTone(ride.operationalState);
                return (
                  <div key={ride.tripId} style={{
                    border: "1px solid #E2E8F0",
                    borderRadius: 18,
                    padding: 16,
                    background: ride.operationalState === "healthy" ? "#fff" : "#FFFDFD",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 900, color: "#0F172A", fontSize: 15 }}>{ride.refId || ride.tripId}</span>
                          <span style={{ padding: "4px 10px", borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 900, textTransform: "capitalize" }}>
                            {tone.label}
                          </span>
                          <span style={{ padding: "4px 10px", borderRadius: 999, background: "#EFF6FF", color: "#1D4ED8", fontSize: 11, fontWeight: 800, textTransform: "capitalize" }}>
                            {ride.authoritativeStatus.replace(/_/g, " ")}
                          </span>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 12, color: "#64748B" }}>
                          {ride.tripType} • {ride.vehicleName || "Vehicle pending"}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", fontSize: 12, color: "#64748B", minWidth: 180 }}>
                        <div><strong style={{ color: "#0F172A" }}>Driver:</strong> {ride.driver.name || "Not assigned"}</div>
                        <div><strong style={{ color: "#0F172A" }}>Customer:</strong> {ride.customer.name || "Unknown"}</div>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 14 }}>
                      <div style={{ background: "#F8FAFC", borderRadius: 14, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, color: "#64748B", fontWeight: 800 }}>Tracking Freshness</div>
                        <div style={{ fontSize: 15, fontWeight: 900, color: "#0F172A" }}>{formatAge(ride.trackingFreshnessSec)}</div>
                      </div>
                      <div style={{ background: "#F8FAFC", borderRadius: 14, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, color: "#64748B", fontWeight: 800 }}>Socket Heartbeat</div>
                        <div style={{ fontSize: 15, fontWeight: 900, color: "#0F172A" }}>{formatAge(ride.socketHeartbeatAgeSec)}</div>
                      </div>
                      <div style={{ background: "#F8FAFC", borderRadius: 14, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, color: "#64748B", fontWeight: 800 }}>Reconnects</div>
                        <div style={{ fontSize: 15, fontWeight: 900, color: "#0F172A" }}>{ride.reconnectCount}</div>
                      </div>
                      <div style={{ background: "#F8FAFC", borderRadius: 14, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, color: "#64748B", fontWeight: 800 }}>Recoveries</div>
                        <div style={{ fontSize: 15, fontWeight: 900, color: "#0F172A" }}>{ride.recoveryCount}</div>
                      </div>
                      <div style={{ background: "#F8FAFC", borderRadius: 14, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, color: "#64748B", fontWeight: 800 }}>Frozen Duration</div>
                        <div style={{ fontSize: 15, fontWeight: 900, color: "#0F172A" }}>{formatAge(ride.frozenDurationSec)}</div>
                      </div>
                      <div style={{ background: "#F8FAFC", borderRadius: 14, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, color: "#64748B", fontWeight: 800 }}>Waiting Charge</div>
                        <div style={{ fontSize: 15, fontWeight: 900, color: "#0F172A" }}>Rs. {Number(ride.waitingCharge || 0).toFixed(2)}</div>
                      </div>
                    </div>

                    {canForceCancel && (
                      <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
                        <button
                          className="btn btn-sm btn-outline-danger"
                          style={{ borderRadius: 10, fontWeight: 700 }}
                          onClick={() => setCancelTarget(ride)}
                          data-testid={`btn-force-cancel-${ride.tripId}`}
                        >
                          <i className="bi bi-x-octagon me-1" />
                          Force Cancel
                        </button>
                      </div>
                    )}

                    {ride.alerts.length > 0 && (
                      <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
                        {ride.alerts.map((alert) => (
                          <div key={alert.id} style={{
                            padding: "10px 12px",
                            borderRadius: 12,
                            background: alert.severity === "critical" ? "#FEF2F2" : "#FFF7ED",
                            color: alert.severity === "critical" ? "#B91C1C" : "#C2410C",
                            fontSize: 12,
                            fontWeight: 700,
                          }}>
                            <i className={`bi ${alert.severity === "critical" ? "bi-exclamation-octagon-fill" : "bi-exclamation-triangle-fill"} me-2`} />
                            {alert.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ background: "#fff", borderRadius: 20, border: "1px solid #E2E8F0", boxShadow: "0 12px 28px rgba(15,23,42,0.05)", overflow: "hidden" }}>
            <div style={{ padding: "18px 20px", borderBottom: "1px solid #EEF2F7" }}>
              <div style={{ fontWeight: 900, color: "#0F172A", fontSize: 16 }}>Ops Threshold Control</div>
              <div style={{ fontSize: 12, color: "#64748B" }}>Tune stale tracking, reconnect, heartbeat, and recovery behavior.</div>
            </div>
            <div style={{ padding: 18, display: "grid", gap: 12 }}>
              {Object.entries(form).map(([key, value]) => (
                <label key={key} style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#334155" }}>
                    {key.replace(/([A-Z])/g, " $1").replace(/^./, (x) => x.toUpperCase())}
                  </span>
                  <input
                    type="number"
                    value={value}
                    onChange={(e) => setForm((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                    className="form-control"
                    style={{ borderRadius: 12, minHeight: 42 }}
                  />
                </label>
              ))}
              <button
                onClick={saveConfig}
                disabled={saving}
                className="btn btn-primary"
                style={{ borderRadius: 12, minHeight: 42, fontWeight: 800, marginTop: 4 }}
              >
                {saving ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <i className="bi bi-save me-2" />
                    Save Realtime Ops
                  </>
                )}
              </button>
            </div>
          </div>

          <div style={{ background: "#fff", borderRadius: 20, border: "1px solid #E2E8F0", boxShadow: "0 12px 28px rgba(15,23,42,0.05)", overflow: "hidden" }}>
            <div style={{ padding: "18px 20px", borderBottom: "1px solid #EEF2F7" }}>
              <div style={{ fontWeight: 900, color: "#0F172A", fontSize: 16 }}>Priority Alerts</div>
              <div style={{ fontSize: 12, color: "#64748B" }}>Critical and warning events from active rides.</div>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 10 }}>
              {!topAlerts.length ? (
                <div style={{ padding: 24, textAlign: "center", color: "#64748B", fontWeight: 700 }}>
                  No live alerts right now.
                </div>
              ) : topAlerts.map((alert) => (
                <div key={alert.id} style={{
                  borderRadius: 14,
                  padding: "12px 14px",
                  background: alert.severity === "critical" ? "#FEF2F2" : "#FFF7ED",
                  border: `1px solid ${alert.severity === "critical" ? "#FECACA" : "#FED7AA"}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", color: alert.severity === "critical" ? "#B91C1C" : "#C2410C" }}>
                      {alert.severity}
                    </span>
                    <span style={{ fontSize: 11, color: "#64748B", fontWeight: 700 }}>
                      {new Date(alert.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13, fontWeight: 800, color: "#0F172A" }}>{alert.message}</div>
                  <div style={{ marginTop: 5, fontSize: 11, color: "#64748B" }}>
                    Trip: {alert.tripId} • Recovery attempts: {alert.recoveryAttempts}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {cancelTarget && (
        <ForceCancelModal
          ride={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onConfirm={(reason) => forceCancelMut.mutate({ tripId: cancelTarget.tripId, reason })}
          isPending={forceCancelMut.isPending}
        />
      )}
    </div>
  );
}
