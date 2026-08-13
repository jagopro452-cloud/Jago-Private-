import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiRequest } from "@/lib/queryClient";

const avatarBg = (name: string) => {
  const colors = ["#1a73e8", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#dc2626"];
  return colors[(name || "A").charCodeAt(0) % colors.length];
};

const initials = (name: string) =>
  (name || "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

const STATUS_CONFIG: Record<string, { cls: string; label: string }> = {
  completed: { cls: "bg-success", label: "Completed" },
  ongoing: { cls: "bg-info", label: "Ongoing" },
  pending: { cls: "bg-warning text-dark", label: "Pending" },
  cancelled: { cls: "bg-danger", label: "Cancelled" },
  accepted: { cls: "bg-primary", label: "Accepted" },
  searching: { cls: "bg-warning text-dark", label: "Searching" },
  driver_assigned: { cls: "bg-primary", label: "Driver Assigned" },
  arrived: { cls: "bg-info", label: "Arrived" },
  on_the_way: { cls: "bg-info", label: "On The Way" },
  scheduled: { cls: "bg-secondary", label: "Scheduled" },
};

const TYPE_CONFIG: Record<string, { label: string; icon: string; bg: string; color: string }> = {
  ride: { label: "Ride", icon: "bi-car-front-fill", bg: "#eff6ff", color: "#1E5FCC" },
  parcel: { label: "Parcel", icon: "bi-box-seam-fill", bg: "#f0fdf4", color: "#16a34a" },
};

const STATUSES = ["all", "pending", "searching", "accepted", "ongoing", "completed", "cancelled"];

function formatTripDate(value: string | undefined) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "-";
  }
}

