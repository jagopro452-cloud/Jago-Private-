import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { adminFetch, queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function WalletBadge({ balance }: { balance: number }) {
  const neg = balance < 0;
  const warn = balance >= 0 && balance < 50;
  return (
    <span className={`fw-bold`} style={{ fontSize: 15, color: neg ? "#dc2626" : warn ? "#d97706" : "#16a34a" }}>
      {neg ? "−" : "+"}₹{Math.abs(balance).toFixed(2)}
      {neg && <i className="bi bi-exclamation-triangle-fill ms-1" style={{ fontSize: 11 }}></i>}
    </span>
  );
}

function DriverDetail({ driver, onClose }: { driver: any; onClose: () => void }) {
  const { toast } = useToast();
  const [creditAmount, setCreditAmount] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [showCredit, setShowCredit] = useState(false);

  const { data: histData, isLoading: histLoading } = useQuery<any>({
    queryKey: ["/api/driver-wallet", driver.id, "history"],
    queryFn: () => adminFetch(`/api/driver-wallet/${driver.id}/history`).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => d?.data ? d : { data: Array.isArray(d) ? d : [] }),
  });
  const history: any[] = Array.isArray(histData?.data) ? histData.data : [];

  const creditMut = useMutation({
    mutationFn: ({ id, amount, desc }: any) => apiRequest("POST", `/api/driver-wallet/${id}/credit`, { amount: parseFloat(amount), description: desc }),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/driver-wallet"] });
      setShowCredit(false); setCreditAmount(""); setCreditNote("");
      toast({ title: data.autoUnlocked ? "Payment credited & Driver Unlocked!" : "Payment credited", description: `New balance: ₹${parseFloat(data.newBalance).toFixed(2)}` });
      onClose();
    },
  });

  const lockMut = useMutation({
    mutationFn: ({ id, lock }: any) => apiRequest("PATCH", `/api/driver-wallet/${id}/lock`, { lock, reason: lock ? "Manually locked by admin" : undefined }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/driver-wallet"] }); toast({ title: driver.isLocked ? "Driver unlocked" : "Driver locked" }); onClose(); },
  });

  const PAY_TYPE_LABEL: any = { deduction: "Platform Deduction", wallet_topup: "Razorpay Payment", manual_credit: "Manual Credit (Admin)" };
  const PAY_TYPE_COLOR: any = { deduction: "#dc2626", wallet_topup: "#16a34a", manual_credit: "#1a73e8" };

  return (
    <div className="modal-backdrop-jago">
      <div className="modal-jago" style={{ maxWidth: 700 }}>
        <div className="modal-jago-header">
          <h5 className="modal-jago-title">
            <i className="bi bi-wallet2 me-2"></i>{driver.fullName}
            {driver.isLocked && <span className="badge bg-danger ms-2" style={{ fontSize: 10 }}><i className="bi bi-lock-fill me-1"></i>LOCKED</span>}
          </h5>
          <button className="modal-jago-close" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>
        <div className="p-4">
          {/* Balance summary */}
          <div className="row g-3 mb-4">
            {[
              { label: "Wallet Balance", val: <WalletBadge balance={parseFloat(driver.walletBalance || 0)} />, icon: "bi-wallet2", bg: parseFloat(driver.walletBalance || 0) < 0 ? "#fef2f2" : "#f0fdf4" },
              { label: "Pending Amount", val: `₹${parseFloat(driver.pendingPaymentAmount || 0).toFixed(2)}`, icon: "bi-hourglass-split", bg: "#fefce8" },
              { label: "Completed Trips", val: driver.completedTrips || 0, icon: "bi-car-front-fill", bg: "#e8f0fe" },
              { label: "Gross Earnings", val: `₹${parseFloat(driver.grossEarnings || 0).toFixed(0)}`, icon: "bi-cash-stack", bg: "#f0fdf4" },
            ].map((s, i) => (
              <div key={i} className="col-6 col-md-3">
                <div className="p-3 rounded-3 text-center" style={{ background: s.bg }}>
                  <div className="fw-bold" style={{ fontSize: 16 }}>{s.val}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Lock reason */}
          {driver.isLocked && driver.lockReason && (
            <div className="alert alert-danger py-2 px-3 mb-3" style={{ fontSize: 12.5 }}>
              <i className="bi bi-lock-fill me-2"></i><strong>Lock Reason:</strong> {driver.lockReason}
            </div>
          )}

          {/* Actions */}
          <div className="d-flex gap-2 mb-4 flex-wrap">
            <button className="btn btn-success btn-sm" onClick={() => setShowCredit(!showCredit)} data-testid="btn-credit-wallet">
              <i className="bi bi-plus-circle me-1"></i>Credit Wallet (Manual)
            </button>
            <button className={`btn btn-sm ${driver.isLocked ? "btn-outline-success" : "btn-outline-danger"}`}
              onClick={() => lockMut.mutate({ id: driver.id, lock: !driver.isLocked })}
              data-testid="btn-toggle-lock">
              <i className={`bi ${driver.isLocked ? "bi-unlock-fill" : "bi-lock-fill"} me-1`}></i>
              {driver.isLocked ? "Unlock Driver" : "Lock Driver"}
            </button>
          </div>

          {/* Credit form */}
          {showCredit && (
            <div className="p-3 mb-4 rounded-3" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
              <div className="fw-semibold mb-2" style={{ fontSize: 13 }}>Credit Driver Wallet (Offline Payment)</div>
              <div className="row g-2">
                <div className="col-md-4">
                  <label className="form-label small">Amount (₹)</label>
                  <input type="number" className="form-control form-control-sm" value={creditAmount}
                    onChange={e => setCreditAmount(e.target.value)} placeholder="e.g. 105" data-testid="input-credit-amount" />
                </div>
                <div className="col-md-5">
                  <label className="form-label small">Note</label>
                  <input type="text" className="form-control form-control-sm" value={creditNote}
                    onChange={e => setCreditNote(e.target.value)} placeholder="Cash received, bank transfer…" />
                </div>
                <div className="col-md-3 d-flex align-items-end">
                  <button className="btn btn-success btn-sm w-100" disabled={!creditAmount || creditMut.isPending}
                    onClick={() => creditMut.mutate({ id: driver.id, amount: creditAmount, desc: creditNote || "Manual credit by admin" })}
                    data-testid="btn-confirm-credit">
                    {creditMut.isPending ? <span className="spinner-border spinner-border-sm"></span> : "Credit & Unlock"}
                  </button>
                </div>
              </div>
              {parseFloat(String(driver.walletBalance || '0')) < 0 && creditAmount && (
                <div className="mt-2" style={{ fontSize: 11.5, color: "#166534" }}>
                  <i className="bi bi-calculator me-1"></i>
                  New balance: ₹{(parseFloat(String(driver.walletBalance || '0')) + parseFloat(creditAmount || '0')).toFixed(2)}
                  {(parseFloat(String(driver.walletBalance || '0')) + parseFloat(creditAmount || '0')) >= 0 && " → Auto-unlock ✓"}
                </div>
              )}
            </div>
          )}

          {/* Payment History */}
          <div className="fw-semibold mb-2" style={{ fontSize: 13 }}>Payment History</div>
          {histLoading ? <div className="text-center py-3"><div className="spinner-border spinner-border-sm"></div></div>
            : history.length === 0 ? <div className="text-muted small text-center py-3">No payment history</div>
            : (
              <div className="table-responsive" style={{ maxHeight: 250 }}>
                <table className="table table-sm table-borderless mb-0">
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      {["Date", "Type", "Amount", "Status", "Description"].map(h => (
                        <th key={h} style={{ fontSize: 10.5, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((p: any) => (
                      <tr key={p.id}>
                        <td style={{ fontSize: 11 }}>{p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN") : "—"}</td>
                        <td><span style={{ fontSize: 11, color: PAY_TYPE_COLOR[p.paymentType] || "#64748b" }}>{PAY_TYPE_LABEL[p.paymentType] || p.paymentType}</span></td>
                        <td style={{ fontSize: 12, fontWeight: 600, color: p.paymentType === "deduction" ? "#dc2626" : "#16a34a" }}>
                          {p.paymentType === "deduction" ? "−" : "+"}₹{parseFloat(p.amount || 0).toFixed(2)}
                        </td>
                        <td><span className={`badge ${p.status === "completed" ? "bg-success" : "bg-warning text-dark"}`} style={{ fontSize: 9 }}>{p.status}</span></td>
                        <td style={{ fontSize: 11, color: "#64748b" }}>{p.description || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

export default function DriverWalletPage() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<any>(null);
  const [filter, setFilter] = useState<"all" | "locked" | "negative" | "positive">("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/driver-wallet"],
    queryFn: () => adminFetch("/api/driver-wallet").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => d?.data ? d : { data: Array.isArray(d) ? d : [] }),
  });
  const { data: modelData } = useQuery<any>({
    queryKey: ["/api/revenue-model"],
    queryFn: () => adminFetch("/api/revenue-model").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => (d && !d.message && !d.error) ? d : {}),
  });
  const allDrivers: any[] = Array.isArray(data?.data) ? data.data : [];
  const model = modelData || {};

  const filtered = allDrivers.filter(d => {
    if (filter === "locked" && !d.isLocked) return false;
    if (filter === "negative" && parseFloat(d.walletBalance || 0) >= 0) return false;
    if (filter === "positive" && parseFloat(d.walletBalance || 0) < 0) return false;
    if (search && !d.fullName?.toLowerCase().includes(search.toLowerCase()) && !d.phone?.includes(search)) return false;
    return true;
  });

  const totalNegative = allDrivers.filter(d => parseFloat(d.walletBalance || 0) < 0).length;
  const lockedCount = allDrivers.filter(d => d.isLocked).length;
  const totalPending = allDrivers.reduce((s, d) => s + parseFloat(d.pendingPaymentAmount || 0), 0);

  const activeModel = model["active_model"] || "commission";
  const commPct = parseFloat(model["commission_pct"] || "15");
  const gstPct = parseFloat(model["commission_gst_pct"] || "18");
  const insPerRide = parseFloat(model["commission_insurance_per_ride"] || "2");
  const totalDeductPct = commPct + (commPct * gstPct / 100);

  return (
    <div className="container-fluid">
      {selected && <DriverDetail driver={selected} onClose={() => setSelected(null)} />}

      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">Driver Wallet</h4>
          <div className="text-muted small">Platform fee tracking, auto-lock, and payment management</div>
        </div>
        <div className="d-flex gap-2">
          <span className={`badge rounded-pill ${activeModel === "commission" ? "bg-warning text-dark" : "bg-primary"}`}
            style={{ fontSize: 11, padding: "6px 12px" }}>
            <i className={`bi ${activeModel === "commission" ? "bi-percent" : "bi-card-checklist"} me-1`}></i>
            {activeModel === "commission" ? `Commission Model (${commPct}% + ${gstPct}% GST + ₹${insPerRide}/ride)` : "Subscription Model Active"}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="row g-3 mb-3">
        {[
          { label: "Total Drivers", val: allDrivers.length, icon: "bi-person-fill", color: "#1a73e8", bg: "#e8f0fe" },
          { label: "Negative Balance", val: totalNegative, icon: "bi-exclamation-triangle-fill", color: "#dc2626", bg: "#fef2f2" },
          { label: "Locked Accounts", val: lockedCount, icon: "bi-lock-fill", color: "#d97706", bg: "#fefce8" },
          { label: "Total Pending", val: `₹${totalPending.toFixed(0)}`, icon: "bi-clock-fill", color: "#7c3aed", bg: "#f5f3ff" },
        ].map((s, i) => (
          <div key={i} className="col-6 col-md-3">
            <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center"
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

      {/* Auto-lock info strip */}
      <div className="card border-0 mb-3" style={{ background: "#fef2f2", borderRadius: 12, border: "1px solid #fecaca" }}>
        <div className="card-body py-2 px-4">
          <div className="d-flex flex-wrap align-items-center gap-3" style={{ fontSize: 12.5, color: "#991b1b" }}>
            <span className="fw-semibold"><i className="bi bi-lock-fill me-1"></i>Auto-Lock Rules:</span>
            <span>Balance &lt; −₹{Math.abs(parseFloat(model["auto_lock_threshold"] || "-100"))} → Account auto-locked</span>
            <i className="bi bi-dot"></i>
            <span>Driver gets payment reminders</span>
            <i className="bi bi-dot"></i>
            <span>Partial payment OK → Auto-unlock when balance ≥ ₹0</span>
            <i className="bi bi-dot"></i>
            <span>Pay via Razorpay → Company account</span>
          </div>
        </div>
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4 d-flex align-items-center justify-content-between flex-wrap gap-2"
          style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div className="d-flex gap-2 flex-wrap">
            {([
              { key: "all", label: "All Drivers", count: allDrivers.length },
              { key: "locked", label: "Locked", count: lockedCount, danger: true },
              { key: "negative", label: "Negative Balance", count: totalNegative, warn: true },
              { key: "positive", label: "Positive", count: allDrivers.length - totalNegative },
            ] as any[]).map(f => (
              <button key={f.key}
                className={`btn btn-sm rounded-pill ${filter === f.key ? (f.danger ? "btn-danger" : f.warn ? "btn-warning" : "btn-primary") : "btn-outline-secondary"}`}
                style={{ fontSize: 11, padding: "3px 12px" }}
                onClick={() => setFilter(f.key)} data-testid={`filter-wallet-${f.key}`}>
                {f.label} ({f.count})
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "6px 12px" }}>
            <i className="bi bi-search" style={{ fontSize: 12, color: "#94a3b8" }}></i>
            <input style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, width: 160 }}
              placeholder="Search driver…" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-wallet-search" />
          </div>
        </div>

        <div className="table-responsive">
          <table className="table table-borderless align-middle table-hover mb-0">
            <thead style={{ background: "#f8fafc" }}>
              <tr>
                {["#", "Driver", "Wallet Balance", "Pending Amount", "Status", "Trips", "Lock Reason", "Actions"].map((h, i) => (
                  <th key={i} className={i === 0 ? "ps-4" : ""}
                    style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", padding: "12px 8px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? Array(4).fill(0).map((_, i) => (
                <tr key={i}>{Array(8).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4, width: j === 0 ? 20 : "100%" }} /></td>)}</tr>
              )) : filtered.length === 0 ? (
                <tr><td colSpan={8}>
                  <div className="text-center py-5 text-muted">
                    <i className="bi bi-wallet2 fs-1 d-block mb-2" style={{ opacity: 0.2 }}></i>
                    <p className="fw-semibold mb-1">No drivers found</p>
                  </div>
                </td></tr>
              ) : filtered.map((d: any, idx: number) => {
                const balance = parseFloat(d.walletBalance || 0);
                const pending = parseFloat(d.pendingPaymentAmount || 0);
                return (
                  <tr key={d.id} data-testid={`row-wallet-${d.id}`}
                    style={{ background: d.isLocked ? "#fff5f5" : balance < 0 ? "#fffbeb" : "white" }}>
                    <td className="ps-4 text-muted small">{idx + 1}</td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                          style={{ width: 34, height: 34, background: d.isLocked ? "#fef2f2" : "#e8f0fe", color: d.isLocked ? "#dc2626" : "#1a73e8", fontSize: 12, fontWeight: 700 }}>
                          {d.isLocked ? <i className="bi bi-lock-fill"></i> : (d.fullName || "D").charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{d.fullName || "—"}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>{d.phone || ""}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <WalletBadge balance={balance} />
                    </td>
                    <td>
                      {pending > 0 ? (
                        <span style={{ fontSize: 12, color: "#d97706", fontWeight: 600 }}>
                          <i className="bi bi-hourglass-split me-1" style={{ fontSize: 10 }}></i>₹{pending.toFixed(2)}
                        </span>
                      ) : <span className="text-muted" style={{ fontSize: 12 }}>—</span>}
                    </td>
                    <td>
                      {d.isLocked
                        ? <span className="badge bg-danger" style={{ fontSize: 10 }}><i className="bi bi-lock-fill me-1"></i>Locked</span>
                        : balance < 0
                          ? <span className="badge bg-warning text-dark" style={{ fontSize: 10 }}><i className="bi bi-exclamation-triangle me-1"></i>Negative</span>
                          : <span className="badge bg-success" style={{ fontSize: 10 }}><i className="bi bi-check-circle me-1"></i>Active</span>}
                    </td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>{d.completedTrips || 0}</td>
                    <td style={{ maxWidth: 160 }}>
                      {d.lockReason ? (
                        <div style={{ fontSize: 10.5, color: "#dc2626" }} title={d.lockReason}>
                          {d.lockReason.substring(0, 40)}{d.lockReason.length > 40 ? "…" : ""}
                        </div>
                      ) : <span className="text-muted" style={{ fontSize: 11 }}>—</span>}
                    </td>
                    <td>
                      <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: "3px 10px" }}
                        onClick={() => setSelected(d)} data-testid={`btn-detail-${d.id}`}>
                        <i className="bi bi-eye me-1"></i>Manage
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
