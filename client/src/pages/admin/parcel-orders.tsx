import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/queryClient";

interface ParcelOrder {
  id: string;
  customer_name: string;
  customer_phone: string;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle_category: string;
  pickup_address: string;
  drop_locations: any[];
  total_distance_km: number;
  weight_kg: number;
  total_fare: number;
  commission_amt: number;
  current_status: string;
  current_drop_index: number;
  is_b2b: boolean;
  payment_method: string;
  payment_status: string;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  pending:         { label: "Pending",         cls: "bg-warning text-dark" },
  searching:       { label: "Searching",       cls: "bg-primary" },
  driver_assigned: { label: "Driver Assigned", cls: "bg-primary" },
  accepted:        { label: "Accepted",        cls: "bg-info" },
  picked_up:       { label: "Picked Up",       cls: "bg-info" },
  in_transit:      { label: "In Transit",      cls: "bg-info" },
  completed:       { label: "Completed",       cls: "bg-success" },
  cancelled:       { label: "Cancelled",       cls: "bg-danger" },
};

const VEHICLE_LABELS: Record<string, string> = {
  bike_parcel:  "Bike Parcel",
  auto_parcel:  "Mini Auto Parcel",
  tata_ace:     "Pickup Truck",
  bolero_cargo: "Bolero Pickup",
  pickup_truck: "Pickup Truck",
  tempo_407:    "Goods Vehicle",
};

const STATUSES = ["all", "searching", "driver_assigned", "in_transit", "completed", "cancelled"];
const PAGE_SIZE = 15;

function parseDrops(order: ParcelOrder): any[] {
  if (Array.isArray(order.drop_locations)) return order.drop_locations;
  if (typeof order.drop_locations === "string") {
    try { return JSON.parse(order.drop_locations); } catch { return []; }
  }
  return [];
}

