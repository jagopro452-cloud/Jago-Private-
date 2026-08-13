import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  active: "#2563eb",
  ended: "#16a34a",
  completed: "#16a34a",
  cancelled: "#dc2626",
  pending_driver_accept: "#f59e0b",
  matched: "#2563eb",
  picked_up: "#0891b2",
  dropped: "#16a34a",
  searching: "#d97706",
  pending: "#d97706",
  approved: "#16a34a",
  rejected: "#dc2626",
  open: "#dc2626",
  under_review: "#0891b2",
  resolved: "#16a34a",
};

function money(value: unknown, digits = 0) {
  return `Rs ${Number(value || 0).toFixed(digits)}`;
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status === "ended" ? "completed" : status;
  const color = STATUS_COLORS[status] || STATUS_COLORS[normalized] || "#64748b";
  return (
    <span style={{ background: color + "18", color, border: `1px solid ${color}44`, borderRadius: 20, padding: "2px 10px", fontSize: "0.72rem", fontWeight: 600, textTransform: "capitalize" }}>
      {normalized.replaceAll("_", " ")}
    </span>
  );
}

function PassengersModal({ rideId, onClose }: { rideId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: [`/api/admin/local-pool/rides/${rideId}/passengers`],
  });
  const passengers = data?.data || [];
  return (
    <div className="modal-backdrop-jago">
      <div className="modal-jago" style={{ maxWidth: 920 }}>
        <div className="modal-jago-header">
          <h5 className="modal-jago-title">Live Pool Passengers</h5>
          <button className="modal-jago-close" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>
        {isLoading ? (
          <div className="text-center py-4"><div className="spinner-border spinner-border-sm text-primary"></div></div>
        ) : passengers.length === 0 ? (
          <p className="text-muted text-center py-4">No passengers found.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-borderless align-middle" style={{ fontSize: "0.8rem" }}>
              <thead className="table-light">
                <tr>
                  <th>#</th>
                  <th>Customer</th>
                  <th>Pickup</th>
                  <th>Drop</th>
                  <th>Seats</th>
                  <th>Fare/Seat</th>
                  <th>GST</th>
                  <th>Commission</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {passengers.map((p: any, i: number) => (
                  <tr key={p.id}>
                    <td>{i + 1}</td>
                    <td>
                      <div className="fw-semibold">{p.customerName || "-"}</div>
                      <div className="text-muted" style={{ fontSize: "0.72rem" }}>{p.customerPhone}</div>
                    </td>
                    <td style={{ maxWidth: 180 }}><span className="text-truncate d-block">{p.pickupAddress || `${p.pickupLat}, ${p.pickupLng}`}</span></td>
                    <td style={{ maxWidth: 180 }}><span className="text-truncate d-block">{p.dropAddress || `${p.dropLat}, ${p.dropLng}`}</span></td>
                    <td className="text-center">{p.seatsBooked || p.seatsRequested || 1}</td>
                    <td>{money(p.farePerSeat, 2)}</td>
                    <td>{money(p.gstAmount, 2)}</td>
                    <td>{money(p.commissionAmount, 2)}</td>
                    <td className="fw-semibold">{money(p.totalFare, 2)}</td>
                    <td><StatusBadge status={p.status || "booked"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LocalPool() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewPassengersRideId, setViewPassengersRideId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(() => new URLSearchParams(window.location.search).get("openSettings") === "1");
  const [settingsForm, setSettingsForm] = useState({
    mode: "on",
    collectionSecs: "300",
    matchRadiusKm: "4",
    maxDetourKm: "2.5",
    directionToleranceDeg: "50",
    baseFarePerSeat: "20",
    farePerKmPerSeat: "5",
    minFarePerSeat: "30",
    maxFarePerSeat: "500",
    maxSeatsPerBooking: "2",
  });

  const { data: statsData } = useQuery<any>({ queryKey: ["/api/admin/local-pool/stats"] });
  const stats = statsData || {};
  const { data: settingsData } = useQuery<any>({
    queryKey: ["/api/admin/local-pool/settings"],
    queryFn: () => apiRequest("GET", "/api/admin/local-pool/settings").then(r => r.json()),
  });
  const liveSettings = settingsData?.settings || {};

  const { data: ridesData, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/local-pool/rides", statusFilter],
    queryFn: () => apiRequest("GET", `/api/admin/local-pool/rides${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`).then(r => r.json()),
  });
  const rides = ridesData?.data || [];

  const { data: opsOverview } = useQuery<any>({
    queryKey: ["/api/admin/pool/operations/overview"],
    queryFn: () => apiRequest("GET", "/api/admin/pool/operations/overview").then(r => r.json()),
  });

  const { data: issueData } = useQuery<any>({
    queryKey: ["/api/admin/pool/issues"],
    queryFn: () => apiRequest("GET", "/api/admin/pool/issues").then(r => r.json()),
  });
  const issues = issueData?.items || [];
  const { data: poolBlocksData } = useQuery<any>({
    queryKey: ["/api/admin/pool/blocks"],
    queryFn: () => apiRequest("GET", "/api/admin/pool/blocks").then(r => r.json()),
  });
  const poolBlocks = poolBlocksData?.items || [];
  const { data: poolRatingsData } = useQuery<any>({
    queryKey: ["/api/admin/pool/ratings"],
    queryFn: () => apiRequest("GET", "/api/admin/pool/ratings").then(r => r.json()),
  });
  const poolRatings = poolRatingsData?.items || [];
  const { data: poolSafetyData } = useQuery<any>({
    queryKey: ["/api/admin/pool/safety-review"],
    queryFn: () => apiRequest("GET", "/api/admin/pool/safety-review").then(r => r.json()),
  });
  const poolSafetyAlerts = poolSafetyData?.alerts || [];
  const poolSafetySummary = poolSafetyData?.summary || {};
  const { data: refundData, isLoading: refundsLoading } = useQuery<any>({
    queryKey: ["/api/refund-requests", "pool-local"],
    queryFn: () => adminFetch("/api/refund-requests").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error"); })),
  });
  const poolRefunds = Array.isArray(refundData?.data)
    ? refundData.data.filter((item: any) => String(item.reason || "").toLowerCase().includes("pool"))
    : [];

  const updateRefund = useMutation({
    mutationFn: ({ id, status, adminNote }: { id: string; status: string; adminNote: string }) =>
      apiRequest("PATCH", `/api/refund-requests/${id}`, { status, adminNote, approvedBy: "Admin" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/refund-requests"] });
      qc.invalidateQueries({ queryKey: ["/api/refund-requests", "pool-local"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/pool/operations/overview"] });
    },
  });

  const updateIssue = useMutation({
    mutationFn: ({ id, status, adminMessage, resolutionNote, blockReportedUser }: { id: string; status: string; adminMessage: string; resolutionNote?: string; blockReportedUser?: boolean }) =>
      apiRequest("PATCH", `/api/admin/pool/issues/${id}`, { status, adminMessage, resolutionNote, blockReportedUser }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/pool/issues"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/pool/blocks"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/pool/operations/overview"] });
      toast({ title: "Pool issue updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const saveSettings = useMutation({
    mutationFn: (d: any) => apiRequest("PATCH", "/api/admin/local-pool/settings", d),
    onSuccess: () => {
      toast({ title: "Settings saved" });
      setSettingsOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/admin/local-pool/stats"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/local-pool/settings"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statCards = [
    { label: "Total Sessions", value: stats.totalRides ?? 0, icon: "bi-diagram-3-fill", color: "#2563eb" },
    { label: "Accepting", value: stats.accepting ?? 0, icon: "bi-broadcast-pin", color: "#d97706" },
    { label: "Paused", value: stats.paused ?? 0, icon: "bi-pause-circle-fill", color: "#f97316" },
    { label: "Passengers", value: stats.totalPassengers ?? 0, icon: "bi-people-fill", color: "#7c3aed" },
    { label: "Revenue", value: money(stats.totalRevenue), icon: "bi-currency-rupee", color: "#0891b2" },
    { label: "GST", value: money(stats.totalGst), icon: "bi-receipt-cutoff", color: "#0f766e" },
    { label: "Commission", value: money(stats.totalCommission), icon: "bi-graph-up-arrow", color: "#db2777" },
  ];
  const totalSeatCapacity = rides.reduce((sum: number, ride: any) => sum + (parseInt(ride.maxSeats) || 0), 0);
  const occupiedSeats = rides.reduce((sum: number, ride: any) => sum + (parseInt(ride.bookedSeats) || 0), 0);
  const occupancyPct = totalSeatCapacity > 0 ? Math.round((occupiedSeats / totalSeatCapacity) * 100) : 0;
  const pendingPoolRefunds = poolRefunds.filter((item: any) => item.status === "pending");

  useEffect(() => {
    if (!settingsOpen) return;
    setSettingsForm({
      mode: String(liveSettings.local_pool_mode || "on"),
      collectionSecs: String(liveSettings.local_pool_collection_secs || "300"),
      matchRadiusKm: String(liveSettings.local_pool_match_radius_km || "4"),
      maxDetourKm: String(liveSettings.local_pool_max_detour_km || "2.5"),
      directionToleranceDeg: String(liveSettings.local_pool_direction_tolerance_deg || "50"),
      baseFarePerSeat: String(liveSettings.base_fare_per_seat || "20"),
      farePerKmPerSeat: String(liveSettings.fare_per_km_per_seat || "5"),
      minFarePerSeat: String(liveSettings.min_fare_per_seat || "30"),
      maxFarePerSeat: String(liveSettings.max_fare_per_seat || "500"),
      maxSeatsPerBooking: String(liveSettings.max_seats_per_booking || "2"),
    });
  }, [settingsOpen, liveSettings.local_pool_mode, liveSettings.local_pool_collection_secs, liveSettings.local_pool_match_radius_km, liveSettings.local_pool_max_detour_km, liveSettings.local_pool_direction_tolerance_deg, liveSettings.base_fare_per_seat, liveSettings.fare_per_km_per_seat, liveSettings.min_fare_per_seat, liveSettings.max_fare_per_seat, liveSettings.max_seats_per_booking]);

  function buildSettingsPayload() {
    return {
      local_pool_mode: settingsForm.mode,
      local_pool_collection_secs: settingsForm.collectionSecs,
      local_pool_match_radius_km: settingsForm.matchRadiusKm,
      local_pool_max_detour_km: settingsForm.maxDetourKm,
      local_pool_direction_tolerance_deg: settingsForm.directionToleranceDeg,
      base_fare_per_seat: settingsForm.baseFarePerSeat,
      fare_per_km_per_seat: settingsForm.farePerKmPerSeat,
      min_fare_per_seat: settingsForm.minFarePerSeat,
      max_fare_per_seat: settingsForm.maxFarePerSeat,
      max_seats_per_booking: settingsForm.maxSeatsPerBooking,
    };
  }

  return (
    <div className="container-fluid">
      <div className="mb-4 d-flex justify-content-between align-items-start flex-wrap gap-2">
        <div>
          <h2 className="fs-22 mb-1">Local Pool</h2>
          <div className="fs-14 text-muted">Rolling city pool sessions, live seat occupancy, and local shared-ride controls</div>
        </div>
        <button className="btn btn-outline-primary btn-sm" onClick={() => setSettingsOpen(true)}>
          <i className="bi bi-gear me-1"></i> Pool Settings
        </button>
      </div>

      <div className="row g-3 mb-4">
        {statCards.map((s, i) => (
          <div key={i} className="col-6 col-md-4 col-lg-2-4" style={{ flex: "1 1 160px" }}>
            <div className="card h-100" style={{ border: `1.5px solid ${s.color}22` }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div style={{ width: 42, height: 42, borderRadius: "50%", background: s.color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <i className={`bi ${s.icon}`} style={{ fontSize: "1.2rem", color: s.color }}></i>
                </div>
                <div>
                  <div style={{ fontSize: "1.4rem", fontWeight: 700, lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{s.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
            <div>
              <h5 className="mb-1 text-primary">Pool Operations Overview</h5>
              <div className="text-muted" style={{ fontSize: "0.8rem" }}>Combined view for local + outstation pool refunds, disputes, ratings, and booking health</div>
            </div>
            <button className="btn btn-sm btn-outline-primary" onClick={() => {
              qc.invalidateQueries({ queryKey: ["/api/admin/pool/operations/overview"] });
              qc.invalidateQueries({ queryKey: ["/api/admin/pool/issues"] });
            }}>
              <i className="bi bi-arrow-clockwise me-1"></i>Refresh
            </button>
          </div>
          <div className="row g-3">
            {[
              { label: "Outstation Bookings", value: opsOverview?.outstation?.total_bookings ?? 0, color: "#2563eb" },
              { label: "Local Bookings", value: opsOverview?.local?.total_local_bookings ?? 0, color: "#0891b2" },
              { label: "Open Reports", value: opsOverview?.issues?.open_issues ?? 0, color: "#dc2626" },
              { label: "Pool Refunds", value: opsOverview?.refunds?.pending_refunds ?? 0, color: "#d97706" },
              { label: "Avg Pool Rating", value: Number(opsOverview?.ratings?.avg_rating || 0).toFixed(1), color: "#7c3aed" },
              { label: "Pool Revenue", value: money((Number(opsOverview?.outstation?.revenue || 0) + Number(opsOverview?.local?.local_revenue || 0)), 0), color: "#16a34a" },
            ].map((item) => (
              <div key={item.label} className="col-6 col-md-4 col-lg-2">
                <div className="h-100 rounded-4 p-3" style={{ background: `${item.color}12`, border: `1px solid ${item.color}26` }}>
                  <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{item.label}</div>
                  <div style={{ fontSize: "1.35rem", fontWeight: 700, color: item.color }}>{item.value}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="table-responsive mt-4">
            <table className="table table-borderless align-middle mb-0" style={{ fontSize: "0.8rem" }}>
              <thead className="table-light">
                <tr>
                  <th>Module</th>
                  <th>Category</th>
                  <th>Channel</th>
                  <th>Customer</th>
                  <th>Driver</th>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {issues.length === 0 ? (
                  <tr><td colSpan={7} className="text-center text-muted py-4">No pool reports or disputes yet.</td></tr>
                ) : issues.slice(0, 8).map((issue: any) => (
                  <tr key={issue.id}>
                    <td style={{ textTransform: "capitalize" }}>{String(issue.module || "").replaceAll("_", " ")}</td>
                    <td>{issue.category || "-"}</td>
                    <td style={{ textTransform: "capitalize" }}>{String(issue.issue_channel || "").replaceAll("_", " ")}</td>
                    <td>{issue.customer_name || "-"}</td>
                    <td>{issue.driver_name || issue.reported_user_name || "-"}</td>
                    <td><StatusBadge status={issue.status || "open"} /></td>
                    <td className="text-end">
                      <div className="d-flex gap-2 justify-content-end flex-wrap">
                        {issue.status !== "under_review" && (
                          <button className="btn btn-sm btn-outline-primary" disabled={updateIssue.isPending} onClick={() => updateIssue.mutate({ id: issue.id, status: "under_review", adminMessage: "Operations review started." })}>
                            Review
                          </button>
                        )}
                        {issue.status !== "resolved" && (
                          <button className="btn btn-sm btn-success" disabled={updateIssue.isPending} onClick={() => updateIssue.mutate({ id: issue.id, status: "resolved", adminMessage: "Issue resolved by operations.", resolutionNote: "Closed after operations review." })}>
                            Resolve
                          </button>
                        )}
                        {issue.status !== "rejected" && (
                          <button className="btn btn-sm btn-outline-danger" disabled={updateIssue.isPending} onClick={() => updateIssue.mutate({ id: issue.id, status: "rejected", adminMessage: "Issue rejected after review.", resolutionNote: "Insufficient evidence for action." })}>
                            Reject
                          </button>
                        )}
                        {issue.reported_user_id && (
                          <button className="btn btn-sm btn-outline-dark" disabled={updateIssue.isPending} onClick={() => updateIssue.mutate({ id: issue.id, status: issue.status || "under_review", adminMessage: "Reported user blocked from future pool matching.", resolutionNote: issue.resolution_note || "User blocked by operations.", blockReportedUser: true })}>
                            Block User
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h5 className="mb-1 text-primary">Blocked Pool Users</h5>
              <div className="text-muted" style={{ fontSize: "0.8rem" }}>Operations-enforced blocks to prevent future matching</div>
            </div>
            <span className="badge bg-dark-subtle text-dark">{poolBlocks.length} active</span>
          </div>
          <div className="table-responsive">
            <table className="table table-borderless align-middle mb-0" style={{ fontSize: "0.8rem" }}>
              <thead className="table-light">
                <tr>
                  <th>Blocked By</th>
                  <th>Blocked User</th>
                  <th>Module</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {poolBlocks.length === 0 ? (
                  <tr><td colSpan={4} className="text-center text-muted py-4">No active pool user blocks.</td></tr>
                ) : poolBlocks.slice(0, 8).map((item: any) => (
                  <tr key={item.id}>
                    <td>{item.blocker_name || "-"}</td>
                    <td>{item.blocked_name || "-"}</td>
                    <td style={{ textTransform: "capitalize" }}>{String(item.module || "pool").replaceAll("_", " ")}</td>
                    <td>{item.reason || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                  <h5 className="mb-1 text-primary">Pool Ratings Review</h5>
                  <div className="text-muted" style={{ fontSize: "0.8rem" }}>Latest driver to passenger and passenger to driver pool ratings</div>
                </div>
                <span className="badge bg-warning-subtle text-warning">{poolRatings.length} recent</span>
              </div>
              <div className="table-responsive">
                <table className="table table-borderless align-middle mb-0" style={{ fontSize: "0.8rem" }}>
                  <thead className="table-light">
                    <tr>
                      <th>Module</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Overall</th>
                      <th>Breakdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poolRatings.length === 0 ? (
                      <tr><td colSpan={5} className="text-center text-muted py-4">No pool ratings yet.</td></tr>
                    ) : poolRatings.slice(0, 8).map((rating: any) => (
                      <tr key={rating.id}>
                        <td style={{ textTransform: "capitalize" }}>{String(rating.module || "").replaceAll("_", " ")}</td>
                        <td>
                          <div className="fw-semibold">{rating.from_user_name || "-"}</div>
                          <div className="text-muted" style={{ fontSize: "0.72rem" }}>{String(rating.rating_role || "").replaceAll("_", " ")}</div>
                        </td>
                        <td>{rating.to_user_name || "-"}</td>
                        <td><span className="badge bg-warning text-dark">{Number(rating.overall_rating || 0).toFixed(1)} / 5</span></td>
                        <td className="text-muted" style={{ fontSize: "0.72rem" }}>
                          S:{Number(rating.safety_rating || 0).toFixed(1)} | B:{Number(rating.behaviour_rating || 0).toFixed(1)} | P:{Number(rating.punctuality_rating || 0).toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                  <h5 className="mb-1 text-primary">Pool Safety Review</h5>
                  <div className="text-muted" style={{ fontSize: "0.8rem" }}>SOS incidents, active disputes, and blocking actions for pool operations</div>
                </div>
                <span className="badge bg-danger-subtle text-danger">{poolSafetySummary.active_sos || 0} active SOS</span>
              </div>
              <div className="row g-3 mb-3">
                <div className="col-4">
                  <div className="rounded-4 p-3" style={{ background: "#fef2f2" }}>
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Active SOS</div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#dc2626" }}>{poolSafetySummary.active_sos || 0}</div>
                  </div>
                </div>
                <div className="col-4">
                  <div className="rounded-4 p-3" style={{ background: "#fff7ed" }}>
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Open Disputes</div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#d97706" }}>{poolSafetySummary.open_disputes || 0}</div>
                  </div>
                </div>
                <div className="col-4">
                  <div className="rounded-4 p-3" style={{ background: "#f8fafc" }}>
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Blocks</div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#0f172a" }}>{poolSafetySummary.active_blocks || 0}</div>
                  </div>
                </div>
              </div>
              <div className="table-responsive">
                <table className="table table-borderless align-middle mb-0" style={{ fontSize: "0.8rem" }}>
                  <thead className="table-light">
                    <tr>
                      <th>User</th>
                      <th>Trigger</th>
                      <th>Note</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poolSafetyAlerts.length === 0 ? (
                      <tr><td colSpan={4} className="text-center text-muted py-4">No pool SOS incidents recorded.</td></tr>
                    ) : poolSafetyAlerts.slice(0, 8).map((alert: any) => (
                      <tr key={alert.id}>
                        <td>
                          <div className="fw-semibold">{alert.user_name || "-"}</div>
                          <div className="text-muted" style={{ fontSize: "0.72rem" }}>{alert.user_phone || ""}</div>
                        </td>
                        <td style={{ textTransform: "capitalize" }}>{alert.triggered_by || "-"}</td>
                        <td className="text-muted" style={{ maxWidth: 220 }}>{alert.notes || "-"}</td>
                        <td><StatusBadge status={alert.status || "active"} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                  <h5 className="mb-1 text-primary">Seat Occupancy Review</h5>
                  <div className="text-muted" style={{ fontSize: "0.8rem" }}>Live booked seats vs total local pool capacity</div>
                </div>
                <span className="badge bg-primary-subtle text-primary">{occupiedSeats}/{totalSeatCapacity} seats</span>
              </div>
              <div className="mb-3">
                <div style={{ height: 10, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, occupancyPct)}%`, height: "100%", background: "linear-gradient(90deg,#2563eb,#7c3aed)" }}></div>
                </div>
              </div>
              <div className="row g-3 mb-3">
                <div className="col-4">
                  <div className="rounded-4 p-3" style={{ background: "#eff6ff" }}>
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Occupancy</div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#2563eb" }}>{occupancyPct}%</div>
                  </div>
                </div>
                <div className="col-4">
                  <div className="rounded-4 p-3" style={{ background: "#f5f3ff" }}>
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Booked</div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#7c3aed" }}>{occupiedSeats}</div>
                  </div>
                </div>
                <div className="col-4">
                  <div className="rounded-4 p-3" style={{ background: "#f8fafc" }}>
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Capacity</div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#334155" }}>{totalSeatCapacity}</div>
                  </div>
                </div>
              </div>
              <div className="table-responsive">
                <table className="table table-borderless align-middle mb-0" style={{ fontSize: "0.8rem" }}>
                  <thead className="table-light">
                    <tr>
                      <th>Driver</th>
                      <th>Seats</th>
                      <th>Utilization</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rides.length === 0 ? (
                      <tr><td colSpan={3} className="text-center text-muted py-4">No live local pool sessions.</td></tr>
                    ) : rides.slice(0, 6).map((ride: any) => {
                      const booked = parseInt(ride.bookedSeats) || 0;
                      const max = parseInt(ride.maxSeats) || 0;
                      const pct = max > 0 ? Math.round((booked / max) * 100) : 0;
                      return (
                        <tr key={ride.id}>
                          <td>
                            <div className="fw-semibold">{ride.driverName || "Driver"}</div>
                            <div className="text-muted" style={{ fontSize: "0.72rem" }}>{ride.driverPhone || ""}</div>
                          </td>
                          <td>{booked}/{max}</td>
                          <td>
                            <div className="d-flex align-items-center gap-2">
                              <div style={{ width: 84, height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                                <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: pct > 80 ? "#16a34a" : pct > 40 ? "#2563eb" : "#d97706" }}></div>
                              </div>
                              <span style={{ fontWeight: 700 }}>{pct}%</span>
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
          <div className="card h-100">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                  <h5 className="mb-1 text-primary">Pool Refund Review</h5>
                  <div className="text-muted" style={{ fontSize: "0.8rem" }}>Review pool cancellation refunds without leaving the pool ops page</div>
                </div>
                <span className="badge bg-danger-subtle text-danger">{pendingPoolRefunds.length} pending</span>
              </div>
              <div className="table-responsive">
                <table className="table table-borderless align-middle mb-0" style={{ fontSize: "0.8rem" }}>
                  <thead className="table-light">
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
                        <tr key={i}>{Array(4).fill(0).map((__, j) => <td key={j}><div style={{ height: 12, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                      ))
                    ) : poolRefunds.length === 0 ? (
                      <tr><td colSpan={4} className="text-center text-muted py-4">No pool refund requests yet.</td></tr>
                    ) : poolRefunds.slice(0, 6).map((item: any) => (
                      <tr key={item.id}>
                        <td>
                          <div className="fw-semibold">{item.customerName || "Customer"}</div>
                          <div className="text-muted" style={{ fontSize: "0.72rem" }}>{item.reason || "-"}</div>
                        </td>
                        <td className="fw-bold text-danger">{money(item.amount, 0)}</td>
                        <td><StatusBadge status={item.status || "pending"} /></td>
                        <td className="text-end">
                          {item.status === "pending" ? (
                            <div className="d-flex gap-2 justify-content-end">
                              <button className="btn btn-sm btn-success" disabled={updateRefund.isPending} onClick={() => updateRefund.mutate({ id: item.id, status: "approved", adminNote: "Approved from local pool refund review" })}>
                                Approve
                              </button>
                              <button className="btn btn-sm btn-outline-danger" disabled={updateRefund.isPending} onClick={() => updateRefund.mutate({ id: item.id, status: "rejected", adminNote: "Rejected from local pool refund review" })}>
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-muted" style={{ fontSize: "0.75rem" }}>Reviewed</span>
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

      <div className="card">
        <div className="card-body">
          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <h5 className="mb-0 text-primary me-2">Live Pool Sessions</h5>
            {["all", "active", "completed", "cancelled"].map(s => (
              <button key={s} className={`btn btn-sm ${statusFilter === s ? "btn-primary" : "btn-outline-secondary"}`}
                style={{ textTransform: "capitalize", padding: "3px 12px", fontSize: "0.78rem" }}
                onClick={() => setStatusFilter(s)}>
                {s}
              </button>
            ))}
            <button className="btn btn-sm btn-outline-primary ms-auto" onClick={() => qc.invalidateQueries({ queryKey: ["/api/admin/local-pool/rides"] })}>
              <i className="bi bi-arrow-clockwise"></i>
            </button>
          </div>

          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover" style={{ fontSize: "0.8rem" }}>
              <thead className="table-light" style={{ fontSize: "0.75rem" }}>
                <tr>
                  <th>#</th>
                  <th>Driver</th>
                  <th>Accepting</th>
                  <th>Seats</th>
                  <th>Fare/Seat</th>
                  <th>Passengers</th>
                  <th>GST</th>
                  <th>Commission</th>
                  <th>Revenue</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <tr key={i}>{Array(12).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                  ))
                ) : rides.length === 0 ? (
                  <tr><td colSpan={12}>
                    <div className="d-flex flex-column align-items-center gap-2 py-5">
                      <div style={{ width: 64, height: 64, borderRadius: 20, background: "linear-gradient(135deg,#eff6ff,#eef2ff)", display: "grid", placeItems: "center", border: "1px solid #dbeafe" }}>
                        <i className="bi bi-people" style={{ fontSize: "2rem", color: "#2563eb" }}></i>
                      </div>
                      <div className="fw-semibold">No active local pool sessions</div>
                      <p className="text-muted mb-0 text-center" style={{ maxWidth: 520 }}>
                        Once a pool-enabled pilot starts accepting local pool passengers, live seats, route occupancy, GST, commission and passenger status will appear here.
                      </p>
                      <button className="btn btn-sm btn-outline-primary mt-2" onClick={() => setSettingsOpen(true)}>
                        <i className="bi bi-gear me-1"></i> Review Pool Settings
                      </button>
                    </div>
                  </td></tr>
                ) : rides.map((r: any, i: number) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>
                      <div className="fw-semibold">{r.driverName || <span className="text-muted">Unassigned</span>}</div>
                      <div className="text-muted" style={{ fontSize: "0.7rem" }}>{r.driverPhone}</div>
                    </td>
                    <td>
                      <span className={`badge ${r.acceptingNewRequests === false ? "bg-warning text-dark" : "bg-success"}`}>
                        {r.acceptingNewRequests === false ? "Paused" : "Accepting"}
                      </span>
                    </td>
                    <td className="text-center">
                      <span style={{ fontWeight: 700 }}>{r.bookedSeats}</span>
                      <span className="text-muted">/{r.maxSeats}</span>
                    </td>
                    <td>{money(r.farePerSeat, 2)}</td>
                    <td className="text-center"><span style={{ fontWeight: 700, color: "#7c3aed" }}>{r.passengerCount ?? 0}</span></td>
                    <td>{money(r.totalGst)}</td>
                    <td>{money(r.totalCommission)}</td>
                    <td className="fw-semibold">{money(r.totalRevenue)}</td>
                    <td><StatusBadge status={r.status || "active"} /></td>
                    <td style={{ color: "#64748b" }}>{r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                    <td>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => setViewPassengersRideId(r.id)}>
                        <i className="bi bi-people me-1"></i>Passengers
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {settingsOpen && (
        <div className="modal-backdrop-jago">
          <div className="modal-jago" style={{ maxWidth: 420 }}>
            <div className="modal-jago-header">
              <h5 className="modal-jago-title">Local Pool Settings</h5>
              <button className="modal-jago-close" onClick={() => setSettingsOpen(false)}><i className="bi bi-x-lg"></i></button>
            </div>
            <div className="d-flex flex-column gap-3">
              <div>
                <label className="form-label-jago">Pool Mode</label>
                <select className="form-select" value={settingsForm.mode} onChange={e => setSettingsForm(f => ({ ...f, mode: e.target.value }))}>
                  <option value="on">On (active)</option>
                  <option value="off">Off (disabled)</option>
                </select>
                <small className="text-muted">When off, customers cannot book local pool rides.</small>
              </div>
              <div>
                <label className="form-label-jago">Collection Window (seconds)</label>
                <input type="number" className="form-control" value={settingsForm.collectionSecs} min="60" max="600" step="30"
                  onChange={e => setSettingsForm(f => ({ ...f, collectionSecs: e.target.value }))} />
                <small className="text-muted">Default: 300 seconds. Live rolling-pool sessions can pause accepting without ending the ride.</small>
              </div>
              <div className="row g-2">
                <div className="col-4">
                  <label className="form-label-jago">Radius km</label>
                  <input type="number" className="form-control" value={settingsForm.matchRadiusKm} min="1" max="12" step="0.5"
                    onChange={e => setSettingsForm(f => ({ ...f, matchRadiusKm: e.target.value }))} />
                </div>
                <div className="col-4">
                  <label className="form-label-jago">Detour km</label>
                  <input type="number" className="form-control" value={settingsForm.maxDetourKm} min="0.5" max="8" step="0.5"
                    onChange={e => setSettingsForm(f => ({ ...f, maxDetourKm: e.target.value }))} />
                </div>
                <div className="col-4">
                  <label className="form-label-jago">Direction</label>
                  <input type="number" className="form-control" value={settingsForm.directionToleranceDeg} min="15" max="90" step="5"
                    onChange={e => setSettingsForm(f => ({ ...f, directionToleranceDeg: e.target.value }))} />
                </div>
              </div>
              <small className="text-muted">Controls realtime matching strictness: pickup radius, max route detour and route-direction tolerance.</small>
              <hr className="my-1" />
              <div>
                <label className="form-label-jago fw-semibold">Per-Seat Fare Rate <span className="badge bg-danger ms-1" style={{ fontSize: 10 }}>Driver cannot change</span></label>
                <div className="row g-2">
                  <div className="col-6">
                    <label className="form-label-jago" style={{ fontSize: 11 }}>Base Fare (Rs./seat)</label>
                    <input type="number" className="form-control" value={settingsForm.baseFarePerSeat} min="0" step="1"
                      onChange={e => setSettingsForm(f => ({ ...f, baseFarePerSeat: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label-jago" style={{ fontSize: 11 }}>Rate per KM (Rs./km/seat)</label>
                    <input type="number" className="form-control" value={settingsForm.farePerKmPerSeat} min="0" step="0.5"
                      onChange={e => setSettingsForm(f => ({ ...f, farePerKmPerSeat: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="row g-2">
                <div className="col-4">
                  <label className="form-label-jago" style={{ fontSize: 11 }}>Min Fare/seat</label>
                  <input type="number" className="form-control" value={settingsForm.minFarePerSeat} min="0" step="5"
                    onChange={e => setSettingsForm(f => ({ ...f, minFarePerSeat: e.target.value }))} />
                </div>
                <div className="col-4">
                  <label className="form-label-jago" style={{ fontSize: 11 }}>Max Fare/seat</label>
                  <input type="number" className="form-control" value={settingsForm.maxFarePerSeat} min="0" step="10"
                    onChange={e => setSettingsForm(f => ({ ...f, maxFarePerSeat: e.target.value }))} />
                </div>
                <div className="col-4">
                  <label className="form-label-jago" style={{ fontSize: 11 }}>Max Seats/Booking</label>
                  <input type="number" className="form-control" value={settingsForm.maxSeatsPerBooking} min="1" max="4" step="1"
                    onChange={e => setSettingsForm(f => ({ ...f, maxSeatsPerBooking: e.target.value }))} />
                </div>
              </div>
              <small className="text-muted">Fare per seat = Base + (route km x Rate/km), clamped to Min/Max. Total charged = fare per seat x seats booked.</small>
              <div className="d-flex gap-2 justify-content-end mt-2">
                <button className="btn btn-outline-secondary" onClick={() => setSettingsOpen(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveSettings.mutate(buildSettingsPayload())} disabled={saveSettings.isPending}>
                  {saveSettings.isPending ? "Saving..." : "Save Settings"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewPassengersRideId && (
        <PassengersModal rideId={viewPassengersRideId} onClose={() => setViewPassengersRideId(null)} />
      )}
    </div>
  );
}
