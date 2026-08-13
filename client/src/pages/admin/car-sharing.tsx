import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { adminFetch, queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const RIDE_STATUS_BADGE: Record<string, string> = {
  active: "bg-success",
  scheduled: "bg-info text-dark",
  completed: "bg-secondary",
  cancelled: "bg-danger",
  ongoing: "bg-warning text-dark",
};

const BOOKING_STATUS_BADGE: Record<string, string> = {
  confirmed: "bg-success",
  completed: "bg-secondary",
  cancelled: "bg-danger",
  pending: "bg-warning text-dark",
};

function SeatDisplay({ booked, max }: { booked: number; max: number }) {
  return (
    <div className="d-flex gap-1 flex-wrap align-items-center">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          title={i < booked ? "Booked" : "Available"}
          style={{
            width: 20, height: 20, borderRadius: 4,
            background: i < booked ? "#dc2626" : "#16a34a",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, color: "white",
          }}
        >
          <i className="bi bi-person-fill" style={{ fontSize: 9 }}></i>
        </div>
      ))}
      <span style={{ fontSize: 11, color: "#64748b", marginLeft: 4 }}>
        {max - booked} free
      </span>
    </div>
  );
}

export default function CarSharingPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"rides" | "bookings" | "settings">(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "bookings" || t === "settings" ? t : "rides";
  });
  const [rideFilter, setRideFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);

  const { data: statsData } = useQuery<any>({
    queryKey: ["/api/car-sharing/stats"],
    queryFn: () => apiRequest("GET", "/api/car-sharing/stats").then(r => r.json()).then(d => (d && !d.message) ? d : {}),
  });
  const stats = statsData || {};

  const { data: ridesData, isLoading: ridesLoading } = useQuery<any>({
    queryKey: ["/api/car-sharing/rides"],
    queryFn: () => adminFetch("/api/car-sharing/rides").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => d?.data ? d : { data: Array.isArray(d) ? d : [] }),
  });
  const allRides: any[] = Array.isArray(ridesData?.data) ? ridesData.data : [];

  const { data: bookingsData, isLoading: bookingsLoading } = useQuery<any>({
    queryKey: ["/api/car-sharing/bookings"],
    queryFn: () => adminFetch("/api/car-sharing/bookings").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => d?.data ? d : { data: Array.isArray(d) ? d : [] }),
    enabled: tab === "bookings",
  });
  const allBookings: any[] = Array.isArray(bookingsData?.data) ? bookingsData.data : [];

  const { data: settingsData, isLoading: settingsLoading } = useQuery<any>({
    queryKey: ["/api/car-sharing/settings"],
    queryFn: () => adminFetch("/api/car-sharing/settings").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => (d && !d.message && !d.error) ? d : {}),
    enabled: tab === "settings",
  });

  useEffect(() => {
    if (settingsData && !settingsDirty) {
      setSettings(settingsData);
    }
  }, [settingsData]);

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: any) =>
      apiRequest("PATCH", `/api/car-sharing/rides/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/car-sharing/rides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/car-sharing/stats"] });
      toast({ title: "Status updated" });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", "/api/car-sharing/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/car-sharing/settings"] });
      setSettingsDirty(false);
      toast({ title: "Settings saved", description: "Car sharing settings updated successfully." });
    },
  });

  const filteredRides = allRides.filter(r => {
    if (rideFilter !== "all" && r.status !== rideFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.driverName?.toLowerCase().includes(q) || r.fromLocation?.toLowerCase().includes(q) || r.toLocation?.toLowerCase().includes(q);
    }
    return true;
  });

  const handleSettingChange = (key: string, val: string) => {
    setSettings(prev => ({ ...prev, [key]: val }));
    setSettingsDirty(true);
  };

  const statCards = [
    { label: "Total Rides", val: stats.totalRides ?? "-", icon: "bi-people-fill", color: "#1a73e8", bg: "#e8f0fe" },
    { label: "Active Rides", val: stats.activeRides ?? "-", icon: "bi-car-front-fill", color: "#16a34a", bg: "#f0fdf4" },
    { label: "Completed", val: stats.completedRides ?? "-", icon: "bi-check-circle-fill", color: "#64748b", bg: "#f1f5f9" },
    { label: "Seats Sold", val: stats.seatsSold ?? "-", icon: "bi-person-check-fill", color: "#7c3aed", bg: "#f5f3ff" },
    { label: "Total Bookings", val: stats.totalBookings ?? "-", icon: "bi-ticket-fill", color: "#d97706", bg: "#fefce8" },
    { label: "Revenue", val: stats.totalRevenue != null ? `Rs.${Number(stats.totalRevenue).toFixed(0)}` : "-", icon: "bi-currency-rupee", color: "#16a34a", bg: "#f0fdf4" },
  ];

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">Local Pool</h4>
          <div className="text-muted small">Local city pool service - Admin-fixed km-based fare, driver offers seats on their route</div>
        </div>
        <div className="d-flex gap-2 align-items-center">
          <span className="badge rounded-pill" style={{ background: "#e8f0fe", color: "#1a73e8", fontSize: 12, padding: "6px 14px" }}>
            <i className="bi bi-shield-check me-1"></i>
            {stats.seatsSold ?? 0}/{stats.seatsTotal ?? 0} Seats Filled
          </span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="row g-3 mb-3">
        {statCards.map((s, i) => (
          <div key={i} className="col-6 col-xl-2">
            <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: 42, height: 42, background: s.bg, color: s.color, fontSize: "1.1rem" }}>
                  <i className={`bi ${s.icon}`}></i>
                </div>
                <div>
                  <div className="fw-bold lh-1 mb-1" style={{ fontSize: 18, color: s.color }}>{s.val}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{s.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* How it works strip */}
      <div className="card border-0 mb-3" style={{ background: "#f0f9ff", borderRadius: 12, border: "1px solid #bae6fd" }}>
        <div className="card-body py-2 px-4">
          <div className="d-flex flex-wrap align-items-center gap-3" style={{ fontSize: 12.5, color: "#0369a1" }}>
            <span className="fw-semibold"><i className="bi bi-info-circle me-1"></i>How Local Pool Works:</span>
            <span><i className="bi bi-1-circle-fill me-1"></i><strong>Admin</strong> fixes rate (Rs./km/seat) - driver cannot change it</span>
            <i className="bi bi-chevron-right" style={{ fontSize: 10 }}></i>
            <span><i className="bi bi-2-circle-fill me-1"></i>Driver sets route, departure time &amp; available seats</span>
            <i className="bi bi-chevron-right" style={{ fontSize: 10 }}></i>
            <span><i className="bi bi-3-circle-fill me-1"></i>System auto-calculates fare: Base + (km x Rs./km) x seats</span>
            <i className="bi bi-chevron-right" style={{ fontSize: 10 }}></i>
            <span><i className="bi bi-4-circle-fill me-1"></i>Customer books 1 or 2 seats - driver earns, platform takes commission</span>
          </div>
        </div>
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        {/* Tabs */}
        <div className="card-header bg-white d-flex align-items-center justify-content-between flex-wrap gap-2 py-3 px-4"
          style={{ borderBottom: "1px solid #f1f5f9" }}>
          <ul className="nav nav--tabs p-1 rounded bg-light">
            {([
              { key: "rides", label: "Shared Rides", icon: "bi-car-front-fill" },
              { key: "bookings", label: "Bookings", icon: "bi-ticket-fill" },
              { key: "settings", label: "Pricing Settings", icon: "bi-gear-fill" },
            ] as const).map(t => (
              <li key={t.key} className="nav-item">
                <button className={`nav-link${tab === t.key ? " active" : ""}`}
                  onClick={() => setTab(t.key)} data-testid={`tab-cs-${t.key}`}>
                  <i className={`bi ${t.icon} me-1`}></i>{t.label}
                </button>
              </li>
            ))}
          </ul>

          {tab !== "settings" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "6px 12px" }}>
              <i className="bi bi-search" style={{ fontSize: 12, color: "#94a3b8" }}></i>
              <input style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, width: 180 }}
                placeholder={tab === "rides" ? "Search driver, route..." : "Search customer..."}
                value={search} onChange={e => setSearch(e.target.value)} data-testid="input-cs-search" />
            </div>
          )}
        </div>

        {/* â”€â”€ Rides Tab â”€â”€ */}
        {tab === "rides" && (
          <>
            <div className="px-4 pt-3 pb-2 d-flex gap-2 flex-wrap">
              {(["all", "active", "scheduled", "completed", "cancelled"] as const).map(s => (
                <button key={s}
                  className={`btn btn-sm rounded-pill ${rideFilter === s ? "btn-primary" : "btn-outline-secondary"}`}
                  style={{ fontSize: 11, padding: "3px 12px" }}
                  onClick={() => setRideFilter(s)} data-testid={`filter-cs-${s}`}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                  {s !== "all" && <span className="ms-1">({allRides.filter(r => r.status === s).length})</span>}
                </button>
              ))}
            </div>
            <div className="table-responsive">
              <table className="table table-borderless align-middle table-hover mb-0">
                <thead style={{ background: "#f8fafc" }}>
                  <tr>
                    {["#", "Driver", "Route", "Departure", "Vehicle", "Fare/Seat (Admin)", "Seats", "Status", "Actions"].map((h, i) => (
                      <th key={i} className={i === 0 ? "ps-4" : ""}
                        style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", padding: "12px 8px" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ridesLoading ? Array(4).fill(0).map((_, i) => (
                    <tr key={i}>{Array(9).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                  )) : filteredRides.length === 0 ? (
                    <tr><td colSpan={9}>
                      <div className="text-center py-5 text-muted">
                        <i className="bi bi-car-front-fill fs-1 d-block mb-2" style={{ opacity: 0.2 }}></i>
                        <p className="fw-semibold mb-1">No shared rides found</p>
                        <p className="small">Drivers opt-in via the app to offer car sharing on their routes</p>
                      </div>
                    </td></tr>
                  ) : filteredRides.map((ride: any, idx: number) => (
                    <tr key={ride.id} data-testid={`row-cs-ride-${ride.id}`}>
                      <td className="ps-4 text-muted small">{idx + 1}</td>
                      <td>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{ride.driverName || "-"}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>{ride.driverPhone || ""}</div>
                      </td>
                      <td style={{ maxWidth: 200 }}>
                        <div style={{ fontSize: 12 }}>
                          <i className="bi bi-geo-alt-fill text-success me-1" style={{ fontSize: 10 }}></i>
                          {ride.fromLocation}
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                          <i className="bi bi-geo-alt-fill text-danger me-1" style={{ fontSize: 10 }}></i>
                          {ride.toLocation}
                        </div>
                      </td>
                      <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                        {ride.departureTime ? new Date(ride.departureTime).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "-"}
                      </td>
                      <td style={{ fontSize: 12, color: "#64748b" }}>{ride.vehicleName || "-"}</td>
                      <td>
                        <div>
                          <span className="fw-semibold" style={{ fontSize: 14, color: "#16a34a" }}>
                            Rs.{parseFloat(ride.seatPrice || 0).toFixed(0)}
                          </span>
                          <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400 }}>/seat</span>
                        </div>
                        <div style={{ fontSize: 10, color: "#1a73e8" }}>
                          <i className="bi bi-lock-fill me-1" style={{ fontSize: 8 }}></i>
                          {ride.routeDescription || "Admin rate"}
                        </div>
                      </td>
                      <td>
                        <SeatDisplay booked={parseInt(ride.seatsBooked || 0)} max={parseInt(ride.maxSeats || 3)} />
                      </td>
                      <td>
                        <span className={`badge ${RIDE_STATUS_BADGE[ride.status] || "bg-secondary"}`} style={{ fontSize: 10 }}>
                          {ride.status}
                        </span>
                      </td>
                      <td>
                        <select className="form-select form-select-sm" style={{ fontSize: 11, width: 110 }}
                          value={ride.status}
                          onChange={e => statusMutation.mutate({ id: ride.id, status: e.target.value })}
                          data-testid={`select-ride-status-${ride.id}`}>
                          <option value="scheduled">Scheduled</option>
                          <option value="active">Active</option>
                          <option value="ongoing">Ongoing</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* â”€â”€ Bookings Tab â”€â”€ */}
        {tab === "bookings" && (
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover mb-0">
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  {["#", "Customer", "Driver", "Route", "Seats", "Fare", "Payment", "Status", "Booked On"].map((h, i) => (
                    <th key={i} className={i === 0 ? "ps-4" : ""}
                      style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", padding: "12px 8px" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bookingsLoading ? Array(4).fill(0).map((_, i) => (
                  <tr key={i}>{Array(9).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                )) : allBookings.filter(b => !search || b.customerName?.toLowerCase().includes(search.toLowerCase())).length === 0 ? (
                  <tr><td colSpan={9}>
                    <div className="text-center py-5 text-muted">
                      <i className="bi bi-ticket-fill fs-1 d-block mb-2" style={{ opacity: 0.2 }}></i>
                      <p className="fw-semibold mb-1">No bookings found</p>
                    </div>
                  </td></tr>
                ) : allBookings
                  .filter(b => !search || b.customerName?.toLowerCase().includes(search.toLowerCase()))
                  .map((b: any, idx: number) => (
                    <tr key={b.id} data-testid={`row-cs-booking-${b.id}`}>
                      <td className="ps-4 text-muted small">{idx + 1}</td>
                      <td>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{b.customerName || "-"}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>{b.customerPhone || ""}</div>
                      </td>
                      <td>
                        <div style={{ fontSize: 12 }}>{b.driverName || "-"}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>{b.vehicleName || ""}</div>
                      </td>
                      <td style={{ maxWidth: 180 }}>
                        <div style={{ fontSize: 11 }}>
                          <i className="bi bi-geo-alt-fill text-success me-1" style={{ fontSize: 9 }}></i>
                          {b.pickupAddress || b.fromLocation || "-"}
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                          <i className="bi bi-geo-alt-fill text-danger me-1" style={{ fontSize: 9 }}></i>
                          {b.dropAddress || b.toLocation || "-"}
                        </div>
                      </td>
                      <td>
                        <div className="d-flex align-items-center gap-1">
                          <span className="fw-bold" style={{ fontSize: 18, color: "#1a73e8" }}>{b.seatsBooked}</span>
                          <span style={{ fontSize: 10, color: "#94a3b8" }}>
                            seat{b.seatsBooked > 1 ? "s" : ""}<br />
                            xRs.{parseFloat(b.seatPrice || 0).toFixed(0)}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="fw-semibold" style={{ fontSize: 14, color: "#16a34a" }}>
                          Rs.{parseFloat(b.totalFare || 0).toFixed(0)}
                        </span>
                      </td>
                      <td>
                        <span className="badge bg-light text-dark" style={{ fontSize: 10, border: "1px solid #e2e8f0" }}>
                          {b.paymentMethod || "cash"}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${BOOKING_STATUS_BADGE[b.status] || "bg-secondary"}`} style={{ fontSize: 10 }}>
                          {b.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>
                        {b.createdAt ? new Date(b.createdAt).toLocaleDateString("en-IN") : "-"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {/* â”€â”€ Settings Tab â”€â”€ */}
        {tab === "settings" && (
          <div className="card-body px-4 py-4">
            {settingsLoading ? (
              <div className="text-center py-5 text-muted"><div className="spinner-border spinner-border-sm me-2"></div>Loading settings...</div>
            ) : (
              <div className="row g-4">
                {/* Admin Fare Rate - PRIMARY SECTION */}
                <div className="col-12">
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <div className="rounded-2 d-flex align-items-center justify-content-center"
                      style={{ width: 32, height: 32, background: "#e8f0fe", color: "#1a73e8" }}>
                      <i className="bi bi-speedometer2"></i>
                    </div>
                    <div>
                      <span className="fw-semibold" style={{ fontSize: 15 }}>Admin-Fixed Fare Rate</span>
                      <span className="badge ms-2" style={{ background: "#dc2626", fontSize: 10 }}>Driver cannot change</span>
                    </div>
                  </div>
                  <div className="text-muted mb-3" style={{ fontSize: 12 }}>
                    Fare Formula: <strong>Fare per Seat = Base Fare + (Distance km x Rate/km)</strong> - system auto-calculates when driver creates a ride
                  </div>
                  {/* Live preview */}
                  <div className="p-3 mb-3 rounded-3" style={{ background: "#f0f9ff", border: "1px dashed #93c5fd" }}>
                    <div style={{ fontSize: 12.5, color: "#1E5FCC" }}>
                      <i className="bi bi-calculator me-1"></i>
                      <strong>Example:</strong> 10 km route {"->"}
                      Rs.{settings["base_fare_per_seat"] || 20} base + (10 x Rs.{settings["fare_per_km_per_seat"] || 5}) =
                      <strong> Rs.{(parseFloat(settings["base_fare_per_seat"] || "20") + 10 * parseFloat(settings["fare_per_km_per_seat"] || "5")).toFixed(0)} per seat</strong>
                      {" | "}2 seats booked {"->"}
                      <strong style={{ color: "#16a34a" }}> Rs.{(2 * (parseFloat(settings["base_fare_per_seat"] || "20") + 10 * parseFloat(settings["fare_per_km_per_seat"] || "5"))).toFixed(0)} total fare</strong>
                    </div>
                  </div>
                  <div className="row g-3">
                    {[
                      { key: "base_fare_per_seat", label: "Base Fare per Seat (Rs.)", prefix: "Rs.", placeholder: "20", help: "Fixed base charge per seat regardless of distance" },
                      { key: "fare_per_km_per_seat", label: "Rate per KM per Seat (Rs.)", prefix: "Rs./km", placeholder: "5", help: "Per km charge multiplied by distance of the route" },
                      { key: "platform_commission_pct", label: "Platform Commission (%)", prefix: "%", placeholder: "12", help: "% deducted from total fare as platform earnings" },
                    ].map(field => (
                      <div key={field.key} className="col-md-4">
                        <label className="form-label small fw-semibold text-muted">{field.label}</label>
                        <div className="input-group input-group-sm">
                          <span className="input-group-text fw-semibold" style={{ color: "#1a73e8", minWidth: 48 }}>{field.prefix}</span>
                          <input type="number" step="0.5" className="form-control" placeholder={field.placeholder}
                            value={settings[field.key] || ""}
                            onChange={e => handleSettingChange(field.key, e.target.value)}
                            data-testid={`input-cs-${field.key}`} />
                        </div>
                        <div className="form-text" style={{ fontSize: 10.5 }}>{field.help}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="col-12"><hr style={{ borderColor: "#f1f5f9" }} /></div>

                {/* Fare Caps */}
                <div className="col-12">
                  <div className="d-flex align-items-center gap-2 mb-3">
                    <div className="rounded-2 d-flex align-items-center justify-content-center"
                      style={{ width: 32, height: 32, background: "#fef2f2", color: "#dc2626" }}>
                      <i className="bi bi-slash-circle"></i>
                    </div>
                    <span className="fw-semibold" style={{ fontSize: 15 }}>Fare Caps (Safety Limits)</span>
                  </div>
                  <div className="row g-3">
                    {[
                      { key: "min_fare_per_seat", label: "Minimum Fare per Seat (Rs.)", prefix: "Rs.", placeholder: "30", help: "Fare won't go below this even for very short routes" },
                      { key: "max_fare_per_seat", label: "Maximum Fare per Seat (Rs.)", prefix: "Rs.", placeholder: "500", help: "Fare won't exceed this even for very long routes" },
                    ].map(field => (
                      <div key={field.key} className="col-md-4">
                        <label className="form-label small fw-semibold text-muted">{field.label}</label>
                        <div className="input-group input-group-sm">
                          <span className="input-group-text">{field.prefix}</span>
                          <input type="number" className="form-control" placeholder={field.placeholder}
                            value={settings[field.key] || ""}
                            onChange={e => handleSettingChange(field.key, e.target.value)}
                            data-testid={`input-cs-${field.key}`} />
                        </div>
                        <div className="form-text" style={{ fontSize: 10.5 }}>{field.help}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="col-12"><hr style={{ borderColor: "#f1f5f9" }} /></div>

                {/* Booking Rules */}
                <div className="col-12">
                  <div className="d-flex align-items-center gap-2 mb-3">
                    <div className="rounded-2 d-flex align-items-center justify-content-center"
                      style={{ width: 32, height: 32, background: "#f0fdf4", color: "#16a34a" }}>
                      <i className="bi bi-ticket-fill"></i>
                    </div>
                    <span className="fw-semibold" style={{ fontSize: 15 }}>Booking Rules</span>
                  </div>
                  <div className="row g-3">
                    {[
                      { key: "max_seats_per_booking", label: "Max Seats per Booking", placeholder: "2", help: "Max seats one customer can book per ride (usually 1 or 2)" },
                      { key: "advance_booking_hours", label: "Advance Booking Window (hrs)", placeholder: "24", help: "How many hours ahead a customer can book" },
                      { key: "matching_radius_km", label: "Route Matching Radius (km)", placeholder: "2", help: "Pickup must be within this distance from driver route" },
                    ].map(field => (
                      <div key={field.key} className="col-md-4">
                        <label className="form-label small fw-semibold text-muted">{field.label}</label>
                        <input type="number" className="form-control form-control-sm" placeholder={field.placeholder}
                          value={settings[field.key] || ""}
                          onChange={e => handleSettingChange(field.key, e.target.value)}
                          data-testid={`input-cs-${field.key}`} />
                        <div className="form-text" style={{ fontSize: 10.5 }}>{field.help}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="col-12"><hr style={{ borderColor: "#f1f5f9" }} /></div>

                {/* Vehicle Seat Capacity */}
                <div className="col-12">
                  <div className="d-flex align-items-center gap-2 mb-3">
                    <div className="rounded-2 d-flex align-items-center justify-content-center"
                      style={{ width: 32, height: 32, background: "#f5f3ff", color: "#7c3aed" }}>
                      <i className="bi bi-car-front-fill"></i>
                    </div>
                    <span className="fw-semibold" style={{ fontSize: 15 }}>Max Sharable Seats by Vehicle Type</span>
                  </div>
                  <div className="row g-3">
                    {[
                      { key: "max_seats_sedan", label: "Sedan / Car", placeholder: "3", help: "Total passenger seats available for sharing" },
                      { key: "max_seats_suv", label: "SUV / MUV", placeholder: "5", help: "Total passenger seats available for sharing" },
                      { key: "max_seats_auto", label: "Auto Rickshaw", placeholder: "2", help: "Total passenger seats available for sharing" },
                    ].map(field => (
                      <div key={field.key} className="col-md-4">
                        <label className="form-label small fw-semibold text-muted">{field.label}</label>
                        <input type="number" className="form-control form-control-sm" placeholder={field.placeholder}
                          value={settings[field.key] || ""}
                          onChange={e => handleSettingChange(field.key, e.target.value)}
                          data-testid={`input-cs-${field.key}`} />
                        <div className="form-text" style={{ fontSize: 10.5 }}>{field.help}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="col-12"><hr style={{ borderColor: "#f1f5f9" }} /></div>

                {/* Auto confirm toggle */}
                <div className="col-12">
                  <div className="d-flex align-items-center gap-2 mb-3">
                    <div className="rounded-2 d-flex align-items-center justify-content-center"
                      style={{ width: 32, height: 32, background: "#fefce8", color: "#d97706" }}>
                      <i className="bi bi-toggle-on"></i>
                    </div>
                    <span className="fw-semibold" style={{ fontSize: 15 }}>Booking Behaviour</span>
                  </div>
                  <div className="form-check form-switch" style={{ paddingLeft: "2.5rem" }}>
                    <input className="form-check-input" type="checkbox" role="switch"
                      id="autoConfirm"
                      checked={settings["auto_confirm_bookings"] === "true"}
                      onChange={e => handleSettingChange("auto_confirm_bookings", e.target.checked ? "true" : "false")}
                      data-testid="switch-auto-confirm" />
                    <label className="form-check-label fw-semibold" htmlFor="autoConfirm" style={{ fontSize: 14 }}>
                      Auto-confirm bookings
                    </label>
                    <div className="text-muted" style={{ fontSize: 11.5 }}>
                      When ON: bookings are instantly confirmed without driver approval. When OFF: driver must accept each booking request.
                    </div>
                  </div>
                </div>

                <div className="col-12 d-flex gap-2">
                  <button className="btn btn-primary px-4"
                    disabled={!settingsDirty || settingsMutation.isPending}
                    onClick={() => settingsMutation.mutate(settings)}
                    data-testid="btn-save-cs-settings">
                    {settingsMutation.isPending ? <><span className="spinner-border spinner-border-sm me-2"></span>Saving...</> : <><i className="bi bi-save me-2"></i>Save Settings</>}
                  </button>
                  {settingsDirty && (
                    <span className="text-warning d-flex align-items-center" style={{ fontSize: 12 }}>
                      <i className="bi bi-exclamation-circle me-1"></i>Unsaved changes
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