function formatPaymentMethod(method: string | undefined) {
  const m = String(method || "cash").toLowerCase();
  if (m === "upi") return "UPI";
  if (m === "cash") return "Cash";
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function DetailModal({ order, onClose }: { order: ParcelOrder; onClose: () => void }) {
  const drops = parseDrops(order);
  const sc = STATUS_CONFIG[order.current_status] ?? { label: order.current_status, cls: "bg-secondary" };

  return (
    <div className="modal-backdrop-jago" onClick={onClose}>
      <div className="modal-jago" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-jago-header">
          <h5 className="modal-jago-title">
            <i className="bi bi-box-seam-fill me-2 text-primary" />
            Parcel Order Detail
          </h5>
          <button type="button" className="modal-jago-close" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="row g-3">
          <div className="col-12 d-flex flex-wrap gap-2">
            <span className="trip-ref">#{order.id.slice(0, 8).toUpperCase()}</span>
            <span className={`badge ${sc.cls}`}>{sc.label}</span>
            {order.is_b2b && <span className="badge bg-purple-subtle text-primary border">B2B</span>}
          </div>
          <div className="col-md-6">
            <div className="jago-detail-label">Customer</div>
            <div className="jago-detail-value">{order.customer_name || "—"}</div>
            <div className="text-muted small">{order.customer_phone || "—"}</div>
          </div>
          <div className="col-md-6">
            <div className="jago-detail-label">Driver</div>
            <div className="jago-detail-value">{order.driver_name || "Not assigned"}</div>
            <div className="text-muted small">{order.driver_phone || "—"}</div>
          </div>
          <div className="col-md-4">
            <div className="jago-detail-label">Vehicle</div>
            <div className="jago-detail-value">{VEHICLE_LABELS[order.vehicle_category] || order.vehicle_category}</div>
          </div>
          <div className="col-md-4">
            <div className="jago-detail-label">Payment</div>
            <div className="jago-detail-value">{formatPaymentMethod(order.payment_method)}</div>
            <div className="text-muted small text-capitalize">{order.payment_status || "unpaid"}</div>
          </div>
          <div className="col-md-4">
            <div className="jago-detail-label">Weight / Distance</div>
            <div className="jago-detail-value">{order.weight_kg} kg · {order.total_distance_km} km</div>
          </div>
          <div className="col-12">
            <div className="jago-detail-label">Pickup</div>
            <div className="p-2 rounded bg-light border-start border-3 border-success small">{order.pickup_address}</div>
          </div>
          <div className="col-12">
            <div className="jago-detail-label">Drop Stops ({drops.length})</div>
            {drops.map((d: any, i: number) => (
              <div key={i} className="p-2 mb-2 rounded bg-light border-start border-3 border-primary small">
                <strong>Stop {i + 1}</strong> {d.receiverName ? `— ${d.receiverName}` : ""}
                <div className="text-muted">{d.address}</div>
              </div>
            ))}
          </div>
          <div className="col-12">
            <div className="p-3 rounded text-white" style={{ background: "linear-gradient(135deg,#FF6B35,#F59E0B)" }}>
              <div className="d-flex justify-content-between">
                <div>
                  <div className="small opacity-75">Total Fare</div>
                  <div className="fs-4 fw-bold">₹{order.total_fare}</div>
                </div>
                <div className="text-end">
                  <div className="small opacity-75">Commission</div>
                  <div className="fs-5 fw-semibold">₹{order.commission_amt}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function exportParcelCsv(orders: ParcelOrder[]) {
  const header = ["Order ID", "Customer", "Driver", "Vehicle", "Pickup", "Stops", "Fare", "Commission", "Payment", "Status", "Date"];
  const lines = orders.map((o) => {
    const drops = parseDrops(o);
    return [
      o.id.slice(0, 8),
      o.customer_name || "",
      o.driver_name || "",
      VEHICLE_LABELS[o.vehicle_category] || o.vehicle_category,
      `"${String(o.pickup_address || "").replace(/"/g, '""')}"`,
      drops.length,
      o.total_fare,
      o.commission_amt,
      formatPaymentMethod(o.payment_method),
      o.current_status,
      new Date(o.created_at).toLocaleDateString("en-IN"),
    ].join(",");
  });
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jago-parcel-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ParcelOrdersPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [b2bOnly, setB2bOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<ParcelOrder | null>(null);

  const { data: globalStats } = useQuery<{
    total: number;
    searching: number;
    inTransit: number;
    completed: number;
    commissionRevenue: number;
  }>({
    queryKey: ["/api/admin/parcel-orders/stats"],
    queryFn: async () => {
      const r = await adminFetch("/api/admin/parcel-orders/stats");
      if (!r.ok) throw new Error("Failed to load parcel stats");
      return r.json();
    },
  });

  const { data, isLoading } = useQuery<{ orders: ParcelOrder[]; total: number }>({
    queryKey: ["/api/admin/parcel-orders", statusFilter, b2bOnly, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (b2bOnly) params.set("b2b", "true");
      if (search.trim()) params.set("search", search.trim());
      const r = await adminFetch(`/api/admin/parcel-orders?${params}`);
      if (!r.ok) throw new Error("Failed to load parcel orders");
      return r.json();
    },
  });

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const stats = {
    total: globalStats?.total ?? total,
    searching: globalStats?.searching ?? 0,
    inTransit: globalStats?.inTransit ?? 0,
    completed: globalStats?.completed ?? 0,
    revenue: globalStats?.commissionRevenue ?? 0,
  };

  return (
    <div className="container-fluid">
      <style>{`
        .jago-parcel-table { table-layout: fixed; min-width: 1280px; }
        .jago-parcel-table .trip-ref {
          font-family: ui-monospace, monospace; font-size: 12px; font-weight: 700; color: #2563eb;
        }
        .jago-parcel-kpi { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
        .jago-parcel-kpi .card { border-radius: 10px; border: 1px solid #e2e8f0; }
      `}</style>

      <div className="d-flex flex-column gap-3">
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div>
            <h2 className="fs-22 mb-1 fw-bold">Parcel Orders</h2>
            <div className="fs-14 text-muted">Monitor parcel deliveries — driver, pickup, fare and commission</div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={!orders.length}
              onClick={() => exportParcelCsv(orders)}
              data-testid="btn-export-parcels"
            >
              <i className="bi bi-download me-1" />Export CSV
            </button>
            <span className="text-muted small">Total:</span>
            <span className="fw-bold text-primary fs-5">{total}</span>
          </div>
        </div>

        <div className="jago-parcel-kpi">
          {[
            { label: "Total Orders", value: stats.total, icon: "bi-box-seam", color: "#2F7BFF" },
            { label: "Searching", value: stats.searching, icon: "bi-search", color: "#F39C12" },
            { label: "In Transit", value: stats.inTransit, icon: "bi-truck", color: "#10B981" },
            { label: "Completed", value: stats.completed, icon: "bi-check-circle", color: "#2ECC71" },
            { label: "Commission", value: `₹${stats.revenue.toFixed(0)}`, icon: "bi-coin", color: "#8B5CF6" },
          ].map((s) => (
            <div key={s.label} className="card shadow-sm">
              <div className="card-body py-2 px-3 d-flex align-items-center gap-2">
                <div className="rounded-circle d-flex align-items-center justify-content-center" style={{ width: 36, height: 36, background: `${s.color}18`, color: s.color }}>
                  <i className={`bi ${s.icon}`} />
                </div>
                <div>
                  <div className="fw-bold">{s.value}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{s.label}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card border-0 shadow-sm" style={{ borderRadius: 12 }}>
          <div className="card-header bg-white py-3 px-4 border-bottom">
            <div className="d-flex flex-wrap align-items-center gap-2 justify-content-between">
              <ul className="nav nav--tabs p-1 rounded bg-light mb-0">
                {STATUSES.map((s) => (
                  <li key={s} className="nav-item">
                    <button
                      type="button"
                      className={`nav-link${statusFilter === s ? " active" : ""}`}
                      onClick={() => { setStatusFilter(s); setPage(1); }}
                    >
                      {s === "all" ? "All" : STATUS_CONFIG[s]?.label ?? s}
                    </button>
                  </li>
                ))}
              </ul>
              <form className="d-flex gap-2 flex-wrap align-items-center" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
                <div className="input-group search-form__input_group" style={{ minWidth: 240 }}>
                  <span className="search-form__icon"><i className="bi bi-search" /></span>
                  <input
                    type="search"
                    className="theme-input-style search-form__input"
                    placeholder="Search order, customer, driver..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    data-testid="input-parcel-search"
                  />
                </div>
                <label className="d-flex align-items-center gap-1 small mb-0">
                  <input type="checkbox" checked={b2bOnly} onChange={(e) => { setB2bOnly(e.target.checked); setPage(1); }} />
                  B2B only
                </label>
                <button type="submit" className="btn btn-primary btn-sm">Search</button>
              </form>
            </div>
          </div>

          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-borderless align-middle table-hover mb-0 jago-parcel-table">
                <thead className="table-light text-capitalize" style={{ fontSize: "0.78rem" }}>
                  <tr>
                    {["SL", "Order ID", "Customer", "Driver", "Pickup", "Vehicle", "Stops", "Distance", "Fare", "Payment", "Status", "Type", "Date", "Action"].map((h, i) => (
                      <th key={h} className={i === 0 ? "ps-4" : i === 13 ? "text-center pe-4" : ""}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 14 }).map((__, j) => (
                        <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>
                      ))}</tr>
                    ))
                  ) : orders.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="text-center py-5 text-muted">
                        <i className="bi bi-inbox fs-1 d-block mb-2 opacity-25" />
                        No parcel orders found
                      </td>
                    </tr>
                  ) : orders.map((order, idx) => {
                    const sc = STATUS_CONFIG[order.current_status] ?? { label: order.current_status, cls: "bg-secondary" };
                    const drops = parseDrops(order);
                    const delivered = drops.filter((d) => d.delivered_at).length;
                    return (
                      <tr key={order.id}>
                        <td className="ps-4 text-muted small">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                        <td><span className="trip-ref">#{order.id.slice(0, 8).toUpperCase()}</span></td>
                        <td>
                          <div className="fw-semibold small">{order.customer_name || "—"}</div>
                          <div className="text-muted" style={{ fontSize: 10 }}>{order.customer_phone}</div>
                        </td>
                        <td>
                          <div className="fw-semibold small">{order.driver_name || "—"}</div>
                          <div className="text-muted" style={{ fontSize: 10 }}>{order.driver_phone || ""}</div>
                        </td>
                        <td className="small text-muted" style={{ maxWidth: 140, whiteSpace: "normal" }}>
                          {order.pickup_address ? `${order.pickup_address.slice(0, 40)}${order.pickup_address.length > 40 ? "…" : ""}` : "—"}
                        </td>
                        <td className="small fw-semibold">{VEHICLE_LABELS[order.vehicle_category] || order.vehicle_category}</td>
                        <td className="small">{drops.length ? `${delivered}/${drops.length}` : "—"}</td>
                        <td className="small">{order.total_distance_km} km</td>
                        <td>
                          <div className="fw-bold small">₹{order.total_fare}</div>
                          <div className="text-muted" style={{ fontSize: 10 }}>Comm ₹{order.commission_amt}</div>
                        </td>
                        <td>
                          <div className="small fw-semibold">{formatPaymentMethod(order.payment_method)}</div>
                          <span className={`badge ${order.payment_status === "paid" ? "bg-success" : "bg-warning text-dark"}`} style={{ fontSize: 9 }}>
                            {order.payment_status || "unpaid"}
                          </span>
                        </td>
                        <td><span className={`badge ${sc.cls}`} style={{ fontSize: 10 }}>{sc.label}</span></td>
                        <td>
                          {order.is_b2b
                            ? <span className="badge bg-primary bg-opacity-10 text-primary" style={{ fontSize: 10 }}>B2B</span>
                            : <span className="text-muted small">Direct</span>}
                        </td>
                        <td className="text-muted small">
                          {new Date(order.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                        </td>
                        <td className="text-center pe-4">
                          <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setSelectedOrder(order)} title="View">
                            <i className="bi bi-eye-fill" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="card-footer bg-white border-top py-3 px-4 d-flex align-items-center justify-content-between">
              <div className="text-muted small">Page {page} of {totalPages}</div>
              <div className="d-flex gap-1">
                <button type="button" className="btn btn-sm btn-outline-secondary" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <i className="bi bi-chevron-left" />
                </button>
                <button type="button" className="btn btn-sm btn-outline-secondary" disabled={page === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  <i className="bi bi-chevron-right" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedOrder && <DetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
    </div>
  );
}
