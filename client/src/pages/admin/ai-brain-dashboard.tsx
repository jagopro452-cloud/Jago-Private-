import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/queryClient";

interface BrainMetrics {
  rideRequestsLast5Min: number;
  parcelRequestsLast5Min: number;
  driversOnline: number;
  driversBusy: number;
  driversIdle: number;
  averageWaitTimeSec: number;
  cancellationRate: number;
  activeTrips: number;
  activeParcels: number;
}

interface ZoneDemand {
  zoneId: string;
  zoneName: string;
  lat: number;
  lng: number;
  demandLevel: "low" | "medium" | "high";
  demandRatio: number;
  requestCount: number;
  driverCount: number;
  surgeMultiplier: number;
}

interface SurgeZone {
  zoneId: string;
  zoneName: string;
  multiplier: number;
  reason: string;
}

interface DriverDist {
  zoneId: string;
  zoneName: string;
  online: number;
  busy: number;
  idle: number;
}

interface PredictedDemand {
  zoneId: string;
  zoneName: string;
  currentDemand: number;
  predictedNext30Min: number;
  trend: "rising" | "stable" | "falling";
}

const DEMAND_COLORS = { low: "#10B981", medium: "#F59E0B", high: "#EF4444" };
const TREND_ICONS = { rising: "↗️", stable: "→", falling: "↘️" };
const TREND_COLORS = { rising: "#EF4444", stable: "#6B7280", falling: "#10B981" };

