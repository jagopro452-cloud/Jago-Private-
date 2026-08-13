import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { adminFetch, queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const ROUTES = [
  { from: "Hyderabad", to: "Bengaluru", km: 570 },
  { from: "Hyderabad", to: "Chennai", km: 620 },
  { from: "Hyderabad", to: "Mumbai", km: 715 },
  { from: "Hyderabad", to: "Vijayawada", km: 280 },
  { from: "Hyderabad", to: "Tirupati", km: 420 },
  { from: "Bengaluru", to: "Hyderabad", km: 570 },
  { from: "Vijayawada", to: "Hyderabad", km: 280 },
  { from: "Hyderabad", to: "Pune", km: 560 },
  { from: "Hyderabad", to: "Delhi", km: 1480 },
  { from: "Hyderabad", to: "Kolkata", km: 1200 },
];

const STATUS_CONFIG: any = {
  scheduled: { cls: "bg-primary",           label: "Scheduled",   color: "#1a73e8" },
  in_progress:{ cls: "bg-warning text-dark", label: "In Progress", color: "#d97706" },
  completed:  { cls: "bg-success",           label: "Completed",   color: "#16a34a" },
  cancelled:  { cls: "bg-danger",           label: "Cancelled",   color: "#dc2626" },
};

const BOOKING_STATUS: any = {
  confirmed:  { cls: "bg-success", label: "Confirmed" },
  cancelled:  { cls: "bg-danger",  label: "Cancelled" },
  completed:  { cls: "bg-info text-dark", label: "Completed" },
  pending:    { cls: "bg-warning text-dark", label: "Pending" },
};

const avatarBg = (name: string) => {
  const colors = ["#1a73e8","#16a34a","#d97706","#9333ea","#dc2626"];
  return colors[(name || "D").charCodeAt(0) % colors.length];
};
const initials = (name: string) => (name || "?").split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

function SeatMap({ total, booked }: { total: number; booked: number }) {
  const seats = Array.from({ length: total }, (_, i) => i < booked);
  return (
    <div className="d-flex gap-1 flex-wrap" style={{ maxWidth: 80 }}>
      {seats.map((taken, i) => (
        <div key={i} title={taken ? "Booked" : "Free"}
          style={{ width: 12, height: 16, borderRadius: 3, background: taken ? "#dc2626" : "#16a34a", border: "1px solid rgba(0,0,0,0.1)" }} />
      ))}
    </div>
  );
}

function SettingsTab({ settings, onSaved }: { settings: any; onSaved: () => void }) {
  const { toast } = useToast();
  const [s, setS] = useState<any>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings && Object.keys(settings).length > 0) setS(settings);
  }, [settings]);

  const set = (k: string, v: string) => { setS((p: any) => ({ ...p, [k]: v })); setDirty(true); };

  const saveMut = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", "/api/intercity-cs/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intercity-cs/settings"] });
      setDirty(false);
      toast({ title: "Settings saved!", description: "Intercity Pool settings updated." });
      onSaved();
    },
  });

  const moduleEnabled = s["module_enabled"] === "true" || s["module_enabled"] === true;

  // Live fare calculator
  const calcFare = (km: number, seats: number) => {
    const rateKm = parseFloat(s["rate_per_km_per_seat"] || "3.5");
    const gstPct = parseFloat(s["gst_pct"] || "5") / 100;
    const ins = parseFloat(s["insurance_per_seat"] || "15");
    const base = km * rateKm;
    const gst = base * gstPct;
    const total = base + gst + (ins * seats);
    return { base: base.toFixed(2), gst: gst.toFixed(2), ins: (ins * seats).toFixed(0), total: total.toFixed(2) };
  };

  const exampleKm = 570; // HYD-BLR
  const exCalc1 = calcFare(exampleKm, 1);
  const exCalc2 = calcFare(exampleKm, 2);

  return (
    <div>
      {/* Module Master Toggle */}
      <div className="card border-0 mb-4" style={{
        borderRadius: 16,
        border: `2px solid ${moduleEnabled ? "#bbf7d0" : "#fecaca"}`,
        background: moduleEnabled ? "#f0fdf4" : "#fff5f5",
      }}>
        <div className="card-body p-4">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
            <div className="d-flex align-items-center gap-3">
              <div className="rounded-3 d-flex align-items-center justify-content-center"
                style={{ width: 52, height: 52, background: moduleEnabled ? "#dcfce7" : "#fee2e2", fontSize: "1.4rem" }}>
                <i className={`bi ${moduleEnabled ? "bi-toggle-on" : "bi-toggle-off"}`}
                  style={{ color: moduleEnabled ? "#16a34a" : "#dc2626" }}></i>
              </div>
              <div>
                <div className="fw-bold" style={{ fontSize: 17 }}>
                  Intercity Pool Module
                  <span className={`badge ms-2 rounded-pill ${moduleEnabled ? "bg-success" : "bg-danger"}`}
                    style={{ fontSize: 11 }}>
                    {moduleEnabled ? "ACTIVE" : "INACTIVE"}
                  </span>
                </div>
                <div className="text-muted" style={{ fontSize: 12.5 }}>
                  {moduleEnabled
                    ? "Module is live - Drivers can post intercity rides, customers can book seats"
                    : "Module is disabled - Intercity Pool is hidden from drivers and customers"}
                </div>
              </div>
            </div>
            <div className="d-flex gap-2">
              <button className={`btn ${moduleEnabled ? "btn-danger" : "btn-success"} px-4`}
                disabled={saveMut.isPending}
                onClick={() => {
                  set("module_enabled", moduleEnabled ? "false" : "true");
                  setTimeout(() => saveMut.mutate({ ...s, module_enabled: moduleEnabled ? "false" : "true" }), 50);
                }}
                data-testid="btn-toggle-module">
                <i className={`bi ${moduleEnabled ? "bi-pause-circle" : "bi-play-circle"} me-2`}></i>
                {moduleEnabled ? "Deactivate Module" : "Activate Module"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Rate Settings */}
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div className="d-flex align-items-center gap-2">
            <div className="rounded-2 d-flex align-items-center justify-content-center"
              style={{ width: 32, height: 32, background: "#e8f0fe", color: "#1a73e8", fontSize: 14 }}>
              <i className="bi bi-calculator-fill"></i>
            </div>
            <span className="fw-semibold" style={{ fontSize: 14 }}>Rate Structure (Admin Fixed)</span>
            <span className="badge ms-1" style={{ background: "#fef9c3", color: "#92400e", fontSize: 10 }}>
              <i className="bi bi-lock-fill me-1"></i>Drivers cannot change rates
            </span>
          </div>
        </div>
        <div className="card-body p-4">
          <div className="row g-4">
            <div className="col-md-7">
              <div className="row g-3">
                {[
                  { key: "rate_per_km_per_seat", label: "Rate per KM per Seat (Rs.)", prefix: "Rs./km/seat", help: "e.g. Rs.3.5 -> 570km x Rs.3.5 = Rs.1,995 per seat (HYD-BLR)" },
                  { key: "gst_pct", label: "GST on Ride Fare (%)", prefix: "%", help: "e.g. 5% -> Applied on base fare (per seat)" },
                  { key: "insurance_per_seat", label: "Insurance per Seat (Rs.)", prefix: "Rs./seat", help: "Flat insurance per booked seat per trip" },
                  { key: "min_fare", label: "Minimum Fare per Seat (Rs.)", prefix: "Rs.", help: "No booking accepted below this fare" },
                  { key: "cancellation_hours", label: "Free Cancellation (Hours)", prefix: "hrs", help: "Customer can cancel free if before departure by these hours" },
                ].map(f => (
                  <div key={f.key} className="col-md-6">
                    <label className="form-label small fw-semibold text-muted mb-1">{f.label}</label>
                    <div className="input-group input-group-sm">
                      <input type="number" step="0.5" className="form-control" value={s[f.key] || ""}
                        onChange={e => set(f.key, e.target.value)} data-testid={`input-${f.key}`} />
                      <span className="input-group-text" style={{ fontSize: 10, color: "#64748b" }}>{f.prefix}</span>
                    </div>
                    <div className="form-text" style={{ fontSize: 10.5 }}>{f.help}</div>
                  </div>
                ))}
              </div>

              <div className="mt-3 p-3 rounded-3" style={{ background: "#fefce8", border: "1px solid #fde68a", fontSize: 12 }}>
                <div className="fw-semibold mb-1" style={{ color: "#92400e" }}><i className="bi bi-info-circle me-1"></i>Revenue Model: Commission via Seat Fare</div>
                <div style={{ color: "#78350f" }}>
                  Fare per seat = (KM x Rate/km/seat) + GST + Insurance<br/>
                  Platform earns: GST amount collected + Insurance amount<br/>
                  Driver earns: Base fare (KM x rate) per seat per booking
                </div>
              </div>
            </div>

            {/* Fare Calculator */}
            <div className="col-md-5">
              <div className="p-3 rounded-3 h-100" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div className="fw-semibold mb-3" style={{ fontSize: 13, color: "#1a73e8" }}>
                  <i className="bi bi-calculator me-1"></i>Live Fare Preview - HYD to BLR ({exampleKm} km)
                </div>

                {/* 1 seat */}
                <div className="mb-3 p-2 rounded-2" style={{ background: "white", border: "1px solid #e2e8f0" }}>
                  <div className="fw-semibold mb-2" style={{ fontSize: 12 }}>1 Seat Booking</div>
                  {[
                    { label: `Base (${exampleKm}km x Rs.${s["rate_per_km_per_seat"]||3.5})`, val: `Rs.${exCalc1.base}` },
                    { label: `GST (${s["gst_pct"]||5}%)`, val: `Rs.${exCalc1.gst}`, color: "#d97706" },
                    { label: `Insurance (1 seat)`, val: `Rs.${exCalc1.ins}`, color: "#7c3aed" },
                    { label: "Customer Pays", val: `Rs.${exCalc1.total}`, bold: true, color: "#dc2626" },
                  ].map((r, i) => (
                    <div key={i} className="d-flex justify-content-between" style={{ fontSize: 11.5, borderBottom: i < 3 ? "1px dashed #f1f5f9" : "none", padding: "2px 0" }}>
                      <span style={{ color: "#64748b" }}>{r.label}</span>
                      <span style={{ fontWeight: r.bold ? 700 : 600, color: r.color || "#0f172a" }}>{r.val}</span>
                    </div>
                  ))}
                </div>

                {/* 2 seats */}
                <div className="p-2 rounded-2" style={{ background: "white", border: "1px solid #e2e8f0" }}>
                  <div className="fw-semibold mb-2" style={{ fontSize: 12 }}>2 Seats Booking</div>
                  {[
                    { label: `Base x 2`, val: `Rs.${(parseFloat(exCalc2.base)).toFixed(2)}` },
                    { label: `GST (${s["gst_pct"]||5}%)`, val: `Rs.${exCalc2.gst}`, color: "#d97706" },
                    { label: `Insurance (2 seats)`, val: `Rs.${exCalc2.ins}`, color: "#7c3aed" },
                    { label: "Customer Pays", val: `Rs.${exCalc2.total}`, bold: true, color: "#dc2626" },
                  ].map((r, i) => (
                    <div key={i} className="d-flex justify-content-between" style={{ fontSize: 11.5, borderBottom: i < 3 ? "1px dashed #f1f5f9" : "none", padding: "2px 0" }}>
                      <span style={{ color: "#64748b" }}>{r.label}</span>
                      <span style={{ fontWeight: r.bold ? 700 : 600, color: r.color || "#0f172a" }}>{r.val}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-2 p-2 rounded-2" style={{ background: "#f0fdf4", fontSize: 11 }}>
                  <i className="bi bi-building me-1"></i>
                  <strong>Platform earns:</strong> GST + Insurance per booking | Driver keeps base fare
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="card-footer bg-transparent py-3 px-4">
          <button className="btn btn-primary px-5" disabled={!dirty || saveMut.isPending}
            onClick={() => saveMut.mutate(s)} data-testid="btn-save-settings">
            {saveMut.isPending ? <><span className="spinner-border spinner-border-sm me-2"></span>Saving...</> : <><i className="bi bi-save me-2"></i>Save Rate Settings</>}
          </button>
          {dirty && <span className="ms-3 text-warning small"><i className="bi bi-exclamation-triangle-fill me-1"></i>Unsaved changes</span>}
        </div>
      </div>
    </div>
  );
}

function RidesTab() {
  const { toast } = useToast();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/intercity-cs/rides", filter],
    queryFn: () => adminFetch(`/api/intercity-cs/rides${filter !== "all" ? `?status=${filter}` : ""}`).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => d?.data ? d : { data: Array.isArray(d) ? d : [], total: 0 }),
  });
  const rides: any[] = Array.isArray(data?.data) ? data.data : [];

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: any) => apiRequest("PATCH", `/api/intercity-cs/rides/${id}/toggle`, { isActive }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/intercity-cs/rides"] });
      toast({ title: vars.isActive ? "Ride Activated" : "Ride Deactivated" });
    },
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: any) => apiRequest("PATCH", `/api/intercity-cs/rides/${id}/status`, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/intercity-cs/rides"] }); toast({ title: "Status updated" }); },
  });

  const filtered = rides.filter(r => {
    if (search && !r.fromCity?.toLowerCase().includes(search.toLowerCase()) &&
        !r.toCity?.toLowerCase().includes(search.toLowerCase()) &&
        !r.driverName?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
      <div className="card-header bg-white py-3 px-4 d-flex align-items-center justify-content-between flex-wrap gap-2"
        style={{ borderBottom: "1px solid #f1f5f9" }}>
        <div className="d-flex gap-2 flex-wrap">
          {["all","scheduled","in_progress","completed","cancelled"].map(f => (
            <button key={f}
              className={`btn btn-sm rounded-pill ${filter === f ? (STATUS_CONFIG[f]?.cls || "btn-primary") : "btn-outline-secondary"}`}
              style={{ fontSize: 11, padding: "3px 12px" }}
              onClick={() => setFilter(f)} data-testid={`filter-rides-${f}`}>
              {f === "all" ? `All (${rides.length})` : `${STATUS_CONFIG[f]?.label} (${rides.filter(r => r.status === f).length})`}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "6px 12px" }}>
          <i className="bi bi-search" style={{ fontSize: 12, color: "#94a3b8" }}></i>
          <input style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, width: 150 }}
            placeholder="Search rides..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-rides-search" />
        </div>
      </div>

      <div className="table-responsive">
        <table className="table table-borderless align-middle table-hover mb-0">
          <thead style={{ background: "#f8fafc" }}>
            <tr>
              {["#","Route","Driver","Date / Time","Seats","Fare/Seat","Revenue","Status","Active","Action"].map((h, i) => (
                <th key={i} className={i === 0 ? "ps-4" : ""}
                  style={{ fontSize: 10.5, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", padding: "12px 8px" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? Array(5).fill(0).map((_, i) => (
              <tr key={i}>{Array(10).fill(0).map((_, j) => (
                <td key={j} className={j === 0 ? "ps-4" : ""}><div style={{ height: 13, background: "#f1f5f9", borderRadius: 4, width: j === 0 ? 20 : "85%" }} /></td>
              ))}</tr>
            )) : filtered.length === 0 ? (
              <tr><td colSpan={10}>
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-car-front fs-1 d-block mb-2" style={{ opacity: 0.2 }}></i>
                  <p className="fw-semibold mb-1">No rides found</p>
                </div>
              </td></tr>
            ) : filtered.map((r: any, idx: number) => {
              const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.scheduled;
              const bookedSeats = parseInt(r.bookedSeats || 0);
              const totalSeats = parseInt(r.totalSeats || 4);
              return (
                <tr key={r.id} data-testid={`row-ride-${r.id}`} style={{ background: !r.isActive ? "#f8fafc" : "white" }}>
                  <td className="ps-4 text-muted small">{idx + 1}</td>
                  <td>
                    <div className="fw-semibold" style={{ fontSize: 13 }}>
                      <span style={{ color: "#1a73e8" }}>{r.fromCity}</span>
                      <i className="bi bi-arrow-right mx-1" style={{ fontSize: 10, color: "#94a3b8" }}></i>
                      <span style={{ color: "#16a34a" }}>{r.toCity}</span>
                    </div>
                    <div className="text-muted" style={{ fontSize: 10.5 }}>
                      {r.routeKm ? `${r.routeKm} km` : ""}{r.vehicleModel ? ` Â· ${r.vehicleModel}` : ""}
                      {r.vehicleNumber ? ` Â· ${r.vehicleNumber}` : ""}
                    </div>
                  </td>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                        style={{ width: 28, height: 28, background: avatarBg(r.driverName || ""), color: "white", fontSize: 10, fontWeight: 700 }}>
                        {initials(r.driverName || "")}
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{r.driverName || "-"}</div>
                        <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{r.driverPhone || ""}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{fmtDate(r.departureDate)}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{r.departureTime}</div>
                  </td>
                  <td>
                    <SeatMap total={totalSeats} booked={bookedSeats} />
                    <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 2 }}>
                      {bookedSeats}/{totalSeats} booked
                      {r.confirmedBookings > 0 && <span className="ms-1 badge bg-light text-dark" style={{ fontSize: 9 }}>{r.confirmedBookings} orders</span>}
                    </div>
                  </td>
                  <td>
                    <div className="fw-semibold" style={{ fontSize: 13, color: "#7c3aed" }}>Rs.{parseFloat(r.farePerSeat || 0).toFixed(0)}</div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>per seat</div>
                  </td>
                  <td>
                    <div className="fw-semibold" style={{ fontSize: 12, color: "#16a34a" }}>Rs.{parseFloat(r.totalRevenue || 0).toFixed(0)}</div>
                  </td>
                  <td>
                    <span className={`badge ${sc.cls}`} style={{ fontSize: 10 }}>{sc.label}</span>
                  </td>
                  <td>
                    <div className="form-check form-switch mb-0" style={{ paddingLeft: 2.5 + "em" }}>
                      <input className="form-check-input" type="checkbox" role="switch"
                        checked={!!r.isActive} disabled={r.status === "completed" || r.status === "cancelled"}
                        onChange={e => toggleMut.mutate({ id: r.id, isActive: e.target.checked })}
                        data-testid={`switch-ride-${r.id}`} />
                    </div>
                  </td>
                  <td>
                    {r.status === "scheduled" && (
                      <div className="d-flex gap-1">
                        <button className="btn btn-sm btn-outline-danger rounded-pill px-2" style={{ fontSize: 10 }}
                          onClick={() => statusMut.mutate({ id: r.id, status: "cancelled" })}
                          data-testid={`btn-cancel-ride-${r.id}`}>
                          <i className="bi bi-x-circle me-1"></i>Cancel
                        </button>
                      </div>
                    )}
                    {r.status === "completed" && (
                      <span className="text-muted" style={{ fontSize: 10 }}>Done</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BookingsTab() {
  const [filter, setFilter] = useState("all");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/intercity-cs/bookings", filter],
    queryFn: () => adminFetch(`/api/intercity-cs/bookings${filter !== "all" ? `?status=${filter}` : ""}`).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => d?.data ? d : { data: Array.isArray(d) ? d : [], total: 0 }),
  });
  const bookings: any[] = Array.isArray(data?.data) ? data.data : [];

  const totalRevenue = bookings.filter(b => b.paymentStatus === "paid").reduce((s, b) => s + parseFloat(b.totalFare || 0), 0);
  const platformRevenue = bookings.filter(b => b.paymentStatus === "paid").reduce((s, b) => s + parseFloat(b.gstAmount || 0) + parseFloat(b.insuranceAmount || 0), 0);

  return (
    <div>
      <div className="row g-3 mb-3">
        {[
          { label: "Total Bookings", val: data?.total ?? "-", icon: "bi-ticket-fill", color: "#1a73e8", bg: "#e8f0fe" },
          { label: "Total Revenue", val: `Rs.${totalRevenue.toFixed(0)}`, icon: "bi-cash-stack", color: "#16a34a", bg: "#f0fdf4" },
          { label: "Platform Earnings", val: `Rs.${platformRevenue.toFixed(0)}`, icon: "bi-building", color: "#7c3aed", bg: "#f5f3ff" },
          { label: "Cancelled", val: bookings.filter(b => b.status === "cancelled").length, icon: "bi-x-circle-fill", color: "#dc2626", bg: "#fef2f2" },
        ].map((s, i) => (
          <div key={i} className="col-6 col-md-3">
            <div className="card border-0 shadow-sm" style={{ borderRadius: 12 }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center"
                  style={{ width: 38, height: 38, background: s.bg, color: s.color, fontSize: "1rem" }}>
                  <i className={`bi ${s.icon}`}></i>
                </div>
                <div>
                  <div className="fw-bold" style={{ fontSize: 17, color: s.color }}>{s.val}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{s.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div className="d-flex gap-2 flex-wrap">
            {["all","confirmed","cancelled","completed"].map(f => {
              const sc = BOOKING_STATUS[f] || { cls: "btn-primary", label: "All" };
              return (
                <button key={f}
                  className={`btn btn-sm rounded-pill ${filter === f ? sc.cls : "btn-outline-secondary"}`}
                  style={{ fontSize: 11, padding: "3px 12px" }}
                  onClick={() => setFilter(f)} data-testid={`filter-bookings-${f}`}>
                  {f.charAt(0).toUpperCase() + f.slice(1)} ({bookings.filter(b => f === "all" ? true : b.status === f).length})
                </button>
              );
            })}
          </div>
        </div>

        <div className="table-responsive">
          <table className="table table-borderless align-middle table-hover mb-0">
            <thead style={{ background: "#f8fafc" }}>
              <tr>
                {["#","Customer","Route","Driver","Date","Seats","Fare Break-up","Total","Status"].map((h, i) => (
                  <th key={i} className={i === 0 ? "ps-4" : ""}
                    style={{ fontSize: 10.5, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", padding: "12px 8px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? Array(5).fill(0).map((_, i) => (
                <tr key={i}>{Array(9).fill(0).map((_, j) => (
                  <td key={j}><div style={{ height: 13, background: "#f1f5f9", borderRadius: 4, width: "85%" }} /></td>
                ))}</tr>
              )) : bookings.length === 0 ? (
                <tr><td colSpan={9}>
                  <div className="text-center py-5 text-muted">
                    <i className="bi bi-ticket fs-1 d-block mb-2" style={{ opacity: 0.2 }}></i>
                    <p className="fw-semibold mb-1">No bookings found</p>
                  </div>
                </td></tr>
              ) : bookings.map((b: any, idx: number) => {
                const bs = BOOKING_STATUS[b.status] || BOOKING_STATUS.pending;
                const name = b.customerName || "Customer";
                return (
                  <tr key={b.id} data-testid={`row-booking-${b.id}`}>
                    <td className="ps-4 text-muted small">{idx + 1}</td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                          style={{ width: 28, height: 28, background: avatarBg(name), color: "white", fontSize: 10, fontWeight: 700 }}>
                          {initials(name)}
                        </div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{name}</div>
                          <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{b.customerPhone || ""}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        <span style={{ color: "#1a73e8" }}>{b.fromCity}</span>
                        <i className="bi bi-arrow-right mx-1" style={{ fontSize: 9, color: "#94a3b8" }}></i>
                        <span style={{ color: "#16a34a" }}>{b.toCity}</span>
                      </div>
                      {(b.pickupPoint || b.dropPoint) && (
                        <div style={{ fontSize: 10, color: "#94a3b8" }}>{b.pickupPoint} {"->"} {b.dropPoint}</div>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>{b.driverName || "-"}</td>
                    <td style={{ fontSize: 11.5 }}>{fmtDate(b.departureDate)}</td>
                    <td>
                      <div className="d-flex gap-1">
                        {Array.from({ length: parseInt(b.seats || 1) }, (_, i) => (
                          <div key={i} style={{ width: 10, height: 14, borderRadius: 2, background: "#1a73e8" }} />
                        ))}
                      </div>
                      <div style={{ fontSize: 10, color: "#64748b" }}>{b.seats} seat{b.seats > 1 ? "s" : ""}</div>
                    </td>
                    <td>
                      <div style={{ fontSize: 10.5 }}>
                        <div>Base: Rs.{parseFloat(b.baseFare || 0).toFixed(0)}</div>
                        <div style={{ color: "#d97706" }}>GST: Rs.{parseFloat(b.gstAmount || 0).toFixed(1)}</div>
                        <div style={{ color: "#7c3aed" }}>Ins: Rs.{parseFloat(b.insuranceAmount || 0).toFixed(0)}</div>
                      </div>
                    </td>
                    <td>
                      <div className="fw-bold text-danger" style={{ fontSize: 13 }}>Rs.{parseFloat(b.totalFare || 0).toFixed(0)}</div>
                      <span className={`badge ${b.paymentStatus === "paid" ? "bg-success" : "bg-warning text-dark"}`} style={{ fontSize: 9 }}>
                        {b.paymentStatus}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${bs.cls}`} style={{ fontSize: 10 }}>{bs.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function IntercarysharingPage() {
  const [tab, setTab] = useState<"rides" | "bookings" | "settings">("rides");

  const { data: settings, isLoading: settLoading } = useQuery<any>({
    queryKey: ["/api/intercity-cs/settings"],
    queryFn: () => adminFetch("/api/intercity-cs/settings").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => (d && !d.message && !d.error) ? d : {}),
  });

  const { data: ridesData } = useQuery<any>({
    queryKey: ["/api/intercity-cs/rides", "all"],
    queryFn: () => adminFetch("/api/intercity-cs/rides").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => d?.data ? d : { data: Array.isArray(d) ? d : [] }),
  });
  const rides: any[] = Array.isArray(ridesData?.data) ? ridesData.data : [];
  const moduleEnabled = settings?.module_enabled === "true";

  const scheduledCount = rides.filter(r => r.status === "scheduled").length;
  const totalRevenue = rides.reduce((s, r) => s + parseFloat(r.totalRevenue || 0), 0);

  return (
    <div className="container-fluid">
      {/* Header */}
      <div className="d-flex align-items-start justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">Intercity Pool</h4>
          <div className="text-muted small">Admin-fixed rates Â· Seat-wise pricing Â· Commission via GST + Insurance</div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className={`badge rounded-pill ${moduleEnabled ? "bg-success" : "bg-danger"}`}
            style={{ fontSize: 12, padding: "7px 14px" }}>
            <i className={`bi ${moduleEnabled ? "bi-toggle-on" : "bi-toggle-off"} me-1`}></i>
            {moduleEnabled ? "Module Active" : "Module Disabled"}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="row g-3 mb-4">
        {[
          { label: "Total Rides", val: rides.length, icon: "bi-car-front-fill", color: "#1a73e8", bg: "#e8f0fe" },
          { label: "Scheduled", val: scheduledCount, icon: "bi-calendar-check-fill", color: "#16a34a", bg: "#f0fdf4" },
          { label: "Total Revenue", val: `Rs.${totalRevenue.toFixed(0)}`, icon: "bi-cash-stack", color: "#7c3aed", bg: "#f5f3ff" },
          { label: "Active Drivers", val: rides.filter(r => r.isActive && r.status === "scheduled").length, icon: "bi-person-fill-check", color: "#d97706", bg: "#fefce8" },
        ].map((s, i) => (
          <div key={i} className="col-6 col-md-3">
            <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center"
                  style={{ width: 42, height: 42, background: s.bg, color: s.color, fontSize: "1.1rem" }}>
                  <i className={`bi ${s.icon}`}></i>
                </div>
                <div>
                  <div className="fw-bold lh-1 mb-1" style={{ fontSize: 20, color: s.color }}>{s.val}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{s.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-0 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <ul className="nav nav-tabs border-0">
            {([
              { key: "rides", label: "Shared Rides", icon: "bi-car-front-fill", count: rides.length },
              { key: "bookings", label: "Bookings", icon: "bi-ticket-fill" },
              { key: "settings", label: "Rate Settings", icon: "bi-gear-fill" },
            ] as any[]).map(t => (
              <li key={t.key} className="nav-item">
                <button
                  className={`nav-link d-flex align-items-center gap-2 ${tab === t.key ? "active fw-semibold" : "text-muted"}`}
                  style={{ fontSize: 13, padding: "14px 18px", border: "none", borderBottom: tab === t.key ? "2px solid #1a73e8" : "2px solid transparent", color: tab === t.key ? "#1a73e8" : undefined }}
                  onClick={() => setTab(t.key)}
                  data-testid={`tab-${t.key}`}>
                  <i className={`bi ${t.icon}`}></i>
                  {t.label}
                  {t.count !== undefined && (
                    <span className="badge rounded-pill bg-light text-dark" style={{ fontSize: 10 }}>{t.count}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Tab content */}
      {tab === "rides" && <RidesTab />}
      {tab === "bookings" && <BookingsTab />}
      {tab === "settings" && !settLoading && <SettingsTab settings={settings || {}} onSaved={() => {}} />}
      {tab === "settings" && settLoading && <div className="text-center py-5"><div className="spinner-border text-primary" /></div>}
    </div>
  );
}


