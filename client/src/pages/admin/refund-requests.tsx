import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const TABS = ["all", "pending", "approved", "denied", "refunded"];
const STATUS_CONFIG: Record<string, { cls: string; label: string; color: string }> = {
  pending:  { cls: "bg-warning text-dark", label: "Pending Review", color: "#d97706" },
  approved: { cls: "bg-success",           label: "Approved",       color: "#16a34a" },
  denied:   { cls: "bg-danger",            label: "Rejected",       color: "#dc2626" },
  refunded: { cls: "bg-info text-dark",    label: "Refunded",       color: "#0891b2" },
};

const avatarBg = (name: string) => {
  const colors = ["#1a73e8","#16a34a","#d97706","#9333ea"];
  return colors[(name || "A").charCodeAt(0) % colors.length];
};
const initials = (name: string) =>
  (name || "?").split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
const fmt = (d: string) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function DetailModal({ item, onClose }: { item: any; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState(item.adminNote || "");

  const updateMut = useMutation({
    mutationFn: ({ status, adminNote }: any) =>
      apiRequest("PATCH", `/api/refund-requests/${item.id}`, { status, adminNote, approvedBy: "Admin" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/refund-requests"] });
      toast({ title: "Refund request updated" });
      onClose();
    },
  });

  const sc = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;

  return (
    <div className="modal-backdrop-jago">
      <div className="modal-jago" style={{ maxWidth: 580 }}>
        <div className="modal-jago-header">
          <h5 className="modal-jago-title"><i className="bi bi-arrow-counterclockwise me-2"></i>Refund Request Detail</h5>
          <button className="modal-jago-close" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>
        <div className="p-4">
          {/* Customer info */}
          <div className="d-flex align-items-center gap-3 mb-4 p-3 rounded-3" style={{ background: "#f8fafc" }}>
            <div className="rounded-circle d-flex align-items-center justify-content-center"
              style={{ width: 44, height: 44, background: avatarBg(item.customerName || ""), color: "white", fontSize: 15, fontWeight: 700 }}>
              {initials(item.customerName || "")}
            </div>
            <div>
              <div className="fw-bold" style={{ fontSize: 14 }}>{item.customerName || "Unknown"}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>{item.customerPhone || ""}</div>
            </div>
            <div className="ms-auto">
              <div className="fw-bold text-danger" style={{ fontSize: 18 }}>₹{parseFloat(item.amount || 0).toFixed(2)}</div>
              <div className="text-muted" style={{ fontSize: 10 }}>Refund Amount</div>
            </div>
          </div>

          <div className="row g-3 mb-4">
            <div className="col-6">
              <div className="text-muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Status</div>
              <span className={`badge ${sc.cls}`} style={{ fontSize: 11 }}>{sc.label}</span>
            </div>
            <div className="col-6">
              <div className="text-muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Payment Method</div>
              <div className="fw-semibold" style={{ fontSize: 13 }}>{item.paymentMethod || "Wallet"}</div>
            </div>
            <div className="col-6">
              <div className="text-muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Trip Reference</div>
              <div className="fw-semibold" style={{ fontSize: 13, fontFamily: "monospace", color: "#1a73e8" }}>{item.tripRef || "—"}</div>
            </div>
            <div className="col-6">
              <div className="text-muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Submitted</div>
              <div className="fw-semibold" style={{ fontSize: 13 }}>{fmt(item.createdAt)}</div>
            </div>
          </div>

          <div className="mb-3">
            <div className="text-muted mb-1" style={{ fontSize: 11, textTransform: "uppercase" }}>Customer Reason</div>
            <div className="p-3 rounded-3" style={{ background: "#fef2f2", border: "1px solid #fecaca", fontSize: 13 }}>
              {item.reason || "No reason provided"}
            </div>
          </div>

          {item.supportNote && (
            <div className="mb-3">
              <div className="text-muted mb-1" style={{ fontSize: 11, textTransform: "uppercase" }}>Support Note</div>
              <div className="p-3 rounded-3" style={{ background: "#fef9c3", border: "1px solid #fde68a", fontSize: 13 }}>
                {item.supportNote}
              </div>
            </div>
          )}

          {item.status === "pending" && (
            <>
              <div className="mb-3">
                <label className="form-label small fw-semibold">Admin Decision Note</label>
                <textarea className="form-control" rows={2} value={note} onChange={e => setNote(e.target.value)}
                  placeholder="Add a note for this decision…" data-testid="input-admin-note" />
              </div>
              <div className="d-flex gap-2">
                <button className="btn btn-success flex-fill" disabled={updateMut.isPending}
                  onClick={() => updateMut.mutate({ status: "approved", adminNote: note })}
                  data-testid="btn-approve-refund">
                  <i className="bi bi-check-circle me-1"></i>Approve & Credit Wallet
                </button>
                <button className="btn btn-outline-danger flex-fill" disabled={updateMut.isPending}
                  onClick={() => updateMut.mutate({ status: "denied", adminNote: note })}
                  data-testid="btn-reject-refund">
                  <i className="bi bi-x-circle me-1"></i>Reject
                </button>
              </div>
            </>
          )}

          {item.status !== "pending" && item.adminNote && (
            <div className="p-3 rounded-3" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", fontSize: 13 }}>
              <div className="text-muted mb-1" style={{ fontSize: 11 }}>Admin Note</div>
              {item.adminNote}
              {item.approvedBy && <div className="text-muted mt-1" style={{ fontSize: 11 }}>— {item.approvedBy} on {fmt(item.approvedAt)}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RefundRequestsPage() {
  const [tab, setTab] = useState("all");
  const [selected, setSelected] = useState<any>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/refund-requests", tab],
    queryFn: () => adminFetch(`/api/refund-requests${tab !== "all" ? `?status=${tab}` : ""}`).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => d?.data ? d : { data: Array.isArray(d) ? d : [], total: 0 }),
  });

  const items: any[] = Array.isArray(data?.data) ? data.data : [];

  const pendingCount = items.filter(i => i.status === "pending").length;

  return (
    <div className="container-fluid">
      {selected && <DetailModal item={selected} onClose={() => setSelected(null)} />}

      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">
            Refund Requests
            {pendingCount > 0 && <span className="badge bg-danger ms-2" style={{ fontSize: 12 }}>{pendingCount} Pending</span>}
          </h4>
          <div className="text-muted small">Customer refund requests — approve to credit wallet or reject</div>
        </div>
        <div className="d-flex gap-2">
          <span className="badge rounded-pill bg-light text-dark border" style={{ fontSize: 12, padding: "6px 14px" }}>
            Total: <strong>{data?.total ?? 0}</strong>
          </span>
          {items.length > 0 && (
            <span className="badge rounded-pill bg-danger" style={{ fontSize: 12, padding: "6px 14px" }}>
              ₹{items.filter(i => i.status === "pending").reduce((s: number, i: any) => s + parseFloat(i.amount || 0), 0).toFixed(0)} Pending
            </span>
          )}
        </div>
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <ul className="nav nav--tabs p-1 rounded bg-light">
            {TABS.map(t => (
              <li key={t} className="nav-item">
                <button className={`nav-link text-capitalize${tab === t ? " active" : ""}`}
                  onClick={() => setTab(t)} data-testid={`tab-refund-${t}`}>{t}</button>
              </li>
            ))}
          </ul>
        </div>

        <div className="table-responsive">
          <table className="table table-borderless align-middle table-hover mb-0">
            <thead style={{ background: "#f8fafc" }}>
              <tr>
                {["#", "Customer", "Amount", "Reason", "Trip Ref", "Method", "Submitted", "Status", "Action"].map((h, i) => (
                  <th key={i} className={i === 0 ? "ps-4" : ""}
                    style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", padding: "12px 8px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? Array(4).fill(0).map((_, i) => (
                <tr key={i}>{Array(9).fill(0).map((_, j) => (
                  <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4, width: j === 0 ? 20 : "90%" }} /></td>
                ))}</tr>
              )) : items.length === 0 ? (
                <tr><td colSpan={9}>
                  <div className="text-center py-5 text-muted">
                    <i className="bi bi-arrow-counterclockwise fs-1 d-block mb-2" style={{ opacity: 0.2 }}></i>
                    <p className="fw-semibold mb-1">No refund requests</p>
                    <p className="small">Refund requests will appear here</p>
                  </div>
                </td></tr>
              ) : items.map((item: any, idx: number) => {
                const sc = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
                const name = item.customerName || "Customer";
                return (
                  <tr key={item.id} data-testid={`row-refund-${item.id}`}
                    style={{ background: item.status === "pending" ? "#fffbeb" : "white" }}>
                    <td className="ps-4 text-muted small">{idx + 1}</td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                          style={{ width: 30, height: 30, background: avatarBg(name), color: "white", fontSize: 11, fontWeight: 700 }}>
                          {initials(name)}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>{item.customerPhone || ""}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="fw-bold text-danger" style={{ fontSize: 14 }}>₹{parseFloat(item.amount || 0).toFixed(0)}</span>
                    </td>
                    <td style={{ maxWidth: 200 }}>
                      <div className="text-truncate" style={{ fontSize: 12, color: "#64748b" }} title={item.reason}>
                        {item.reason || "—"}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, fontFamily: "monospace", color: "#1a73e8" }}>{item.tripRef || "—"}</span>
                    </td>
                    <td>
                      <span className="badge bg-light text-dark" style={{ fontSize: 10 }}>
                        <i className={`bi ${item.paymentMethod === "bank" ? "bi-bank" : "bi-wallet2"} me-1`}></i>
                        {item.paymentMethod || "wallet"}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>{fmt(item.createdAt)}</td>
                    <td>
                      <span className={`badge ${sc.cls}`} style={{ fontSize: 10 }}>{sc.label}</span>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: "3px 10px" }}
                        onClick={() => setSelected(item)} data-testid={`btn-view-refund-${item.id}`}>
                        <i className="bi bi-eye me-1"></i>Review
                      </button>
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
