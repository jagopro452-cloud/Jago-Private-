import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { adminFetch, apiRequest } from "@/lib/queryClient";

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  scheduled:   { cls: "badge bg-primary",          label: "Scheduled" },
  completed:   { cls: "badge bg-success",           label: "Completed" },
  cancelled:   { cls: "badge bg-danger",            label: "Cancelled" },
  confirmed:   { cls: "badge bg-success",           label: "Confirmed" },
  pending:     { cls: "badge bg-warning text-dark", label: "Pending" },
};

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function OutstationPool() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"rides" | "bookings" | "settings">(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "bookings" || t === "settings" ? t : "rides";
  });
  const [pricing, setPricing] = useState<{ min_price_per_km_per_seat: string; max_price_per_km_per_seat: string }>({ min_price_per_km_per_seat: "", max_price_per_km_per_seat: "" });
  const [pricingDirty, setPricingDirty] = useState(false);

  const { data: ridesData, isLoading: ridesLoading } = useQuery<any>({
    queryKey: ["/api/admin/outstation-pool/rides"],
  });
  const { data: bookingsData, isLoading: bookingsLoading } = useQuery<any>({
    queryKey: ["/api/admin/outstation-pool/bookings"],
  });
  const { data: settingsData } = useQuery<any>({
    queryKey: ["/api/admin/revenue/settings"],
  });
  const { data: pricingData, isLoading: pricingLoading } = useQuery<any>({
    queryKey: ["/api/admin/outstation-pool/pricing"],
    queryFn: () => adminFetch("/api/admin/outstation-pool/pricing").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error"); })),
    enabled: tab === "settings",
  });
  const { data: refundData, isLoading: refundsLoading } = useQuery<any>({
    queryKey: ["/api/refund-requests", "pool-admin"],
    queryFn: () => adminFetch("/api/refund-requests").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error"); })),
  });
  const { data: issueData, isLoading: issuesLoading } = useQuery<any>({
    queryKey: ["/api/admin/pool/issues", "outstation-pool"],
    queryFn: () => apiRequest("GET", "/api/admin/pool/issues").then(r => r.json()),
  });
  const poolRefunds = Array.isArray(refundData?.data)
    ? refundData.data.filter((item: any) => String(item.reason || "").toLowerCase().includes("pool"))
    : [];
  const outstationIssues = Array.isArray(issueData?.items)
    ? issueData.items.filter((item: any) => item.module === "outstation_pool")
    : [];

  const updateRefund = useMutation({
    mutationFn: ({ id, status, adminNote }: { id: string; status: string; adminNote: string }) =>
      apiRequest("PATCH", `/api/refund-requests/${id}`, { status, adminNote, approvedBy: "Admin" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/refund-requests"] });
      qc.invalidateQueries({ queryKey: ["/api/refund-requests", "pool-admin"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/pool/operations/overview"] });
    },
  });
  const updateIssue = useMutation({
    mutationFn: ({ id, status, adminMessage, resolutionNote, blockReportedUser }: { id: string; status: string; adminMessage: string; resolutionNote?: string; blockReportedUser?: boolean }) =>
      apiRequest("PATCH", `/api/admin/pool/issues/${id}`, { status, adminMessage, resolutionNote, blockReportedUser }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/pool/issues"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/pool/issues", "outstation-pool"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/pool/blocks"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/pool/safety-review"] });
    },
  });

  const toggleMode = useMutation({
    mutationFn: async (mode: "on" | "off") => {
      const res = await adminFetch("/api/admin/outstation-pool/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || "Failed to update pool mode");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/revenue/settings"] });
    },
  });

  useEffect(() => {
    if (pricingData && !pricingDirty) {
      setPricing({
        min_price_per_km_per_seat: pricingData.min_price_per_km_per_seat || "",
        max_price_per_km_per_seat: pricingData.max_price_per_km_per_seat || "",
      });
    }
  }, [pricingData]);

  const savePricing = useMutation({
    mutationFn: async (data: { min_price_per_km_per_seat: string; max_price_per_km_per_seat: string }) => {
      const res = await adminFetch("/api/admin/outstation-pool/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || "Failed to update pricing");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/outstation-pool/pricing"] });
      setPricingDirty(false);
    },
  });

  const rides    = ridesData?.data || [];
  const bookings = bookingsData?.data || [];
  const isPoolOn = settingsData?.outstation_pool_mode === "on";
  const totalSeats = rides.reduce((sum: number, ride: any) => sum + (parseInt(ride.totalSeats) || 0), 0);
  const availableSeats = rides.reduce((sum: number, ride: any) => sum + (parseInt(ride.availableSeats) || 0), 0);
  const occupiedSeats = Math.max(0, totalSeats - availableSeats);
  const occupancyPct = totalSeats > 0 ? Math.round((occupiedSeats / totalSeats) * 100) : 0;
  const cancelledBookings = bookings.filter((booking: any) => booking.status === "cancelled");
  const pendingRefunds = poolRefunds.filter((item: any) => item.status === "pending");
  const disputeCounts = {
    open: outstationIssues.filter((item: any) => item.status === "open").length,
    under_review: outstationIssues.filter((item: any) => item.status === "under_review").length,
    resolved: outstationIssues.filter((item: any) => item.status === "resolved").length,
    rejected: outstationIssues.filter((item: any) => item.status === "rejected").length,
  };

  const rideStats = {
    total: rides.length,
    active: rides.filter((r: any) => r.status === "scheduled" && r.isActive).length,
    totalBookings: rides.reduce((s: number, r: any) => s + (parseInt(r.totalBookings) || 0), 0),
    totalRevenue: rides.reduce((s: number, r: any) => s + (parseFloat(r.totalRevenue) || 0), 0),
  };

  return (
    <div className="container-fluid">
      <style>{`
        .jago-outstation-page .table-responsive {
          max-height: none !important;
        }
        .jago-outstation-page .table thead th {
          position: static !important;
          top: auto !important;
          white-space: nowrap;
        }
        .jago-outstation-page .table tbody td {
          vertical-align: top;
          padding-top: 18px;
          padding-bottom: 18px;
        }
        .jago-outstation-page .route-inline {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
      `}</style>
      {/* Header */}
      <div className="jago-outstation-page d-flex align-items-center justify-content-between mb-4 flex-wrap gap-3">
        <div>
          <h4 className="fw-bold mb-1" style={{ color: "#0f172a" }}>
            <i className="bi bi-signpost-2-fill me-2" style={{ color: "#2F7BFF" }}></i>
            Outstation Pool
          </h4>
          <p className="text-muted mb-0" style={{ fontSize: 13 }}>
            Manage city-to-city carpool rides posted by drivers
          </p>
        </div>
        <div className="d-flex align-items-center gap-3">
          <div className="d-flex align-items-center gap-2 bg-white rounded-3 px-3 py-2 border">
            <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>Pool Mode:</span>
            <span className={`badge ${isPoolOn ? "bg-success" : "bg-secondary"} fs-6 px-3`}>
              {isPoolOn ? "Active" : "Inactive"}
            </span>
            <button
              onClick={() => toggleMode.mutate(isPoolOn ? "off" : "on")}
              className={`btn btn-sm ${isPoolOn ? "btn-outline-danger" : "btn-outline-success"} ms-2`}
              disabled={toggleMode.isPending}
            >
              {isPoolOn ? "Disable" : "Enable"}
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="row g-3 mb-4">
        {[
          { label: "Total Rides Posted",  val: rideStats.total,        icon: "bi-car-front-fill",     color: "#1a73e8", bg: "#e8f0fe" },
          { label: "Active / Scheduled",  val: rideStats.active,       icon: "bi-broadcast-pin",      color: "#16a34a", bg: "#f0fdf4" },
          { label: "Total Bookings",      val: rideStats.totalBookings, icon: "bi-ticket-fill",        color: "#7c3aed", bg: "#f5f3ff" },
          { label: "Total Revenue",       val: `Rs. ${rideStats.totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, icon: "bi-currency-rupee", color: "#b45309", bg: "#fefce8" },
          { label: "Seat Occupancy",      val: `${occupancyPct}%`, icon: "bi-bar-chart-line-fill", color: "#0891b2", bg: "#ecfeff" },
          { label: "Pending Refunds",     val: pendingRefunds.length, icon: "bi-arrow-counterclockwise", color: "#dc2626", bg: "#fef2f2" },
        ].map((s, i) => (
          <div key={i} className="col-xl-3 col-md-4 col-6">
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 14 }}>
              <div className="card-body d-flex align-items-center gap-3 p-3">
                <div style={{ width: 48, height: 48, borderRadius: 12, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <i className={`bi ${s.icon}`} style={{ color: s.color, fontSize: "1.3rem" }}></i>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1.2 }}>{s.val}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row g-3 mb-4">
        <div className="col-lg-6">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 16 }}>
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                  <h5 className="mb-1">Occupancy Review</h5>
                  <div className="text-muted" style={{ fontSize: 12 }}>Seat utilization across posted outstation pool rides</div>
                </div>
                <span className="badge bg-primary-subtle text-primary" style={{ fontSize: 12 }}>{occupiedSeats}/{totalSeats} seats occupied</span>
              </div>
              <div className="mb-3">
                <div style={{ height: 10, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, occupancyPct)}%`, height: "100%", background: "linear-gradient(90deg,#1a73e8,#0891b2)" }}></div>
                </div>
              </div>
              <div className="row g-3">
                <div className="col-4">
                  <div className="rounded-4 p-3" style={{ background: "#eff6ff" }}>
                    <div style={{ fontSize: 11, color: "#64748b" }}>Occupied</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#1a73e8" }}>{occupiedSeats}</div>
                  </div>
                </div>
                <div className="col-4">
                  <div className="rounded-4 p-3" style={{ background: "#f8fafc" }}>
                    <div style={{ fontSize: 11, color: "#64748b" }}>Available</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#475569" }}>{availableSeats}</div>
                  </div>
                </div>
                <div className="col-4">
                  <div className="rounded-4 p-3" style={{ background: "#fef2f2" }}>
                    <div style={{ fontSize: 11, color: "#64748b" }}>Cancelled</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#dc2626" }}>{cancelledBookings.length}</div>
                  </div>
                </div>
              </div>
              <div className="table-responsive mt-3">
                <table className="table table-borderless align-middle mb-0">
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th>Route</th>
                      <th>Seats</th>
                      <th>Occupancy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rides.slice(0, 6).map((ride: any) => {
                      const total = parseInt(ride.totalSeats) || 0;
                      const available = parseInt(ride.availableSeats) || 0;
                      const occupied = Math.max(0, total - available);
                      const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
                      return (
                        <tr key={ride.id}>
                          <td>
                            <div className="fw-semibold">{ride.fromCity} → {ride.toCity}</div>
                            <div className="text-muted" style={{ fontSize: 11 }}>{ride.driverName || "-"}</div>
                          </td>
                          <td>{occupied}/{total}</td>
                          <td>
                            <div className="d-flex align-items-center gap-2">
                              <div style={{ width: 84, height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                                <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: pct > 80 ? "#16a34a" : pct > 40 ? "#1a73e8" : "#d97706" }}></div>
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 700 }}>{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        <div className="col-lg-6">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 16 }}>
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                  <h5 className="mb-1">Pool Refund Review</h5>
                  <div className="text-muted" style={{ fontSize: 12 }}>Approve or reject refund requests raised from pool cancellations</div>
                </div>
                <span className="badge bg-danger-subtle text-danger" style={{ fontSize: 12 }}>{pendingRefunds.length} pending</span>
              </div>
              <div className="table-responsive">
                <table className="table table-borderless align-middle mb-0">
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th>Customer</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {refundsLoading ? (
                      Array(4).fill(0).map((_, i) => (
                        <tr key={i}>{Array(4).fill(0).map((__, j) => <td key={j}><div className="skeleton" style={{ height: 12, borderRadius: 4 }} /></td>)}</tr>
                      ))
                    ) : poolRefunds.length === 0 ? (
                      <tr><td colSpan={4} className="text-center text-muted py-4">No pool refund requests yet.</td></tr>
                    ) : poolRefunds.slice(0, 6).map((item: any) => (
                      <tr key={item.id}>
                        <td>
                          <div className="fw-semibold">{item.customerName || "Customer"}</div>
                          <div className="text-muted" style={{ fontSize: 11 }}>{item.reason || "-"}</div>
                        </td>
                        <td className="fw-bold text-danger">Rs. {parseFloat(item.amount || 0).toFixed(0)}</td>
                        <td><span className={`badge ${item.status === "pending" ? "bg-warning text-dark" : item.status === "approved" ? "bg-success" : "bg-danger"}`}>{item.status}</span></td>
                        <td className="text-end">
                          {item.status === "pending" ? (
                            <div className="d-flex gap-2 justify-content-end">
                              <button className="btn btn-sm btn-success" disabled={updateRefund.isPending} onClick={() => updateRefund.mutate({ id: item.id, status: "approved", adminNote: "Approved from pool refund review" })}>
                                Approve
                              </button>
                              <button className="btn btn-sm btn-outline-danger" disabled={updateRefund.isPending} onClick={() => updateRefund.mutate({ id: item.id, status: "rejected", adminNote: "Rejected from pool refund review" })}>
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-muted" style={{ fontSize: 12 }}>Reviewed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 16 }}>
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
            <div>
              <h5 className="mb-1">Outstation Pool Disputes</h5>
              <div className="text-muted" style={{ fontSize: 12 }}>Dedicated dispute and report review for outstation pool bookings using the shared pool issue lifecycle.</div>
            </div>
            <div className="d-flex gap-2 flex-wrap">
              {[
                { label: "Open", value: disputeCounts.open, cls: "bg-danger-subtle text-danger" },
                { label: "Under Review", value: disputeCounts.under_review, cls: "bg-info-subtle text-info" },
                { label: "Resolved", value: disputeCounts.resolved, cls: "bg-success-subtle text-success" },
                { label: "Rejected", value: disputeCounts.rejected, cls: "bg-secondary-subtle text-secondary" },
              ].map((item) => (
                <span key={item.label} className={`badge ${item.cls}`} style={{ fontSize: 12 }}>{item.label}: {item.value}</span>
              ))}
            </div>
          </div>
          <div className="table-responsive">
            <table className="table table-borderless align-middle mb-0">
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  <th>Booking</th>
                  <th>Passenger</th>
                  <th>Driver</th>
                  <th>Evidence</th>
                  <th>Timeline</th>
                  <th>Admin Notes</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {issuesLoading ? (
                  Array(4).fill(0).map((_, i) => (
                    <tr key={i}>{Array(8).fill(0).map((__, j) => <td key={j}><div className="skeleton" style={{ height: 12, borderRadius: 4 }} /></td>)}</tr>
                  ))
                ) : outstationIssues.length === 0 ? (
                  <tr><td colSpan={8} className="text-center text-muted py-4">No outstation pool disputes or reports yet.</td></tr>
                ) : outstationIssues.slice(0, 8).map((issue: any) => {
                  const adminUpdates = Array.isArray(issue.timeline?.adminUpdates) ? issue.timeline.adminUpdates : [];
                  const latestUpdate = adminUpdates[adminUpdates.length - 1];
                  return (
                    <tr key={issue.id}>
                      <td>
                        <div className="fw-semibold">{issue.reference_id || issue.id}</div>
                        <div className="text-muted" style={{ fontSize: 11 }}>{issue.category || "-"}</div>
                      </td>
                      <td>{issue.customer_name || "-"}</td>
                      <td>{issue.driver_name || issue.reported_user_name || "-"}</td>
                      <td className="text-muted" style={{ fontSize: 12 }}>{Array.isArray(issue.evidence_urls) ? `${issue.evidence_urls.length} file(s)` : "0 file(s)"}</td>
                      <td className="text-muted" style={{ fontSize: 12, maxWidth: 220 }}>
                        {latestUpdate?.message || issue.timeline?.stages?.find((stage: any) => stage.state === "done" && stage.key !== "open")?.note || "Awaiting operations update"}
                      </td>
                      <td className="text-muted" style={{ fontSize: 12, maxWidth: 220 }}>{issue.resolution_note || "—"}</td>
                      <td><span className={`badge ${issue.status === "open" ? "bg-danger" : issue.status === "under_review" ? "bg-info text-dark" : issue.status === "resolved" ? "bg-success" : "bg-secondary"}`}>{String(issue.status || "open").replaceAll("_", " ")}</span></td>
                      <td className="text-end">
                        <div className="d-flex gap-2 justify-content-end flex-wrap">
                          {issue.status !== "under_review" && (
                            <button className="btn btn-sm btn-outline-primary" disabled={updateIssue.isPending} onClick={() => updateIssue.mutate({ id: issue.id, status: "under_review", adminMessage: "Outstation pool dispute moved to review queue." })}>
                              Review
                            </button>
                          )}
                          {issue.status !== "resolved" && (
                            <button className="btn btn-sm btn-success" disabled={updateIssue.isPending} onClick={() => updateIssue.mutate({ id: issue.id, status: "resolved", adminMessage: "Outstation pool dispute resolved by operations.", resolutionNote: issue.resolution_note || "Resolved after booking and evidence review." })}>
                              Resolve
                            </button>
                          )}
                          {issue.status !== "rejected" && (
                            <button className="btn btn-sm btn-outline-danger" disabled={updateIssue.isPending} onClick={() => updateIssue.mutate({ id: issue.id, status: "rejected", adminMessage: "Outstation pool dispute rejected after review.", resolutionNote: issue.resolution_note || "Insufficient evidence for action." })}>
                              Reject
                            </button>
                          )}
                          {issue.reported_user_id && (
                            <button className="btn btn-sm btn-outline-dark" disabled={updateIssue.isPending} onClick={() => updateIssue.mutate({ id: issue.id, status: issue.status || "under_review", adminMessage: "Reported user blocked from future outstation pool matching.", resolutionNote: issue.resolution_note || "User blocked by operations.", blockReportedUser: true })}>
                              Block User
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="card border-0 shadow-sm jago-outstation-page" style={{ borderRadius: 16 }}>
        <div className="card-header bg-white border-0 px-4 pt-4 pb-0" style={{ borderRadius: "16px 16px 0 0" }}>
          <ul className="nav nav-tabs border-0" style={{ gap: 4 }}>
            {(["rides", "bookings", "settings"] as const).map(t => (
              <li key={t} className="nav-item">
                <button
                  className={`nav-link border-0 fw-bold px-4 py-2 rounded-top ${tab === t ? "active text-primary" : "text-secondary"}`}
                  style={{ fontSize: 13, background: tab === t ? "#eff6ff" : "transparent" }}
                  onClick={() => setTab(t)}
                >
                  {t === "rides" ? (
                    <><i className="bi bi-car-front me-2"></i>Rides ({rides.length})</>
                  ) : t === "bookings" ? (
                    <><i className="bi bi-ticket me-2"></i>Bookings ({bookings.length})</>
                  ) : (
                    <><i className="bi bi-gear-fill me-2"></i>Pricing Settings</>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="card-body p-0">
          {tab === "rides" && (
            <div className="table-responsive">
              <table className="table table-borderless table-hover align-middle mb-0">
                <thead style={{ background: "#f8fafc" }}>
                  <tr>
                    {["Driver", "Route", "Date & Time", "Seats", "Fare/Seat", "Bookings", "Revenue", "Status"].map((h, i) => (
                      <th key={i} className={i === 0 ? "ps-4" : ""}
                        style={{ fontSize: 10.5, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, paddingTop: 12, paddingBottom: 12, whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ridesLoading ? (
                    Array(5).fill(0).map((_, i) => (
                      <tr key={i}>
                        {Array(8).fill(0).map((_, j) => (
                          <td key={j}><div className="skeleton" style={{ height: 13, borderRadius: 4 }} /></td>
                        ))}
                      </tr>
                    ))
                  ) : rides.length === 0 ? (
                    <tr><td colSpan={8}>
                      <div className="text-center py-5 text-muted">
                        <i className="bi bi-signpost-2 fs-1 d-block mb-2" style={{ opacity: 0.25 }}></i>
                        <p className="mb-0">No outstation rides posted yet</p>
                      </div>
                    </td></tr>
                  ) : (
                    rides.map((r: any) => {
                      const badge = STATUS_BADGE[r.status] || { cls: "badge bg-secondary", label: r.status };
                      return (
                        <tr key={r.id}>
                          <td className="ps-4">
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{r.driverName || "-"}</div>
                              <div style={{ fontSize: 11, color: "#64748b" }}>{r.driverPhone || ""}</div>
                            </div>
                          </td>
                          <td>
                            <div className="route-inline">
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#1a73e8" }}>{r.fromCity}</span>
                              <i className="bi bi-arrow-right" style={{ fontSize: 10, color: "#94a3b8" }}></i>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#16a34a" }}>{r.toCity}</span>
                            </div>
                            {r.routeKm > 0 && (
                              <div style={{ fontSize: 10, color: "#94a3b8" }}>{r.routeKm} km</div>
                            )}
                          </td>
                          <td>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{fmtDate(r.departureDate)}</div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>{r.departureTime || "-"}</div>
                          </td>
                          <td>
                            <div className="d-flex align-items-center gap-1">
                              <span style={{ fontSize: 14, fontWeight: 700, color: "#1a73e8" }}>{r.availableSeats}</span>
                              <span style={{ fontSize: 11, color: "#94a3b8" }}>/ {r.totalSeats}</span>
                            </div>
                            <div style={{ fontSize: 10, color: "#94a3b8" }}>available</div>
                          </td>
                          <td style={{ fontSize: 14, fontWeight: 700, color: "#16a34a" }}>Rs. {parseFloat(r.farePerSeat || 0).toFixed(0)}</td>
                          <td>
                            <span className="badge bg-primary bg-opacity-10 text-primary" style={{ fontSize: 12 }}>
                              {r.totalBookings || 0}
                            </span>
                          </td>
                          <td style={{ fontSize: 13, fontWeight: 600 }}>Rs. {parseFloat(r.totalRevenue || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                          <td><span className={badge.cls} style={{ fontSize: 10 }}>{badge.label}</span></td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === "bookings" && (
            <div className="table-responsive">
              <table className="table table-borderless table-hover align-middle mb-0">
                <thead style={{ background: "#f8fafc" }}>
                  <tr>
                    {["Customer", "Route", "Seats", "Total Fare", "Payment", "Status", "Booked On"].map((h, i) => (
                      <th key={i} className={i === 0 ? "ps-4" : ""}
                        style={{ fontSize: 10.5, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, paddingTop: 12, paddingBottom: 12, whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookingsLoading ? (
                    Array(5).fill(0).map((_, i) => (
                      <tr key={i}>
                        {Array(7).fill(0).map((_, j) => (
                          <td key={j}><div className="skeleton" style={{ height: 13, borderRadius: 4 }} /></td>
                        ))}
                      </tr>
                    ))
                  ) : bookings.length === 0 ? (
                    <tr><td colSpan={7}>
                      <div className="text-center py-5 text-muted">
                        <i className="bi bi-ticket fs-1 d-block mb-2" style={{ opacity: 0.25 }}></i>
                        <p className="mb-0">No bookings yet</p>
                      </div>
                    </td></tr>
                  ) : (
                    bookings.map((b: any) => {
                      const badge = STATUS_BADGE[b.status] || { cls: "badge bg-secondary", label: b.status };
                      const pmBadge = b.paymentStatus === "paid"
                        ? <span className="badge bg-success" style={{ fontSize: 10 }}>Paid</span>
                        : <span className="badge bg-warning text-dark" style={{ fontSize: 10 }}>Unpaid</span>;
                      return (
                        <tr key={b.id}>
                          <td className="ps-4">
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{b.customerName || "-"}</div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>{b.customerPhone || ""}</div>
                          </td>
                          <td>
                            <div className="route-inline">
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#1a73e8" }}>{b.fromCity}</span>
                              <i className="bi bi-arrow-right" style={{ fontSize: 10, color: "#94a3b8" }}></i>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#16a34a" }}>{b.toCity}</span>
                            </div>
                          </td>
                          <td style={{ fontSize: 14, fontWeight: 700, color: "#1a73e8" }}>{b.seatsBooked}</td>
                          <td style={{ fontSize: 14, fontWeight: 700, color: "#16a34a" }}>Rs. {parseFloat(b.totalFare || 0).toFixed(0)}</td>
                          <td>{pmBadge}</td>
                          <td><span className={badge.cls} style={{ fontSize: 10 }}>{badge.label}</span></td>
                          <td style={{ fontSize: 12, color: "#64748b" }}>{fmtDate(b.createdAt)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === "settings" && (
            <div className="p-4">
              {pricingLoading ? (
                <div className="text-center py-5 text-muted"><div className="spinner-border spinner-border-sm me-2"></div>Loading settings...</div>
              ) : (
                <div className="row g-4">
                  <div className="col-12">
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <div className="rounded-2 d-flex align-items-center justify-content-center"
                        style={{ width: 32, height: 32, background: "#fef2f2", color: "#dc2626" }}>
                        <i className="bi bi-slash-circle"></i>
                      </div>
                      <div>
                        <span className="fw-semibold" style={{ fontSize: 15 }}>Fare Caps (Safety Limits)</span>
                        <span className="badge ms-2" style={{ background: "#dc2626", fontSize: 10 }}>Driver cannot exceed</span>
                      </div>
                    </div>
                    <div className="text-muted mb-3" style={{ fontSize: 12 }}>
                      Driver sets the price per km per seat when posting a ride. These caps clamp that value so it always stays within admin-approved bounds — matching the same fare-cap pattern used for Local Pool (Car Sharing).
                    </div>
                    <div className="row g-3">
                      {[
                        { key: "min_price_per_km_per_seat", label: "Minimum Rate (Rs./km/seat)", placeholder: "1.5", help: "Driver's rate is raised to this floor if they submit lower" },
                        { key: "max_price_per_km_per_seat", label: "Maximum Rate (Rs./km/seat)", placeholder: "3.0", help: "Driver's rate is capped at this ceiling if they submit higher" },
                      ].map(field => (
                        <div key={field.key} className="col-md-4">
                          <label className="form-label small fw-semibold text-muted">{field.label}</label>
                          <div className="input-group input-group-sm">
                            <span className="input-group-text">Rs./km</span>
                            <input type="number" step="0.1" className="form-control" placeholder={field.placeholder}
                              value={(pricing as any)[field.key] || ""}
                              onChange={e => { setPricing(prev => ({ ...prev, [field.key]: e.target.value })); setPricingDirty(true); }}
                              data-testid={`input-op-${field.key}`} />
                          </div>
                          <div className="form-text" style={{ fontSize: 10.5 }}>{field.help}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="col-12 d-flex gap-2 align-items-center">
                    <button className="btn btn-primary px-4"
                      disabled={!pricingDirty || savePricing.isPending}
                      onClick={() => savePricing.mutate(pricing)}
                      data-testid="btn-save-op-pricing">
                      {savePricing.isPending ? <><span className="spinner-border spinner-border-sm me-2"></span>Saving...</> : <><i className="bi bi-save me-2"></i>Save Settings</>}
                    </button>
                    {pricingDirty && (
                      <span className="text-warning" style={{ fontSize: 12 }}>
                        <i className="bi bi-exclamation-circle me-1"></i>Unsaved changes
                      </span>
                    )}
                    {savePricing.isError && (
                      <span className="text-danger" style={{ fontSize: 12 }}>{(savePricing.error as Error)?.message}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
