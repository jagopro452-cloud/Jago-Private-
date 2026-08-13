import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const TABS = ["all","pending","approved","denied","refunded"];
const STATUS_CONFIG: Record<string, { cls: string; label: string }> = {
  cancelled: { cls: "badge bg-danger", label: "Pending Review" },
  unpaid: { cls: "badge bg-danger", label: "Pending Review" },
  refund_approved: { cls: "badge bg-success", label: "Approved" },
  refund_denied: { cls: "badge bg-secondary", label: "Denied" },
  refunded: { cls: "badge bg-info", label: "Refunded" },
};

const avatarBg = (name: string) => {
  const colors = ["#1a73e8","#16a34a","#d97706","#9333ea"];
  return colors[(name || "A").charCodeAt(0) % colors.length];
};
const initials = (name: string) => (name || "?").split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();

export default function ParcelRefundsPage() {
  const [tab, setTab] = useState("all");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/parcel-refunds", tab],
    queryFn: () => adminFetch(`/api/parcel-refunds${tab !== "all" ? `?status=${tab}` : ""}`).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => d?.data ? d : { data: Array.isArray(d) ? d : [], total: 0 }),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, refundStatus }: { id: string; refundStatus: string }) =>
      apiRequest("PATCH", `/api/parcel-refunds/${id}/status`, { refundStatus }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/parcel-refunds"] });
      toast({ title: "Refund status updated" });
    },
  });

  const items = data?.data || [];

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">Parcel Refund Requests</h4>
          <div className="text-muted small">Manage refund requests for cancelled parcel deliveries</div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className="text-muted small">Total:</span>
          <span className="fw-bold text-primary" style={{ fontSize: 20 }}>{data?.total ?? "—"}</span>
        </div>
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <ul className="nav nav--tabs p-1 rounded bg-light">
            {TABS.map(t => (
              <li key={t} className="nav-item">
                <button className={`nav-link text-capitalize${tab === t ? " active" : ""}`}
                  onClick={() => setTab(t)} data-testid={`tab-${t}`}>{t}</button>
              </li>
            ))}
          </ul>
        </div>

        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover mb-0">
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  {["#","Ref ID","Customer","Pickup","Destination","Fare","Refund Status","Action"].map((h, i) => (
                    <th key={i}
                      className={i === 0 ? "ps-4" : i === 7 ? "text-center pe-4" : ""}
                      style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", paddingTop: 12, paddingBottom: 12 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <tr key={i}>{Array(8).fill(0).map((_, j) => (
                      <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>
                    ))}</tr>
                  ))
                ) : items.length ? (
                  items.map((item: any, idx: number) => {
                    const name = item.customerName || "Customer";
                    const drops = Array.isArray(item.dropLocations) ? item.dropLocations
                      : (typeof item.dropLocations === "string" ? JSON.parse(item.dropLocations || "[]") : []);
                    const destination = drops[0]?.address || drops[0]?.dropAddress || "—";
                    const payStatus = item.paymentStatus || "cancelled";
                    const sc = STATUS_CONFIG[payStatus] || STATUS_CONFIG.cancelled;
                    const isPending = payStatus === "cancelled" || payStatus === "unpaid" || payStatus === "paid_online";
                    return (
                      <tr key={item.id} data-testid={`refund-row-${item.id}`}>
                        <td className="ps-4 text-muted small">{idx + 1}</td>
                        <td>
                          <span className="fw-bold" style={{ fontSize: 12, color: "#1a73e8", fontFamily: "monospace" }}>
                            {String(item.id || "").slice(0, 8).toUpperCase()}
                          </span>
                        </td>
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <div className="d-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                              style={{ width: 30, height: 30, background: avatarBg(name), color: "white", fontSize: 11, fontWeight: 700 }}>
                              {initials(name)}
                            </div>
                            <span style={{ fontSize: 13 }}>{name}</span>
                          </div>
                        </td>
                        <td style={{ maxWidth: 150 }}>
                          <div className="text-truncate" style={{ fontSize: 12, color: "#64748b" }}>
                            {item.pickupAddress || "—"}
                          </div>
                        </td>
                        <td style={{ maxWidth: 150 }}>
                          <div className="text-truncate" style={{ fontSize: 12, color: "#64748b" }}>
                            {destination}
                          </div>
                        </td>
                        <td>
                          <div className="fw-semibold" style={{ fontSize: 13, color: "#dc2626" }}>
                            ₹{Number(item.totalFare || 0).toFixed(0)}
                          </div>
                        </td>
                        <td>
                          <span className={sc.cls} style={{ fontSize: 10 }}>{sc.label}</span>
                        </td>
                        <td className="text-center pe-4">
                          {isPending ? (
                            <div className="d-flex gap-1 justify-content-center">
                              <button className="btn btn-sm btn-outline-success rounded-pill px-2" style={{ fontSize: 11 }}
                                disabled={updateStatus.isPending}
                                onClick={() => updateStatus.mutate({ id: item.id, refundStatus: "approved" })}
                                data-testid={`btn-approve-${item.id}`}>
                                <i className="bi bi-check-lg me-1"></i>Approve
                              </button>
                              <button className="btn btn-sm btn-outline-danger rounded-pill px-2" style={{ fontSize: 11 }}
                                disabled={updateStatus.isPending}
                                onClick={() => updateStatus.mutate({ id: item.id, refundStatus: "denied" })}
                                data-testid={`btn-deny-${item.id}`}>
                                <i className="bi bi-x-lg me-1"></i>Deny
                              </button>
                            </div>
                          ) : (
                            <span className="text-muted" style={{ fontSize: 11 }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr><td colSpan={8}>
                    <div className="text-center py-5 text-muted">
                      <i className="bi bi-box-seam fs-1 d-block mb-2" style={{ opacity: 0.25 }}></i>
                      <p className="fw-semibold mb-1">No refund requests found</p>
                      <p className="small">Refund requests appear when parcel trips are cancelled</p>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
