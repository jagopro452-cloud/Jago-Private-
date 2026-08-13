import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/queryClient";

const STATUS_COLORS: any = {
  approved: { bg: "#d1fae5", color: "#065f46", label: "Active" },
  pending: { bg: "#fef3c7", color: "#92400e", label: "Pending" },
  rejected: { bg: "#fee2e2", color: "#991b1b", label: "Rejected" },
};

function normalizeArrayPayload(payload: unknown, keys: string[] = []): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    if (Array.isArray(value.data)) return value.data;
    for (const key of keys) {
      if (Array.isArray(value[key])) return value[key] as any[];
    }
  }
  return [];
}

function DriverDetail({ driver, onClose }: { driver: any; onClose: () => void }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/driver-earnings", driver.id],
    queryFn: () => adminFetch(`/api/driver-earnings/${driver.id}`).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => {
      if (!d || d.message || d.error || typeof d !== "object") return { monthly: [] };
      return { ...d, monthly: normalizeArrayPayload((d as Record<string, unknown>).monthly) };
    }),
  });
  const monthlyRows = normalizeArrayPayload(data?.monthly);

  return (
    <div className="modal-backdrop-jago">
      <div className="modal-jago" style={{ maxWidth: "700px" }}>
        <div className="modal-jago-header">
          <h5 className="modal-jago-title"><i className="bi bi-person-fill me-2"></i>{driver.fullName} — Earnings</h5>
          <button className="modal-jago-close" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>
        {isLoading ? (
          <div className="text-center py-4"><div className="spinner-border spinner-border-sm text-primary" /></div>
        ) : data ? (
          <div>
            <div className="row g-3 mb-4">
              {[
                { label: "Total Trips", val: driver.completedTrips || 0, icon: "bi-car-front", color: "#2F7BFF" },
                { label: "Gross Earnings", val: `₹${Number(driver.grossEarnings || 0).toFixed(0)}`, icon: "bi-cash-stack", color: "#059669" },
                { label: "Commission Paid", val: `₹${Number(driver.commission || 0).toFixed(0)}`, icon: "bi-building", color: "#d97706" },
                { label: "Net Earnings", val: `₹${Number(driver.netEarnings || 0).toFixed(0)}`, icon: "bi-wallet-fill", color: "#0284c7" },
              ].map((s, i) => (
                <div key={i} className="col-6">
                  <div className="p-3 rounded" style={{ background: s.color + "12", border: `1px solid ${s.color}22` }}>
                    <div style={{ fontSize: "1.3rem", fontWeight: 700, color: s.color }}>{s.val}</div>
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{s.label}</div>
                  </div>
                </div>
              ))}
            </div>

            <h6 className="fw-semibold mb-3" style={{ fontSize: "0.82rem" }}>Monthly Breakdown (Last 12 Months)</h6>
            {!monthlyRows.length ? (
              <div className="text-center py-3 text-muted" style={{ fontSize: "0.82rem" }}>No trip history available</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm table-borderless align-middle">
                  <thead className="table-light">
                    <tr style={{ fontSize: "0.75rem" }}>
                      <th>Month</th>
                      <th className="text-center">Trips</th>
                      <th className="text-center">Cancelled</th>
                      <th className="text-end">Gross</th>
                      <th className="text-end">Commission (15%)</th>
                      <th className="text-end">GST (5%)</th>
                      <th className="text-end text-success">Net Payout</th>
                    </tr>
                  </thead>
                  <tbody style={{ fontSize: "0.8rem" }}>
                    {monthlyRows.map((m: any, i: number) => (
                      <tr key={i}>
                        <td className="fw-semibold">{m.monthLabel}</td>
                        <td className="text-center">{m.completed}</td>
                        <td className="text-center"><span className="badge bg-danger bg-opacity-10 text-danger">{m.cancelled}</span></td>
                        <td className="text-end">₹{Number(m.gross).toFixed(0)}</td>
                        <td className="text-end text-warning">-₹{Number(m.commission).toFixed(0)}</td>
                        <td className="text-end text-muted">-₹{Number(m.gst).toFixed(0)}</td>
                        <td className="text-end fw-bold text-success">₹{Number(m.net).toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-3 text-danger">Failed to load earnings data</div>
        )}
      </div>
    </div>
  );
}

export default function DriverEarningsPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);

  const { data: drivers = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/driver-earnings"],
    queryFn: async () => {
      const response = await adminFetch("/api/driver-earnings");
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.message || "Failed to load driver earnings");
      }
      const body = await response.json().catch(() => []);
      return normalizeArrayPayload(body, ["drivers", "earnings"]);
    },
  });
  const driverRows = Array.isArray(drivers) ? drivers : [];

  const filtered = driverRows.filter((d: any) =>
    !search || d.fullName?.toLowerCase().includes(search.toLowerCase()) || d.phone?.includes(search)
  );

  const totalGross = driverRows.reduce((s: number, d: any) => s + Number(d.grossEarnings || 0), 0);
  const totalCommission = driverRows.reduce((s: number, d: any) => s + Number(d.commission || 0), 0);
  const totalNet = driverRows.reduce((s: number, d: any) => s + Number(d.netEarnings || 0), 0);
  const totalTrips = driverRows.reduce((s: number, d: any) => s + Number(d.completedTrips || 0), 0);

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <h2 className="h5 mb-3">Driver Earnings Statement</h2>
        </div>
      </div>
      <div className="container-fluid">
        <div className="row g-3 mb-4">
          {[
            { label: "Total Completed Trips", val: totalTrips, icon: "bi-car-front-fill", color: "#2F7BFF", bg: "linear-gradient(135deg,#2F7BFF15,#818cf815)" },
            { label: "Total Gross Earnings", val: `₹${(totalGross / 1000).toFixed(1)}K`, icon: "bi-cash-stack", color: "#059669", bg: "linear-gradient(135deg,#05966915,#34d39915)" },
            { label: "Total Commission", val: `₹${(totalCommission / 1000).toFixed(1)}K`, icon: "bi-building", color: "#d97706", bg: "linear-gradient(135deg,#d9770615,#fbbf2415)" },
            { label: "Total Net Payout", val: `₹${(totalNet / 1000).toFixed(1)}K`, icon: "bi-wallet-fill", color: "#0284c7", bg: "linear-gradient(135deg,#0284c715,#38bdf815)" },
          ].map((s, i) => (
            <div key={i} className="col-6 col-md-3">
              <div className="card border-0" style={{ background: s.bg }}>
                <div className="card-body d-flex align-items-center gap-3 p-3">
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: s.color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className={`bi ${s.icon}`} style={{ color: s.color, fontSize: "1.1rem" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.val}</div>
                    <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 2 }}>{s.label}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-body">
            <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-4">
              <h5 className="text-primary mb-0">Driver Earnings List</h5>
              <div className="input-group search-form__input_group" style={{ maxWidth: "260px" }}>
                <span className="search-form__icon"><i className="bi bi-search"></i></span>
                <input
                  type="search"
                  className="theme-input-style search-form__input"
                  placeholder="Search by name or phone..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  data-testid="input-search-driver"
                />
              </div>
            </div>

            <div className="table-responsive">
              <table className="table table-borderless align-middle table-hover">
                <thead className="table-light align-middle text-capitalize" style={{ fontSize: "0.78rem" }}>
                  <tr>
                    <th>#</th>
                    <th>Driver</th>
                    <th>Vehicle</th>
                    <th className="text-center">Trips</th>
                    <th className="text-end">Gross (₹)</th>
                    <th className="text-end">Commission (₹)</th>
                    <th className="text-end">GST (₹)</th>
                    <th className="text-end">Net Payout (₹)</th>
                    <th className="text-center">This Month</th>
                    <th className="text-center">Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody style={{ fontSize: "0.8rem" }}>
                  {isLoading ? Array(5).fill(0).map((_, i) => (
                    <tr key={i}>{Array(11).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                  )) : filtered.length === 0 ? (
                    <tr><td colSpan={11} className="text-center py-4 text-muted">No drivers found</td></tr>
                  ) : filtered.map((d: any, i: number) => {
                    const vs = STATUS_COLORS[d.verificationStatus] || STATUS_COLORS.pending;
                    return (
                      <tr key={d.id} data-testid={`driver-earning-row-${d.id}`}>
                        <td>{i + 1}</td>
                        <td>
                          <div className="fw-semibold">{d.fullName}</div>
                          <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{d.phone}</div>
                          {d.avgRating && (
                            <div style={{ fontSize: "0.7rem" }}>
                              <i className="bi bi-star-fill text-warning me-1"></i>{Number(d.avgRating).toFixed(1)}
                            </div>
                          )}
                        </td>
                        <td>
                          <div>{d.vehicleCategory || "—"}</div>
                          <div style={{ fontSize: "0.7rem", color: "#64748b" }}>{d.vehicleNumber || ""}</div>
                        </td>
                        <td className="text-center fw-semibold">{d.completedTrips || 0}</td>
                        <td className="text-end">₹{Number(d.grossEarnings || 0).toFixed(0)}</td>
                        <td className="text-end text-warning">₹{Number(d.commission || 0).toFixed(0)}</td>
                        <td className="text-end text-muted">₹{Number(d.gst || 0).toFixed(0)}</td>
                        <td className="text-end fw-bold text-success">₹{Number(d.netEarnings || 0).toFixed(0)}</td>
                        <td className="text-center">
                          <div style={{ fontSize: "0.75rem" }}>{d.thisMonthTrips || 0} trips</div>
                          <div style={{ fontSize: "0.7rem", color: "#059669" }}>₹{Number(d.thisMonthEarnings || 0).toFixed(0)}</div>
                        </td>
                        <td className="text-center">
                          <span style={{ background: vs.bg, color: vs.color, padding: "2px 8px", borderRadius: 12, fontSize: "0.7rem", fontWeight: 600 }}>
                            {vs.label}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => setSelected(d)}
                            data-testid={`btn-view-earnings-${d.id}`}
                          >
                            <i className="bi bi-eye-fill me-1"></i>Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {!isLoading && filtered.length > 0 && (
                  <tfoot className="table-light" style={{ fontSize: "0.78rem", fontWeight: 700 }}>
                    <tr>
                      <td colSpan={4}>Total ({filtered.length} drivers)</td>
                      <td className="text-end">₹{filtered.reduce((s: number, d: any) => s + Number(d.grossEarnings || 0), 0).toFixed(0)}</td>
                      <td className="text-end text-warning">₹{filtered.reduce((s: number, d: any) => s + Number(d.commission || 0), 0).toFixed(0)}</td>
                      <td className="text-end text-muted">₹{filtered.reduce((s: number, d: any) => s + Number(d.gst || 0), 0).toFixed(0)}</td>
                      <td className="text-end text-success">₹{filtered.reduce((s: number, d: any) => s + Number(d.netEarnings || 0), 0).toFixed(0)}</td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      </div>

      {selected && <DriverDetail driver={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