function formatPaymentMethod(method: string | undefined) {
  const m = String(method || "cash").toLowerCase();
  if (m === "upi") return "UPI";
  if (m === "cash") return "Cash";
  if (["online", "razorpay", "wallet", "card"].includes(m)) return "Online";
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function paymentStatusLabel(status: string | undefined) {
  const s = String(status || "unpaid").toLowerCase();
  if (["paid", "paid_online", "wallet_paid", "partial_payment"].includes(s)) return "Settled";
  return "Unpaid";
}

type TripRow = {
  trip: any;
  customer?: { fullName?: string; phone?: string };
  driver?: { fullName?: string; phone?: string };
  vehicleCategory?: { name?: string };
  zone?: { name?: string };
};

function TripDetailModal({ item, onClose }: { item: TripRow; onClose: () => void }) {
  const trip = item.trip || {};
  const st = trip.currentStatus || "pending";
  const sc = STATUS_CONFIG[st] || { cls: "bg-secondary", label: st };
  const fare = Number(trip.actualFare || trip.estimatedFare || 0).toFixed(2);

  return (
    <div className="modal-backdrop-jago" onClick={onClose}>
      <div className="modal-jago" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-jago-header">
          <h5 className="modal-jago-title">
            <i className="bi bi-car-front-fill me-2 text-primary" />
            Trip Detail
          </h5>
          <button type="button" className="modal-jago-close" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="row g-3">
          <div className="col-12 d-flex flex-wrap gap-2 align-items-center">
            <span className="trip-ref">{trip.refId || trip.id?.slice(0, 8)}</span>
            <span className={`badge ${sc.cls}`}>{sc.label}</span>
            <span className="badge bg-light text-dark border">{item.zone?.name || "No zone"}</span>
          </div>
          <div className="col-md-6">
            <div className="jago-detail-label">Customer</div>
            <div className="jago-detail-value">{item.customer?.fullName || "—"}</div>
            <div className="text-muted small">{item.customer?.phone || "—"}</div>
          </div>
          <div className="col-md-6">
            <div className="jago-detail-label">Driver</div>
            <div className="jago-detail-value">{item.driver?.fullName || "Not assigned"}</div>
            <div className="text-muted small">{item.driver?.phone || "—"}</div>
          </div>
          <div className="col-md-4">
            <div className="jago-detail-label">Vehicle</div>
            <div className="jago-detail-value">{item.vehicleCategory?.name || trip.vehicleTypeName || "—"}</div>
          </div>
          <div className="col-md-4">
            <div className="jago-detail-label">Payment</div>
            <div className="jago-detail-value">{formatPaymentMethod(trip.paymentMethod)}</div>
            <div className="text-muted small">{paymentStatusLabel(trip.paymentStatus)}</div>
          </div>
          <div className="col-md-4">
            <div className="jago-detail-label">Distance</div>
            <div className="jago-detail-value">{Number(trip.estimatedDistance || trip.actualDistance || 0).toFixed(1)} km</div>
          </div>
          <div className="col-12">
            <div className="jago-detail-label">Pickup</div>
            <div className="p-2 rounded bg-light border-start border-3 border-success small">{trip.pickupAddress || "—"}</div>
          </div>
          <div className="col-12">
            <div className="jago-detail-label">Destination</div>
            <div className="p-2 rounded bg-light border-start border-3 border-danger small">{trip.destinationAddress || "—"}</div>
          </div>
          <div className="col-12">
            <div className="p-3 rounded text-white" style={{ background: "linear-gradient(135deg,#1E5FCC,#4A90E2)" }}>
              <div className="row g-2">
                <div className="col-4">
                  <div className="small opacity-75">Fare</div>
                  <div className="fs-5 fw-bold">₹{fare}</div>
                </div>
                <div className="col-4">
                  <div className="small opacity-75">GST</div>
                  <div className="fs-6 fw-semibold">₹{Number(trip.gstAmount || 0).toFixed(2)}</div>
                </div>
                <div className="col-4">
                  <div className="small opacity-75">Driver Credit</div>
                  <div className="fs-6 fw-semibold">₹{Number(trip.driverWalletCredit || 0).toFixed(2)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function exportTripsCsv(rows: TripRow[]) {
  const header = ["Trip ID", "Customer", "Driver", "Zone", "Vehicle", "Pickup", "Destination", "Fare", "Payment", "Status", "Date"];
  const lines = rows.map((item) => {
    const t = item.trip || {};
    return [
      t.refId || "",
      item.customer?.fullName || "",
      item.driver?.fullName || "",
      item.zone?.name || "",
      item.vehicleCategory?.name || "",
      `"${String(t.pickupAddress || "").replace(/"/g, '""')}"`,
      `"${String(t.destinationAddress || "").replace(/"/g, '""')}"`,
      Number(t.actualFare || t.estimatedFare || 0),
      formatPaymentMethod(t.paymentMethod),
      t.currentStatus || "",
      formatTripDate(t.createdAt),
    ].join(",");
  });
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jago-trips-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Trips() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<TripRow | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/trips", { status, search, page, typeFilter }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "15" });
      if (status !== "all") params.set("status", status);
      if (search) params.set("search", search);
      if (typeFilter !== "all") params.set("type", typeFilter);
      const response = await adminFetch(`/api/trips?${params.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.message || "Error");
      }
      const body = await response.json();
      return body?.data ? body : { data: Array.isArray(body) ? body : [], total: 0 };
    },
  });

  const rows: TripRow[] = useMemo(
    () => (data?.data || []).filter((item: any) => item?.trip),
    [data?.data],
  );

  const updateStatus = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: string }) =>
      apiRequest("PATCH", `/api/trips/${id}/status`, { status: newStatus }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/trips"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Trip status updated successfully" });
    },
  });

  const totalPages = Math.ceil((data?.total || 0) / 15);

  return (
    <div className="container-fluid">
      <style>{`
        .jago-trips-page .table-responsive { overflow: auto !important; }
        .jago-trips-table { table-layout: fixed; min-width: 1380px; }
        .jago-trips-table .trip-ref {
          color: #2563eb;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 12px;
          font-weight: 700;
        }
        .jago-trips-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .jago-trips-toolbar .nav { flex: 1 1 520px; }
        .jago-trips-toolbar-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
        .jago-trips-search { display: flex; gap: 8px; flex: 1 1 320px; min-width: 260px; }
        .jago-trips-table .route-stack { display: flex; flex-direction: column; gap: 6px; }
        .jago-trips-table .route-line { display: grid; grid-template-columns: 8px 1fr; gap: 6px; font-size: 11px; color: #64748b; }
        .jago-trips-table .route-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; }
        .jago-trips-table .type-badge {
          display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px;
          border-radius: 999px; font-size: 10px; font-weight: 700;
        }
      `}</style>

      <div className="jago-trips-page d-flex flex-column gap-3">
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div>
            <h2 className="fs-22 mb-1 fw-bold" data-testid="page-title">Trip Management</h2>
            <div className="fs-14 text-muted">Monitor ride trips — zone, driver, fare and payment. Parcel deliveries are on <a href="/admin/parcel-orders">Parcel Orders</a>.</div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => exportTripsCsv(rows)}
              disabled={!rows.length}
              data-testid="btn-export-trips"
            >
              <i className="bi bi-download me-1" />Export CSV
            </button>
            <span className="text-muted small">Total:</span>
            <span className="fw-bold text-primary fs-5" data-testid="total-count">{data?.total || 0}</span>
          </div>
        </div>

        <div className="card border-0 shadow-sm" style={{ borderRadius: 12 }}>
          <div className="card-header bg-white py-3 px-4 border-bottom">
            <div className="jago-trips-toolbar">
              <ul className="nav nav--tabs p-1 rounded bg-light mb-0" role="tablist">
                {STATUSES.map((entry) => (
                  <li key={entry} className="nav-item">
                    <button
                      type="button"
                      className={`nav-link${status === entry ? " active" : ""}`}
                      onClick={() => { setStatus(entry); setPage(1); }}
                      data-testid={`tab-${entry}`}
                    >
                      {entry === "all" ? "All" : entry.charAt(0).toUpperCase() + entry.slice(1)}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="jago-trips-toolbar-right">
                <div className="btn-group btn-group-sm">
                  {[
                    { key: "all", label: "All" },
                    { key: "ride", label: "Rides" },
                    { key: "parcel", label: "Parcel" },
                  ].map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      className={`btn ${typeFilter === entry.key ? "btn-primary" : "btn-outline-secondary"}`}
                      onClick={() => { setTypeFilter(entry.key); setPage(1); }}
                      data-testid={`filter-type-${entry.key}`}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                <form
                  className="jago-trips-search"
                  onSubmit={(e) => { e.preventDefault(); setPage(1); }}
                >
                  <div className="input-group search-form__input_group flex-grow-1">
                    <span className="search-form__icon"><i className="bi bi-search" /></span>
                    <input
                      type="search"
                      className="theme-input-style search-form__input"
                      placeholder="Search trip ID, customer, driver..."
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                      data-testid="input-search"
                    />
                  </div>
                  <button type="submit" className="btn btn-primary" data-testid="btn-search">Search</button>
                </form>
              </div>
            </div>
          </div>

          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-borderless align-middle table-hover mb-0 jago-trips-table">
                <thead className="table-light">
                  <tr className="text-capitalize" style={{ fontSize: "0.78rem" }}>
                    {["SL", "Trip ID", "Customer", "Driver", "Zone", "Route", "Vehicle", "Type", "Fare", "Payment", "Status", "Date", "Action"].map((h, i) => (
                      <th key={h} className={i === 0 ? "ps-4" : i === 12 ? "text-center pe-4" : ""}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 13 }).map((__, j) => (
                        <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>
                      ))}</tr>
                    ))
                  ) : rows.length ? (
                    rows.map((item, idx) => {
                      const trip = item.trip || {};
                      const st = trip.currentStatus || "pending";
                      const sc = STATUS_CONFIG[st] || { cls: "bg-secondary", label: st };
                      const tc = TYPE_CONFIG[trip.type] || TYPE_CONFIG.ride;
                      const customerName = item.customer?.fullName || "-";
                      const driverName = item.driver?.fullName || "—";
                      const fare = Number(trip.actualFare || trip.estimatedFare || 0).toFixed(0);

                      return (
                        <tr key={trip.id || idx} data-testid={`trip-row-${trip.id}`}>
                          <td className="ps-4 text-muted small">{(page - 1) * 15 + idx + 1}</td>
                          <td><span className="trip-ref">{trip.refId || "-"}</span></td>
                          <td>
                            <div className="d-flex align-items-center gap-2">
                              <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0 text-white fw-bold"
                                style={{ width: 34, height: 34, fontSize: 10, background: avatarBg(customerName) }}>
                                {initials(customerName)}
                              </div>
                              <div>
                                <div className="fw-semibold small">{customerName}</div>
                                <div className="text-muted" style={{ fontSize: 10 }}>{item.customer?.phone || ""}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="fw-semibold small">{driverName}</div>
                            <div className="text-muted" style={{ fontSize: 10 }}>{item.driver?.phone || ""}</div>
                          </td>
                          <td className="small">{item.zone?.name || "—"}</td>
                          <td>
                            <div className="route-stack">
                              <div className="route-line"><span className="route-dot bg-success" /><span>{trip.pickupAddress || "-"}</span></div>
                              <div className="route-line"><span className="route-dot bg-danger" /><span>{trip.destinationAddress || "-"}</span></div>
                            </div>
                          </td>
                          <td className="small fw-semibold">{item.vehicleCategory?.name || "-"}</td>
                          <td>
                            <span className="type-badge" style={{ background: tc.bg, color: tc.color }}>
                              <i className={`bi ${tc.icon}`} />{tc.label}
                            </span>
                          </td>
                          <td>
                            <div className="fw-bold small">₹{fare}</div>
                            <div className="text-muted" style={{ fontSize: 10 }}>{Number(trip.estimatedDistance || 0).toFixed(1)} km</div>
                          </td>
                          <td>
                            <div className="small fw-semibold">{formatPaymentMethod(trip.paymentMethod)}</div>
                            <span className={`badge ${paymentStatusLabel(trip.paymentStatus) === "Settled" ? "bg-success" : "bg-warning text-dark"}`} style={{ fontSize: 9 }}>
                              {paymentStatusLabel(trip.paymentStatus)}
                            </span>
                          </td>
                          <td><span className={`badge ${sc.cls}`} style={{ fontSize: 10 }}>{sc.label}</span></td>
                          <td className="text-muted small">{formatTripDate(trip.createdAt)}</td>
                          <td className="text-center pe-4">
                            <div className="d-flex justify-content-center gap-1">
                              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setSelected(item)} title="View">
                                <i className="bi bi-eye-fill" />
                              </button>
                              {(st === "pending" || st === "accepted" || st === "searching") && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-danger"
                                  onClick={() => updateStatus.mutate({ id: trip.id, newStatus: "cancelled" })}
                                  data-testid={`btn-cancel-${trip.id}`}
                                  title="Cancel"
                                >
                                  <i className="bi bi-x-circle" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={13} className="text-center py-5 text-muted">
                        <i className="bi bi-car-front fs-1 d-block mb-2 opacity-25" />
                        <p className="fw-semibold mb-1">No trips found</p>
                        <p className="small mb-0">Try changing the filter or search term</p>
                      </td>
                    </tr>
                  )}
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

      {selected && <TripDetailModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
