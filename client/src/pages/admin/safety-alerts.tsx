import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  active:       { cls: "bg-danger text-white",  label: "🔴 Active SOS" },
  acknowledged: { cls: "bg-warning text-dark",  label: "🟡 Acknowledged" },
  resolved:     { cls: "bg-success text-white",  label: "✅ Resolved" },
};

const ALERT_ICON: Record<string, string> = {
  sos:        "bi-exclamation-octagon-fill text-danger",
  accident:   "bi-car-front-fill text-warning",
  harassment: "bi-person-exclamation text-danger",
  other:      "bi-bell-fill text-secondary",
};

function timeAgo(ts: string) {
  if (!ts) return "—";
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString("en-IN");
}

export default function SafetyAlertsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<"all" | "active" | "acknowledged" | "resolved">("all");
  const [triggeredBy, setTriggeredBy] = useState<"all" | "customer" | "driver">("all");
  const [activeTab, setActiveTab] = useState<"alerts" | "police" | "matching">("alerts");
  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const [resolveModal, setResolveModal] = useState<any>(null);
  const [resolveNotes, setResolveNotes] = useState("");
  const [policeNotified, setPoliceNotified] = useState(false);

  const { data: alerts = [], isLoading: alertsLoading } = useQuery<any[]>({
    queryKey: ["/api/safety-alerts", filter, triggeredBy],
    queryFn: () => adminFetch(`/api/safety-alerts?status=${filter}&triggered_by=${triggeredBy}`)
      .then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
    refetchInterval: 15000,
  });

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/safety-alerts/stats"],
    queryFn: () => adminFetch("/api/safety-alerts/stats").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => (d && !d.message && !d.error) ? d : {}),
    refetchInterval: 15000,
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/safety-alerts/${id}/acknowledge`, { adminName: "Admin" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/safety-alerts"] });
      qc.invalidateQueries({ queryKey: ["/api/safety-alerts/stats"] });
      toast({ title: "Alert acknowledged" });
    },
  });

  const resolve = useMutation({
    mutationFn: ({ id, notes, policeNotified }: any) =>
      apiRequest("PATCH", `/api/safety-alerts/${id}/resolve`, { notes, policeNotified }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/safety-alerts"] });
      qc.invalidateQueries({ queryKey: ["/api/safety-alerts/stats"] });
      toast({ title: "Alert resolved" });
      setResolveModal(null);
      setResolveNotes("");
      setPoliceNotified(false);
    },
  });

  const { data: stations = [], isLoading: stationsLoading } = useQuery<any[]>({
    queryKey: ["/api/police-stations"],
    enabled: activeTab === "police",
    queryFn: () => adminFetch("/api/police-stations").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
  });
  const { data: zones = [] } = useQuery<any[]>({ queryKey: ["/api/zones"] });

  const [stationModal, setStationModal] = useState(false);
  const [editingStation, setEditingStation] = useState<any>(null);
  const [stationForm, setStationForm] = useState({ name: "", zoneId: "", address: "", phone: "", latitude: "", longitude: "" });

  const saveStation = useMutation({
    mutationFn: (d: any) => editingStation
      ? apiRequest("PUT", `/api/police-stations/${editingStation.id}`, d)
      : apiRequest("POST", "/api/police-stations", d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/police-stations"] });
      toast({ title: editingStation ? "Station updated" : "Station added" });
      setStationModal(false);
      setEditingStation(null);
    },
  });

  const deleteStation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/police-stations/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/police-stations"] }); toast({ title: "Station deleted" }); },
  });

  const { data: matchingData } = useQuery<any>({
    queryKey: ["/api/matching/stats"],
    enabled: activeTab === "matching",
    queryFn: () => adminFetch("/api/matching/stats").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => (d && !d.message && !d.error) ? d : { stats: {}, settings: {} }),
  });

  const saveSetting = useMutation({
    mutationFn: (d: { keyName: string; value: string }) =>
      apiRequest("POST", "/api/business-pages", { ...d, settingsType: "safety_settings" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/matching/stats"] });
      toast({ title: "Setting saved" });
    },
  });

  const matchSettings = matchingData?.settings || {};
  const matchStats = matchingData?.stats || {};

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
            <div>
              <h2 className="h5 mb-1">Safety & Emergency Management</h2>
              <p className="text-muted mb-0" style={{ fontSize: "0.8rem" }}>SOS alerts, police stations, and driver matching algorithms</p>
            </div>
            {(stats?.activeCount || 0) > 0 && (
              <div className="alert alert-danger d-flex align-items-center gap-2 mb-0 py-2 px-3" style={{ fontSize: "0.85rem" }}>
                <i className="bi bi-exclamation-triangle-fill fs-5"></i>
                <strong>{stats.activeCount} Active SOS</strong> — immediate action required!
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="container-fluid">
        {/* Stats Row */}
        <div className="row g-3 mb-4">
          {[
            { label: "Active SOS", value: stats?.activeCount || 0, icon: "bi-exclamation-octagon-fill", color: "#dc2626", bg: "#fef2f2" },
            { label: "Acknowledged", value: stats?.acknowledgedCount || 0, icon: "bi-eye-fill", color: "#d97706", bg: "#fffbeb" },
            { label: "Today's Alerts", value: stats?.todayCount || 0, icon: "bi-calendar-day", color: "#7c3aed", bg: "#f5f3ff" },
            { label: "Total Resolved", value: stats?.resolvedCount || 0, icon: "bi-shield-fill-check", color: "#16a34a", bg: "#f0fdf4" },
          ].map(s => (
            <div key={s.label} className="col-6 col-md-3">
              <div className="card border-0 h-100" style={{ background: s.bg }}>
                <div className="card-body py-3 d-flex align-items-center gap-3">
                  <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: s.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className={`bi ${s.icon} text-white fs-5`}></i>
                  </div>
                  <div>
                    <div style={{ fontSize: "1.6rem", fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{s.label}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Main Tabs Card */}
        <div className="card">
          <div className="card-header border-bottom py-2 px-3">
            <ul className="nav nav--tabs p-1 rounded bg-white">
              {[
                { id: "alerts", label: "SOS Alerts", icon: "bi-exclamation-octagon" },
                { id: "police", label: "Police Stations", icon: "bi-building" },
                { id: "matching", label: "Matching Algorithm", icon: "bi-diagram-3" },
              ].map(t => (
                <li key={t.id} className="nav-item">
                  <button
                    className={`nav-link d-flex align-items-center gap-1${activeTab === t.id ? " active" : ""}`}
                    onClick={() => setActiveTab(t.id as any)}
                    data-testid={`tab-${t.id}`}
                  >
                    <i className={`bi ${t.icon}`}></i>
                    {t.label}
                    {t.id === "alerts" && (stats?.activeCount || 0) > 0 && (
                      <span className="badge bg-danger ms-1">{stats.activeCount}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="card-body p-0">

            {/* ══ SOS ALERTS ══ */}
            {activeTab === "alerts" && (
              <div>
                <div className="d-flex flex-wrap gap-2 align-items-center p-3 border-bottom" style={{ background: "#f8fafc" }}>
                  <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#64748b" }}>Status:</span>
                  {(["all", "active", "acknowledged", "resolved"] as const).map(s => (
                    <button key={s} className={`btn btn-sm ${filter === s ? "btn-primary" : "btn-outline-secondary"}`}
                      style={{ fontSize: "0.78rem" }}
                      onClick={() => setFilter(s)} data-testid={`filter-${s}`}>
                      {s === "all" ? "All" : STATUS_BADGE[s]?.label || s}
                    </button>
                  ))}
                  <span className="ms-3" style={{ fontSize: "0.8rem", fontWeight: 600, color: "#64748b" }}>By:</span>
                  {(["all", "customer", "driver"] as const).map(s => (
                    <button key={s} className={`btn btn-sm ${triggeredBy === s ? "btn-primary" : "btn-outline-secondary"}`}
                      style={{ fontSize: "0.78rem" }}
                      onClick={() => setTriggeredBy(s)} data-testid={`filter-by-${s}`}>
                      {s === "all" ? "Everyone" : s === "customer" ? "🧑 Customer" : "🚗 Driver"}
                    </button>
                  ))}
                  <div className="ms-auto text-muted" style={{ fontSize: "0.72rem" }}>
                    <i className="bi bi-arrow-clockwise me-1"></i>Auto-refreshes every 15s
                  </div>
                </div>

                {alertsLoading ? (
                  <div className="d-flex justify-content-center py-5">
                    <div className="spinner-border text-danger"></div>
                  </div>
                ) : alerts.length === 0 ? (
                  <div className="d-flex flex-column align-items-center py-5 text-muted">
                    <i className="bi bi-shield-fill-check" style={{ fontSize: "3rem", opacity: 0.25 }}></i>
                    <p className="mt-2 mb-0">No alerts found</p>
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-borderless align-middle table-hover mb-0">
                      <thead className="table-light align-middle" style={{ fontSize: "0.78rem" }}>
                        <tr>
                          <th>#</th>
                          <th>User</th>
                          <th>Alert</th>
                          <th>Location</th>
                          <th>Notified</th>
                          <th>Status</th>
                          <th>Time</th>
                          <th className="text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody style={{ fontSize: "0.82rem" }}>
                        {alerts.map((a: any, idx: number) => (
                          <tr key={a.id} data-testid={`alert-row-${a.id}`}
                            style={{ background: a.status === "active" ? "#fff5f5" : undefined }}>
                            <td className="text-muted">{idx + 1}</td>
                            <td>
                              <div className="fw-semibold">{a.userName || "Unknown"}</div>
                              <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                                {a.userPhone || "—"}
                                <span className="ms-1 badge" style={{ background: a.triggeredBy === "driver" ? "#dbeafe" : "#dcfce7", color: a.triggeredBy === "driver" ? "#1E5FCC" : "#15803d", fontSize: "0.65rem" }}>
                                  {a.triggeredBy === "driver" ? "🚗 Driver" : "🧑 Customer"}
                                </span>
                                {a.gender === "female" && <span className="ms-1 badge" style={{ background: "#fce7f3", color: "#be185d", fontSize: "0.65rem" }}>♀</span>}
                              </div>
                            </td>
                            <td>
                              <div className="d-flex align-items-center gap-1">
                                <i className={`bi ${ALERT_ICON[a.alertType] || "bi-bell-fill"}`}></i>
                                <span className="text-capitalize">{a.alertType}</span>
                              </div>
                            </td>
                            <td>
                              <div style={{ fontSize: "0.78rem", maxWidth: "170px" }}>
                                {a.locationAddress || "—"}
                                {a.latitude && (
                                  <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>
                                    {Number(a.latitude).toFixed(4)}°, {Number(a.longitude).toFixed(4)}°
                                  </div>
                                )}
                              </div>
                            </td>
                            <td>
                              <div style={{ fontSize: "0.78rem" }}>
                                <i className="bi bi-person-fill text-primary me-1"></i>{a.nearbyDriversNotified || 0} drivers
                              </div>
                              {a.policeNotified && (
                                <div className="text-success" style={{ fontSize: "0.7rem" }}>
                                  <i className="bi bi-shield-fill-check me-1"></i>Police
                                </div>
                              )}
                            </td>
                            <td>
                              <span className={`badge ${STATUS_BADGE[a.status]?.cls || "bg-secondary text-white"}`} style={{ fontSize: "0.7rem" }}>
                                {STATUS_BADGE[a.status]?.label || a.status}
                              </span>
                              {a.acknowledgedByName && (
                                <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>by {a.acknowledgedByName}</div>
                              )}
                            </td>
                            <td style={{ fontSize: "0.75rem", color: "#64748b" }}>{timeAgo(a.createdAt)}</td>
                            <td>
                              <div className="d-flex justify-content-center gap-1">
                                <button className="btn btn-sm btn-outline-secondary" title="View details"
                                  onClick={() => setSelectedAlert(a)} data-testid={`btn-view-${a.id}`}>
                                  <i className="bi bi-eye"></i>
                                </button>
                                {a.status === "active" && (
                                  <button className="btn btn-sm btn-warning" title="Acknowledge"
                                    onClick={() => acknowledge.mutate(a.id)} disabled={acknowledge.isPending}
                                    data-testid={`btn-ack-${a.id}`}>
                                    <i className="bi bi-check-lg"></i>
                                  </button>
                                )}
                                {a.status !== "resolved" && (
                                  <button className="btn btn-sm btn-success" title="Resolve"
                                    onClick={() => setResolveModal(a)} data-testid={`btn-resolve-${a.id}`}>
                                    <i className="bi bi-shield-fill-check"></i>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ══ POLICE STATIONS ══ */}
            {activeTab === "police" && (
              <div className="p-3">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <div>
                    <h6 className="fw-bold mb-1">Police Stations</h6>
                    <p className="text-muted mb-0" style={{ fontSize: "0.8rem" }}>Stations notified automatically during SOS events</p>
                  </div>
                  <button className="btn btn-primary btn-sm"
                    onClick={() => { setEditingStation(null); setStationForm({ name: "", zoneId: "", address: "", phone: "", latitude: "", longitude: "" }); setStationModal(true); }}
                    data-testid="btn-add-station">
                    <i className="bi bi-plus-circle me-1"></i> Add Station
                  </button>
                </div>

                {/* Emergency hotlines */}
                <div className="card border-0 mb-4" style={{ background: "#eff6ff" }}>
                  <div className="card-body py-2 px-3">
                    <div className="d-flex flex-wrap gap-3 align-items-center">
                      <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#1E5FCC" }}>
                        <i className="bi bi-telephone-fill me-1"></i>National Emergency:
                      </span>
                      {[["Police", "100"], ["Ambulance", "108"], ["Women Helpline", "1091"], ["Fire", "101"]].map(([lbl, num]) => (
                        <span key={lbl} className="badge" style={{ background: "#dbeafe", color: "#1E5FCC", fontSize: "0.78rem" }}>
                          {lbl}: <strong>{num}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="row g-3">
                  {stationsLoading ? (
                    Array(4).fill(0).map((_, i) => (
                      <div key={i} className="col-md-6"><div className="card"><div className="card-body" style={{ height: "110px", background: "#f1f5f9", borderRadius: "8px" }}></div></div></div>
                    ))
                  ) : stations.length === 0 ? (
                    <div className="col-12 text-center py-5 text-muted">
                      <i className="bi bi-building" style={{ fontSize: "2rem", opacity: 0.3 }}></i>
                      <p className="mt-2">No police stations added yet</p>
                    </div>
                  ) : stations.map((s: any) => (
                    <div key={s.id} className="col-md-6" data-testid={`station-card-${s.id}`}>
                      <div className="card border h-100">
                        <div className="card-body p-3">
                          <div className="d-flex justify-content-between align-items-start mb-2">
                            <div className="d-flex align-items-center gap-2">
                              <div style={{ width: "38px", height: "38px", borderRadius: "8px", background: "#1E5FCC", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <i className="bi bi-building text-white"></i>
                              </div>
                              <div>
                                <div className="fw-semibold" style={{ fontSize: "0.87rem" }}>{s.name}</div>
                                {s.zoneName && <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>{s.zoneName}</div>}
                              </div>
                            </div>
                            <div className="d-flex gap-1">
                              <button className="btn btn-sm btn-outline-primary" onClick={() => { setEditingStation(s); setStationForm({ name: s.name, zoneId: s.zoneId || "", address: s.address || "", phone: s.phone || "", latitude: s.latitude || "", longitude: s.longitude || "" }); setStationModal(true); }} data-testid={`btn-edit-station-${s.id}`}><i className="bi bi-pencil"></i></button>
                              <button className="btn btn-sm btn-outline-danger" onClick={async () => { if (await adminConfirm("Delete this station?")) deleteStation.mutate(s.id); }} data-testid={`btn-del-station-${s.id}`}><i className="bi bi-trash"></i></button>
                            </div>
                          </div>
                          {s.address && <div style={{ fontSize: "0.78rem", color: "#64748b" }}><i className="bi bi-geo-alt me-1"></i>{s.address}</div>}
                          {s.phone && (
                            <a href={`tel:${s.phone}`} className="btn btn-sm btn-outline-success mt-2 d-inline-flex align-items-center gap-1" style={{ fontSize: "0.78rem" }}>
                              <i className="bi bi-telephone-fill"></i>{s.phone}
                            </a>
                          )}
                          {s.latitude && (
                            <a href={`https://maps.google.com/?q=${s.latitude},${s.longitude}`} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-secondary ms-2 mt-2" style={{ fontSize: "0.75rem" }}>
                              <i className="bi bi-map me-1"></i>Maps
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ MATCHING ALGORITHM ══ */}
            {activeTab === "matching" && (
              <div className="p-4">
                <h6 className="fw-bold mb-1">Driver Matching Algorithm</h6>
                <p className="text-muted mb-4" style={{ fontSize: "0.82rem" }}>
                  Configure how drivers are matched to customer requests based on gender and vehicle type
                </p>

                <div className="row g-4">
                  <div className="col-md-5">
                    <div className="card border-0" style={{ background: "#f8fafc" }}>
                      <div className="card-body">
                        <h6 className="fw-bold mb-3" style={{ fontSize: "0.87rem" }}>Platform Stats</h6>
                        {[
                          { label: "Female Drivers", value: matchStats.femaleDrivers || 0, color: "#be185d", bg: "#fce7f3" },
                          { label: "Male Drivers", value: matchStats.maleDrivers || 0, color: "#1E5FCC", bg: "#dbeafe" },
                          { label: "Female Customers", value: matchStats.femaleCustomers || 0, color: "#be185d", bg: "#fce7f3" },
                          { label: "Prefer Female Driver", value: matchStats.preferFemaleCustomers || 0, color: "#7c3aed", bg: "#ede9fe" },
                        ].map(s => (
                          <div key={s.label} className="d-flex align-items-center justify-content-between p-2 rounded mb-2" style={{ background: s.bg }}>
                            <span style={{ fontSize: "0.82rem" }}>{s.label}</span>
                            <span className="fw-bold" style={{ color: s.color }}>{s.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="col-md-7">
                    <div className="card border">
                      <div className="card-body">
                        <h6 className="fw-bold mb-3" style={{ fontSize: "0.87rem" }}>Matching Rules</h6>

                        {/* Female-to-Female */}
                        <div className="p-3 rounded mb-3" style={{ background: "#fff0f7", border: "1px solid #fce7f3" }}>
                          <div className="d-flex align-items-start justify-content-between gap-3">
                            <div className="flex-grow-1">
                              <div className="fw-semibold mb-1" style={{ fontSize: "0.87rem", color: "#be185d" }}>
                                <i className="bi bi-gender-female me-2"></i>Female-to-Female Priority
                              </div>
                              <p className="mb-2" style={{ fontSize: "0.78rem", color: "#64748b" }}>
                                Female customers see female drivers first. After all female drivers are matched, male drivers are offered. Vehicle type still matches (bike→bike, auto→auto, car→car).
                              </p>
                              <div className="p-2 rounded" style={{ background: "#fce7f3", fontSize: "0.75rem", color: "#be185d" }}>
                                <strong>Algorithm:</strong> Filter by vehicle type → Sort female drivers first → Then male drivers → Rank by rating
                              </div>
                            </div>
                            <div className="form-check form-switch mt-1" style={{ flexShrink: 0 }}>
                              <input className="form-check-input" type="checkbox"
                                checked={matchSettings['female_to_female_matching'] === '1'}
                                onChange={e => saveSetting.mutate({ keyName: 'female_to_female_matching', value: e.target.checked ? '1' : '0' })}
                                data-testid="toggle-female-matching"
                                style={{ width: "2.5rem", height: "1.3rem" }} />
                            </div>
                          </div>
                        </div>

                        {/* Vehicle-Type Matching */}
                        <div className="p-3 rounded mb-3" style={{ background: "#eff6ff", border: "1px solid #dbeafe" }}>
                          <div className="d-flex align-items-start justify-content-between gap-3">
                            <div className="flex-grow-1">
                              <div className="fw-semibold mb-1" style={{ fontSize: "0.87rem", color: "#1E5FCC" }}>
                                <i className="bi bi-car-front me-2"></i>Vehicle-Type Priority Matching
                              </div>
                              <p className="mb-2" style={{ fontSize: "0.78rem", color: "#64748b" }}>
                                Bike booking → Bike drivers first. Auto booking → Auto drivers. Car/SUV → Car drivers. Ensures right vehicle type is dispatched.
                              </p>
                              <div className="d-flex gap-1 flex-wrap">
                                {[["🚲 Bike→Bike", "#dbeafe", "#1E5FCC"], ["🛺 Auto→Auto", "#dcfce7", "#15803d"], ["🚗 Car→Car", "#fef3c7", "#b45309"], ["🚐 SUV→SUV", "#ede9fe", "#7c3aed"], ["⚡ Temo→Temo", "#f0fdf4", "#16a34a"]].map(([t, bg, c]) => (
                                  <span key={t} className="badge" style={{ background: bg, color: c, fontSize: "0.7rem" }}>{t}</span>
                                ))}
                              </div>
                            </div>
                            <div className="form-check form-switch mt-1" style={{ flexShrink: 0 }}>
                              <input className="form-check-input" type="checkbox"
                                checked={matchSettings['vehicle_type_matching'] === '1'}
                                onChange={e => saveSetting.mutate({ keyName: 'vehicle_type_matching', value: e.target.checked ? '1' : '0' })}
                                data-testid="toggle-vehicle-matching"
                                style={{ width: "2.5rem", height: "1.3rem" }} />
                            </div>
                          </div>
                        </div>

                        {/* SOS Radius */}
                        <div className="mb-4">
                          <label className="fw-semibold d-block mb-1" style={{ fontSize: "0.85rem" }}>
                            <i className="bi bi-broadcast text-danger me-2"></i>SOS Notification Radius
                          </label>
                          <div className="d-flex gap-2 align-items-center">
                            <input type="number" className="form-control form-control-sm" style={{ maxWidth: "90px" }}
                              defaultValue={matchSettings['sos_notify_nearby_km'] || "3"}
                              onBlur={e => saveSetting.mutate({ keyName: 'sos_notify_nearby_km', value: e.target.value })}
                              data-testid="input-sos-radius" />
                            <span style={{ fontSize: "0.82rem", color: "#64748b" }}>km — alert all online drivers within this radius during SOS</span>
                          </div>
                        </div>

                        {/* Emergency Numbers */}
                        <h6 className="fw-semibold mb-3" style={{ fontSize: "0.85rem" }}>
                          <i className="bi bi-telephone-fill text-danger me-2"></i>Emergency Contact Numbers
                        </h6>
                        {[
                          { key: "emergency_number", label: "Police", icon: "bi-shield-fill", color: "#1E5FCC" },
                          { key: "ambulance_number", label: "Ambulance", icon: "bi-heart-pulse-fill", color: "#dc2626" },
                          { key: "women_helpline", label: "Women Helpline", icon: "bi-person-fill", color: "#be185d" },
                          { key: "company_sos_phone", label: "Company SOS", icon: "bi-building", color: "#7c3aed" },
                        ].map(f => (
                          <div key={f.key} className="d-flex align-items-center gap-3 mb-2">
                            <i className={`bi ${f.icon}`} style={{ color: f.color, width: "16px" }}></i>
                            <label className="mb-0" style={{ fontSize: "0.82rem", minWidth: "130px" }}>{f.label}</label>
                            <input type="text" className="form-control form-control-sm" style={{ maxWidth: "150px" }}
                              defaultValue={matchSettings[f.key] || ""}
                              onBlur={e => saveSetting.mutate({ keyName: f.key, value: e.target.value })}
                              data-testid={`input-${f.key}`} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Alert Detail Modal */}
      {selectedAlert && (
        <div className="modal-backdrop-jago" onClick={() => setSelectedAlert(null)}>
          <div className="modal-jago" style={{ maxWidth: "540px" }} onClick={e => e.stopPropagation()}>
            <div className="modal-jago-header">
              <h5 className="modal-jago-title d-flex align-items-center gap-2">
                <i className={`bi ${ALERT_ICON[selectedAlert.alertType] || "bi-bell-fill"}`}></i>
                SOS Alert Detail
              </h5>
              <button className="modal-jago-close" onClick={() => setSelectedAlert(null)}><i className="bi bi-x-lg"></i></button>
            </div>
            <div className="d-flex flex-column gap-3" style={{ fontSize: "0.85rem" }}>
              <div className="row g-3">
                <div className="col-6">
                  <div className="text-muted mb-1" style={{ fontSize: "0.75rem" }}>User</div>
                  <div className="fw-semibold">{selectedAlert.userName || "Unknown"}</div>
                  <div className="text-muted">{selectedAlert.userPhone || "—"}</div>
                </div>
                <div className="col-6">
                  <div className="text-muted mb-1" style={{ fontSize: "0.75rem" }}>Alert Type</div>
                  <div className="text-capitalize fw-semibold">{selectedAlert.alertType}</div>
                  <div className="text-muted text-capitalize">{selectedAlert.triggeredBy} triggered</div>
                </div>
                <div className="col-6">
                  <div className="text-muted mb-1" style={{ fontSize: "0.75rem" }}>Status</div>
                  <span className={`badge ${STATUS_BADGE[selectedAlert.status]?.cls || "bg-secondary"}`}>
                    {STATUS_BADGE[selectedAlert.status]?.label || selectedAlert.status}
                  </span>
                </div>
                <div className="col-6">
                  <div className="text-muted mb-1" style={{ fontSize: "0.75rem" }}>Time</div>
                  <div>{new Date(selectedAlert.createdAt).toLocaleString("en-IN")}</div>
                </div>
                <div className="col-12">
                  <div className="text-muted mb-1" style={{ fontSize: "0.75rem" }}>Location</div>
                  <div>{selectedAlert.locationAddress || "Location not available"}</div>
                  {selectedAlert.latitude && (
                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                      GPS: {Number(selectedAlert.latitude).toFixed(6)}°N, {Number(selectedAlert.longitude).toFixed(6)}°E
                    </div>
                  )}
                </div>
                <div className="col-6">
                  <div className="text-muted mb-1" style={{ fontSize: "0.75rem" }}>Nearby Drivers</div>
                  <div>{selectedAlert.nearbyDriversNotified || 0} notified</div>
                </div>
                <div className="col-6">
                  <div className="text-muted mb-1" style={{ fontSize: "0.75rem" }}>Police</div>
                  <div>{selectedAlert.policeNotified ? "✅ Notified" : "❌ Not notified"}</div>
                </div>
                {selectedAlert.notes && (
                  <div className="col-12">
                    <div className="text-muted mb-1" style={{ fontSize: "0.75rem" }}>Notes</div>
                    <div className="p-2 rounded" style={{ background: "#f8fafc", fontSize: "0.83rem" }}>{selectedAlert.notes}</div>
                  </div>
                )}
              </div>
              {selectedAlert.latitude && (
                <a href={`https://maps.google.com/?q=${selectedAlert.latitude},${selectedAlert.longitude}`}
                  target="_blank" rel="noreferrer" className="btn btn-outline-primary btn-sm">
                  <i className="bi bi-map me-1"></i>View on Google Maps
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Resolve Modal */}
      {resolveModal && (
        <div className="modal-backdrop-jago">
          <div className="modal-jago" style={{ maxWidth: "460px" }}>
            <div className="modal-jago-header">
              <h5 className="modal-jago-title"><i className="bi bi-shield-fill-check text-success me-2"></i>Resolve Alert</h5>
              <button className="modal-jago-close" onClick={() => setResolveModal(null)}><i className="bi bi-x-lg"></i></button>
            </div>
            <div className="d-flex flex-column gap-3">
              <div className="alert alert-warning py-2 mb-0" style={{ fontSize: "0.83rem" }}>
                Resolving SOS for <strong>{resolveModal.userName || "user"}</strong>
              </div>
              <div>
                <label className="form-label fw-semibold" style={{ fontSize: "0.85rem" }}>Resolution Notes</label>
                <textarea className="form-control" rows={3}
                  placeholder="Describe how the situation was handled..."
                  value={resolveNotes} onChange={e => setResolveNotes(e.target.value)}
                  data-testid="input-resolve-notes" />
              </div>
              <div className="form-check">
                <input className="form-check-input" type="checkbox" id="policeCheck"
                  checked={policeNotified} onChange={e => setPoliceNotified(e.target.checked)}
                  data-testid="check-police-notified" />
                <label className="form-check-label" htmlFor="policeCheck" style={{ fontSize: "0.85rem" }}>
                  <i className="bi bi-shield-fill me-1 text-primary"></i>Police was notified
                </label>
              </div>
              <div className="d-flex gap-2 justify-content-end">
                <button className="btn btn-outline-secondary btn-sm" onClick={() => setResolveModal(null)}>Cancel</button>
                <button className="btn btn-success btn-sm"
                  onClick={() => resolve.mutate({ id: resolveModal.id, notes: resolveNotes, policeNotified })}
                  disabled={resolve.isPending} data-testid="btn-confirm-resolve">
                  {resolve.isPending ? <span className="spinner-border spinner-border-sm me-1"></span> : null}
                  Mark Resolved
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Police Station Modal */}
      {stationModal && (
        <div className="modal-backdrop-jago">
          <div className="modal-jago" style={{ maxWidth: "560px" }}>
            <div className="modal-jago-header">
              <h5 className="modal-jago-title">{editingStation ? "Edit Police Station" : "Add Police Station"}</h5>
              <button className="modal-jago-close" onClick={() => setStationModal(false)}><i className="bi bi-x-lg"></i></button>
            </div>
            <div className="d-flex flex-column gap-3">
              <div className="row g-3">
                <div className="col-8">
                  <label className="form-label-jago">Station Name <span className="text-danger">*</span></label>
                  <input className="form-control" value={stationForm.name}
                    onChange={e => setStationForm(f => ({ ...f, name: e.target.value }))}
                    data-testid="input-station-name" placeholder="e.g. Banjara Hills Police Station" />
                </div>
                <div className="col-4">
                  <label className="form-label-jago">Zone</label>
                  <select className="form-select" value={stationForm.zoneId}
                    onChange={e => setStationForm(f => ({ ...f, zoneId: e.target.value }))}>
                    <option value="">Any Zone</option>
                    {zones.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </div>
                <div className="col-12">
                  <label className="form-label-jago">Address</label>
                  <input className="form-control" value={stationForm.address}
                    onChange={e => setStationForm(f => ({ ...f, address: e.target.value }))}
                    data-testid="input-station-address" placeholder="Full station address" />
                </div>
                <div className="col-6">
                  <label className="form-label-jago">Phone Number</label>
                  <input className="form-control" value={stationForm.phone}
                    onChange={e => setStationForm(f => ({ ...f, phone: e.target.value }))}
                    data-testid="input-station-phone" placeholder="040-XXXXXXXX" />
                </div>
                <div className="col-3">
                  <label className="form-label-jago">Latitude</label>
                  <input type="number" step="0.0001" className="form-control" value={stationForm.latitude}
                    onChange={e => setStationForm(f => ({ ...f, latitude: e.target.value }))} placeholder="17.4399" />
                </div>
                <div className="col-3">
                  <label className="form-label-jago">Longitude</label>
                  <input type="number" step="0.0001" className="form-control" value={stationForm.longitude}
                    onChange={e => setStationForm(f => ({ ...f, longitude: e.target.value }))} placeholder="78.4983" />
                </div>
              </div>
              <div className="d-flex gap-2 justify-content-end">
                <button className="btn btn-outline-secondary" onClick={() => setStationModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveStation.mutate(stationForm)}
                  disabled={!stationForm.name || saveStation.isPending} data-testid="btn-save-station">
                  {saveStation.isPending ? <span className="spinner-border spinner-border-sm me-1"></span> : null}
                  {editingStation ? "Update Station" : "Add Station"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
