import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { adminFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const avatarBg = (name: string) => {
  const colors = ["#1a73e8","#16a34a","#d97706","#9333ea","#dc2626"];
  return colors[(name || "A").charCodeAt(0) % colors.length];
};

function TopUpModal({ open, onClose, customer, onSave, saving }: any) {
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"topup" | "deduct">("topup");
  const [note, setNote] = useState("");
  if (!open || !customer) return null;
  return (
    <div className="modal-backdrop-jago">
      <div className="modal-jago" style={{ maxWidth: 420 }}>
        <div className="modal-jago-header">
          <h5 className="modal-jago-title">
            <i className="bi bi-wallet2 me-2 text-primary"></i>Wallet Transaction
          </h5>
          <button className="modal-jago-close" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>

        <div className="d-flex flex-column gap-3">
          <div className="p-3 rounded-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
            <div className="d-flex align-items-center gap-3">
              <div className="rounded-circle d-flex align-items-center justify-content-center"
                style={{ width: 44, height: 44, background: avatarBg(customer.fullName || ""), color: "white", fontSize: 16, fontWeight: 700 }}>
                {(customer.fullName || "?")[0].toUpperCase()}
              </div>
              <div>
                <div className="fw-bold">{customer.fullName || "—"}</div>
                <div className="text-muted small">{customer.phone || customer.email || "—"}</div>
              </div>
              <div className="ms-auto text-end">
                <div className="text-muted small">Current Balance</div>
                <div className="fw-bold text-success">₹{Number(customer.walletBalance || 0).toFixed(2)}</div>
              </div>
            </div>
          </div>

          <div>
            <label className="form-label-jago">Transaction Type</label>
            <div className="d-flex gap-2">
              <button type="button"
                style={{ flex: 1, padding: "8px 12px", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer", transition: "all 0.15s",
                  background: type === "topup" ? "#16a34a" : "#f8fafc",
                  color: type === "topup" ? "#fff" : "#64748b",
                  border: `1.5px solid ${type === "topup" ? "#16a34a" : "#e2e8f0"}` }}
                onClick={() => setType("topup")} data-testid="btn-type-topup">
                <i className="bi bi-plus-circle me-1"></i>Add / Top-up
              </button>
              <button type="button"
                style={{ flex: 1, padding: "8px 12px", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer", transition: "all 0.15s",
                  background: type === "deduct" ? "#dc2626" : "#f8fafc",
                  color: type === "deduct" ? "#fff" : "#64748b",
                  border: `1.5px solid ${type === "deduct" ? "#dc2626" : "#e2e8f0"}` }}
                onClick={() => setType("deduct")} data-testid="btn-type-deduct">
                <i className="bi bi-dash-circle me-1"></i>Deduct
              </button>
            </div>
          </div>

          <div>
            <label className="form-label-jago">Amount (₹) <span className="text-danger">*</span></label>
            <div className="input-group">
              <span className="input-group-text fw-bold">₹</span>
              <input type="number" min="0" step="0.01" className="admin-form-control"
                value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00" data-testid="input-topup-amount" />
            </div>
          </div>

          <div>
            <label className="form-label-jago">Note (optional)</label>
            <input className="admin-form-control" value={note} onChange={e => setNote(e.target.value)}
              placeholder="Reason for transaction…" data-testid="input-topup-note" />
          </div>

          <div className="d-flex gap-2 justify-content-end pt-2 border-top">
            <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn" disabled={!amount || saving}
              style={{ background: type === "topup" ? "#16a34a" : "#dc2626", color: "white", minWidth: 120 }}
              onClick={() => onSave({ userId: customer.id, amount: parseFloat(amount), type })}
              data-testid="btn-confirm-topup">
              {saving ? <><span className="spinner-border spinner-border-sm me-2"></span>Processing…</> :
                type === "topup" ? "Add Balance" : "Deduct Balance"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CustomerWalletPage() {
  const [search, setSearch] = useState("");
  const [topUpTarget, setTopUpTarget] = useState<any>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/users", { userType: "customer" }],
    queryFn: () => adminFetch("/api/users?userType=customer&limit=200").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => (d && !d.message && !d.error) ? d : { data: [] }),
  });
  const customers = Array.isArray(data?.data) ? data.data : [];
  const filtered = customers.filter((c: any) =>
    !search || (c.fullName || c.firstName || "").toLowerCase().includes(search.toLowerCase()) || (c.phone || "").includes(search)
  );

  const topUp = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/customer-wallet/topup", payload).then(r => r.json()),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: `Wallet updated — New balance: ₹${parseFloat(data.newBalance ?? 0).toFixed(2)}` });
      setTopUpTarget(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const totalBalance = customers.reduce((sum: number, c: any) => sum + Number(c.walletBalance || 0), 0);
  const activeWallets = customers.filter((c: any) => (c.walletBalance || 0) > 0).length;

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">Customer Wallet</h4>
          <div className="text-muted small">Manage customer wallet balances</div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="row g-3 mb-3">
        {[
          { label: "Total Customers", val: customers.length, icon: "bi-people-fill", color: "#1a73e8", bg: "#e8f0fe" },
          { label: "Active Wallets", val: activeWallets, icon: "bi-wallet2", color: "#16a34a", bg: "#f0fdf4" },
          { label: "Total Balance", val: `₹${totalBalance.toFixed(0)}`, icon: "bi-currency-rupee", color: "#d97706", bg: "#fefce8" },
          { label: "Zero Balance", val: customers.length - activeWallets, icon: "bi-exclamation-circle", color: "#94a3b8", bg: "#f8fafc" },
        ].map((s, i) => (
          <div key={i} className="col-6 col-xl-3">
            <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: 44, height: 44, background: s.bg, color: s.color, fontSize: "1.1rem" }}>
                  <i className={`bi ${s.icon}`}></i>
                </div>
                <div>
                  <div className="fw-bold lh-1 mb-1" style={{ fontSize: 20, color: s.color }}>
                    {isLoading ? "—" : s.val}
                  </div>
                  <div className="text-muted small">{s.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4 d-flex align-items-center justify-content-between flex-wrap gap-2"
          style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div className="fw-semibold" style={{ fontSize: 14 }}>Wallet Balances</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "6px 12px" }}>
            <i className="bi bi-search" style={{ fontSize: 12, color: "#94a3b8" }}></i>
            <input style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, width: 200 }}
              placeholder="Search customer…" value={search} onChange={e => setSearch(e.target.value)}
              data-testid="input-wallet-search" />
          </div>
        </div>

        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover mb-0">
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  {["#","Customer","Phone","Email","Balance","Status","Action"].map((h, i) => (
                    <th key={i}
                      className={i === 0 ? "ps-4" : i === 6 ? "text-center pe-4" : ""}
                      style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", paddingTop: 12, paddingBottom: 12 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(4).fill(0).map((_, i) => (
                    <tr key={i}>{Array(7).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7}>
                    <div className="text-center py-5 text-muted">
                      <i className="bi bi-wallet-fill fs-1 d-block mb-2" style={{ opacity: 0.25 }}></i>
                      <p className="fw-semibold mb-1">No customers found</p>
                    </div>
                  </td></tr>
                ) : filtered.map((c: any, idx: number) => {
                  const name = c.fullName || `${c.firstName || ""} ${c.lastName || ""}`.trim() || "—";
                  const balance = Number(c.walletBalance || 0);
                  return (
                    <tr key={c.id} data-testid={`row-wallet-${c.id}`}>
                      <td className="ps-4 text-muted small">{idx + 1}</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                            style={{ width: 34, height: 34, background: avatarBg(name), color: "white", fontSize: 13, fontWeight: 700 }}>
                            {name[0].toUpperCase()}
                          </div>
                          <span className="fw-semibold" style={{ fontSize: 13 }}>{name}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 13 }}>{c.phone || "—"}</td>
                      <td style={{ fontSize: 13, color: "#64748b" }}>{c.email || "—"}</td>
                      <td>
                        <div className="fw-bold" style={{ color: balance > 0 ? "#16a34a" : "#94a3b8", fontSize: 14 }}>
                          ₹{balance.toFixed(2)}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${c.isActive ? "bg-success" : "bg-secondary"}`} style={{ fontSize: 10 }}>
                          {c.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="text-center pe-4">
                        <button className="btn btn-sm btn-outline-primary"
                          style={{ borderRadius: 8, fontSize: 11 }}
                          onClick={() => setTopUpTarget(c)}
                          data-testid={`btn-topup-${c.id}`}>
                          <i className="bi bi-wallet2 me-1"></i>Manage
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

      <TopUpModal
        open={!!topUpTarget} onClose={() => setTopUpTarget(null)}
        customer={topUpTarget}
        onSave={(payload: any) => topUp.mutate(payload)}
        saving={topUp.isPending}
      />
    </div>
  );
}