export default function AIBrainDashboard() {
  const [metrics, setMetrics] = useState<BrainMetrics | null>(null);
  const [zones, setZones] = useState<ZoneDemand[]>([]);
  const [surgeZones, setSurgeZones] = useState<SurgeZone[]>([]);
  const [driverDist, setDriverDist] = useState<DriverDist[]>([]);
  const [predictions, setPredictions] = useState<PredictedDemand[]>([]);
  const [lastUpdate, setLastUpdate] = useState<string>("");

  // Fetch AI dashboard data
  const { data: dashData, isLoading } = useQuery({
    queryKey: ["/api/admin/ai-brain/dashboard"],
    queryFn: async () => {
      const r = await adminFetch("/api/admin/ai-brain/dashboard");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 10000, // Every 10 seconds to match brain tick
  });

  useEffect(() => {
    if (!dashData?.metrics) return;
    const m = dashData.metrics;
    setMetrics({
      rideRequestsLast5Min: m.rideRequestsLast5Min ?? 0,
      parcelRequestsLast5Min: m.parcelRequestsLast5Min ?? 0,
      driversOnline: m.driversOnline ?? 0,
      driversBusy: m.driversBusy ?? 0,
      driversIdle: m.driversIdle ?? 0,
      averageWaitTimeSec: m.averageWaitTimeSec ?? 0,
      cancellationRate: m.cancellationRate ?? 0,
      activeTrips: m.activeTrips ?? 0,
      activeParcels: m.activeParcels ?? 0,
    });
    setZones(m.zoneDemand ?? []);
    setSurgeZones(m.surgeZones ?? []);
    setDriverDist(m.driverDistribution ?? []);
    setPredictions(m.predictedDemand ?? []);
    setLastUpdate(m.timestamp ?? new Date().toISOString());
  }, [dashData]);

  const brainStatus = dashData?.brainStatus;

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1400 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: "linear-gradient(135deg,#7C3AED,#4F46E5)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 20px rgba(124,58,237,0.4)" }}>
            <span style={{ fontSize: 28 }}>🧠</span>
          </div>
          <div>
            <h4 style={{ fontWeight: 800, margin: 0, letterSpacing: -0.3, fontSize: 22 }}>AI Mobility Brain</h4>
            <p style={{ margin: 0, fontSize: 13, color: "#6B7280" }}>Real-time platform intelligence — updates every 10 seconds</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ background: brainStatus?.running ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: brainStatus?.running ? "#10B981" : "#EF4444", padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: brainStatus?.running ? "#10B981" : "#EF4444", animation: brainStatus?.running ? "pulse 2s infinite" : "none" }} />
            {brainStatus?.running ? "Brain Active" : "Brain Inactive"}
          </div>
          {lastUpdate && (
            <span style={{ fontSize: 11, color: "#9CA3AF" }}>
              Updated: {new Date(lastUpdate).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {isLoading && !metrics ? (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div className="spinner-border" style={{ color: "#7C3AED" }} />
          <p style={{ marginTop: 12, color: "#6B7280" }}>Loading AI Brain data...</p>
        </div>
      ) : (
        <>
          {/* ── REAL-TIME METRICS CARDS ─────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 24 }}>
            <MetricCard label="Ride Requests (5m)" value={metrics?.rideRequestsLast5Min ?? 0} icon="🚗" color="#2F7BFF" />
            <MetricCard label="Parcel Requests (5m)" value={metrics?.parcelRequestsLast5Min ?? 0} icon="📦" color="#FF6B35" />
            <MetricCard label="Drivers Online" value={metrics?.driversOnline ?? 0} icon="🟢" color="#10B981" />
            <MetricCard label="Drivers Busy" value={metrics?.driversBusy ?? 0} icon="🔴" color="#EF4444" />
            <MetricCard label="Drivers Idle" value={metrics?.driversIdle ?? 0} icon="🟡" color="#F59E0B" />
            <MetricCard label="Active Trips" value={metrics?.activeTrips ?? 0} icon="🛣️" color="#8B5CF6" />
            <MetricCard label="Active Parcels" value={metrics?.activeParcels ?? 0} icon="📦" color="#06B6D4" />
            <MetricCard label="Avg Wait Time" value={`${metrics?.averageWaitTimeSec ?? 0}s`} icon="⏱️" color="#6366F1" />
            <MetricCard label="Cancel Rate" value={`${metrics?.cancellationRate ?? 0}%`} icon="❌" color="#EF4444" />
          </div>

          {/* ── DEMAND HEATMAP & SURGE ZONES ───────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
            {/* Demand Heatmap */}
            <div style={{ background: "#fff", borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", border: "1px solid #E5E7EB" }}>
              <div style={{ background: "linear-gradient(135deg,#060D1E,#0D1B3E)", padding: "16px 20px" }}>
                <div style={{ fontWeight: 800, color: "#fff", fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                  🗺️ Demand Heatmap
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>
                    {zones.length} zones
                  </span>
                </div>
              </div>
              <div style={{ padding: 16, maxHeight: 400, overflowY: "auto" }}>
                {zones.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 30, color: "#9CA3AF" }}>No zone data yet</div>
                ) : zones.map(z => (
                  <div key={z.zoneId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, marginBottom: 6, background: `${DEMAND_COLORS[z.demandLevel]}08`, border: `1px solid ${DEMAND_COLORS[z.demandLevel]}20` }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: DEMAND_COLORS[z.demandLevel], flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{z.zoneName}</div>
                      <div style={{ fontSize: 11, color: "#6B7280" }}>
                        {z.requestCount} requests · {z.driverCount} drivers
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: DEMAND_COLORS[z.demandLevel] }}>
                        {z.demandRatio.toFixed(1)}x
                      </div>
                      <div style={{ fontSize: 10, color: "#9CA3AF", textTransform: "uppercase" }}>{z.demandLevel}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Surge Zones */}
            <div style={{ background: "#fff", borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", border: "1px solid #E5E7EB" }}>
              <div style={{ background: "linear-gradient(135deg,#7C3AED,#4F46E5)", padding: "16px 20px" }}>
                <div style={{ fontWeight: 800, color: "#fff", fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                  ⚡ Active Surge Zones
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>
                    {surgeZones.length} zones
                  </span>
                </div>
              </div>
              <div style={{ padding: 16, maxHeight: 400, overflowY: "auto" }}>
                {surgeZones.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 30, color: "#9CA3AF" }}>No surge active — normal pricing</div>
                ) : surgeZones.map(s => (
                  <div key={s.zoneId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, marginBottom: 8, background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.15)" }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(135deg,#7C3AED,#4F46E5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: 16 }}>
                      {s.multiplier.toFixed(1)}x
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{s.zoneName}</div>
                      <div style={{ fontSize: 12, color: "#7C3AED" }}>{s.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── DRIVER DISTRIBUTION & PREDICTED DEMAND ─────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* Driver Distribution */}
            <div style={{ background: "#fff", borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", border: "1px solid #E5E7EB" }}>
              <div style={{ background: "linear-gradient(135deg,#10B981,#059669)", padding: "16px 20px" }}>
                <div style={{ fontWeight: 800, color: "#fff", fontSize: 16 }}>👥 Driver Distribution</div>
              </div>
              <div style={{ padding: 16, maxHeight: 380, overflowY: "auto" }}>
                {driverDist.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 30, color: "#9CA3AF" }}>No driver data</div>
                ) : driverDist.map(d => (
                  <div key={d.zoneId} style={{ padding: "10px 12px", borderRadius: 10, marginBottom: 6, background: "#F9FAFB", border: "1px solid #F3F4F6" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{d.zoneName}</div>
                    <div style={{ display: "flex", gap: 12 }}>
                      <span style={{ fontSize: 11, color: "#10B981" }}>🟢 {d.online} online</span>
                      <span style={{ fontSize: 11, color: "#EF4444" }}>🔴 {d.busy} busy</span>
                      <span style={{ fontSize: 11, color: "#F59E0B" }}>🟡 {d.idle} idle</span>
                    </div>
                    {d.online > 0 && (
                      <div style={{ marginTop: 6, height: 6, borderRadius: 3, background: "#E5E7EB", overflow: "hidden" }}>
                        <div style={{ display: "flex", height: "100%" }}>
                          <div style={{ width: `${(d.busy / d.online) * 100}%`, background: "#EF4444" }} />
                          <div style={{ width: `${(d.idle / d.online) * 100}%`, background: "#10B981" }} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Predicted Demand */}
            <div style={{ background: "#fff", borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", border: "1px solid #E5E7EB" }}>
              <div style={{ background: "linear-gradient(135deg,#F59E0B,#D97706)", padding: "16px 20px" }}>
                <div style={{ fontWeight: 800, color: "#fff", fontSize: 16 }}>📈 Predicted Demand (30 min)</div>
              </div>
              <div style={{ padding: 16, maxHeight: 380, overflowY: "auto" }}>
                {predictions.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 30, color: "#9CA3AF" }}>Collecting data...</div>
                ) : predictions.map(p => (
                  <div key={p.zoneId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, marginBottom: 6, background: "#FFFBEB", border: "1px solid rgba(245,158,11,0.15)" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{p.zoneName}</div>
                      <div style={{ fontSize: 11, color: "#6B7280" }}>
                        Current: {p.currentDemand} → Predicted: {p.predictedNext30Min}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, color: TREND_COLORS[p.trend], fontWeight: 700, fontSize: 14 }}>
                      {TREND_ICONS[p.trend]} {p.trend}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function MetricCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: "16px 18px", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", border: "1px solid #F3F4F6", transition: "all .2s" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, animation: "pulse 3s infinite" }} />
      </div>
      <div style={{ fontWeight: 900, fontSize: 24, color, marginBottom: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600 }}>{label}</div>
    </div>
  );
}
