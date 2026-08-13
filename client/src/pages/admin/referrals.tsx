import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getSavedAdminSession } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";
import { adminHasPermission } from "@shared/permissions";

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  paid: { bg: "#dcfce7", color: "#166534", label: "Paid" },
  pending: { bg: "#fef3c7", color: "#92400e", label: "Pending" },
  expired: { bg: "#e2e8f0", color: "#475569", label: "Expired" },
};

const formatCurrency = (value: any) => `Rs. ${Number(value || 0).toFixed(0)}`;

const formatTypeLabel = (value: string) =>
  value === "driver" ? "Driver" : value === "customer" ? "Customer" : "Referral";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function normalizeReferrals(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    if (Array.isArray(value.data)) return value.data;
    if (Array.isArray(value.referrals)) return value.referrals;
  }
  return [];
}

export default function ReferralsPage() {
  const { toast } = useToast();
  // Referral payout is a money-movement action - restricted to
  // withdrawals.write holders per the Business Authorization Matrix.
  // marketing_exec can manage campaign setup but not disburse funds.
  const canPayout = adminHasPermission(getSavedAdminSession().role, "withdrawals.write");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: stats } = useQuery<any>({ queryKey: ["/api/referrals/stats"] });
  const { data: referrals = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/referrals", { status: statusFilter, referralType: typeFilter }],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/referrals?status=${statusFilter}&referralType=${typeFilter}`);
      const body = await response.json().catch(() => []);
      return normalizeReferrals(body);
    },
  });
  const referralRows = Array.isArray(referrals) ? referrals : [];

  const payMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/referrals/${id}/pay`, {}),
    onSuccess: () => {
      toast({ title: "Referral marked as paid" });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/stats"] });
    },
    onError: (e: any) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const expireMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/referrals/${id}/expire`, {}),
    onSuccess: () => {
      toast({ title: "Referral marked as expired" });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/stats"] });
    },
    onError: (e: any) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const statCards = [
    { label: "Total Referrals", val: stats?.total || 0, icon: "bi-share-fill", color: "#4f46e5", bg: "linear-gradient(135deg,#4f46e515,#818cf815)" },
    { label: "Paid Out", val: stats?.paid || 0, icon: "bi-check-circle-fill", color: "#059669", bg: "linear-gradient(135deg,#05966915,#34d39915)" },
    { label: "Pending", val: stats?.pending || 0, icon: "bi-clock-fill", color: "#d97706", bg: "linear-gradient(135deg,#d9770615,#fbbf2415)" },
    { label: "Rewarded", val: formatCurrency(stats?.totalRewarded || 0), icon: "bi-gift-fill", color: "#0284c7", bg: "linear-gradient(135deg,#0284c715,#38bdf815)" },
  ];

  const summaryCards = [
    {
      title: "Customer Referrals",
      total: stats?.customerReferrals || 0,
      amount: formatCurrency(stats?.pendingAmount || 0),
      amountLabel: "Pending reward",
      color: "#4f46e5",
    },
    {
      title: "Driver Referrals",
      total: stats?.driverReferrals || 0,
      amount: formatCurrency(stats?.totalRewarded || 0),
      amountLabel: "Total rewarded",
      color: "#059669",
    },
  ];

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <h2 className="h5 mb-3">Referral Management</h2>
        </div>
      </div>
      <div className="container-fluid">
        <div className="row g-3 mb-4">
          {statCards.map((card, index) => (
            <div key={index} className="col-6 col-md-3">
              <div className="card border-0" style={{ background: card.bg, boxShadow: "0 14px 32px rgba(15,23,42,.05)" }}>
                <div className="card-body d-flex align-items-center gap-3 p-3">
                  <div style={{ width: 46, height: 46, borderRadius: 12, background: `${card.color}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className={`bi ${card.icon}`} style={{ color: card.color, fontSize: "1.1rem" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: card.color, lineHeight: 1 }}>{card.val}</div>
                    <div style={{ fontSize: "0.74rem", color: "#64748b", marginTop: 4 }}>{card.label}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="row g-3 mb-4">
          {summaryCards.map((card) => (
            <div key={card.title} className="col-md-6">
              <div
                className="card border-0"
                style={{
                  borderRadius: 16,
                  background: "linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,250,252,.96))",
                  boxShadow: "0 18px 40px rgba(15,23,42,.06)",
                }}
              >
                <div className="card-body p-3">
                  <div className="fw-semibold mb-1" style={{ fontSize: "0.78rem", color: "#64748b" }}>{card.title.toUpperCase()}</div>
                  <div className="d-flex gap-4">
                    <div>
                      <span style={{ fontSize: "1.5rem", fontWeight: 700, color: card.color }}>{card.total}</span>
                      <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Total</div>
                    </div>
                    <div>
                      <span style={{ fontSize: "1.5rem", fontWeight: 700, color: card.color }}>{card.amount}</span>
                      <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{card.amountLabel}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div
          className="card border-0"
          style={{
            borderRadius: 18,
            background: "linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,250,252,.96))",
            boxShadow: "0 18px 40px rgba(15,23,42,.06)",
          }}
        >
          <div className="card-body">
            <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-4">
              <h5 className="text-primary mb-0">Referral List</h5>
              <div className="d-flex gap-2 flex-wrap">
                <div className="d-flex gap-1 flex-wrap">
                  {["all", "pending", "paid", "expired"].map((status) => (
                    <button
                      key={status}
                      className={`btn btn-sm ${statusFilter === status ? "btn-primary" : "btn-outline-secondary"}`}
                      onClick={() => setStatusFilter(status)}
                      data-testid={`filter-status-${status}`}
                      style={{ fontSize: "0.75rem" }}
                    >
                      {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="d-flex gap-1">
                  {["all", "customer", "driver"].map((type) => (
                    <button
                      key={type}
                      className={`btn btn-sm ${typeFilter === type ? "btn-info text-white" : "btn-outline-secondary"}`}
                      onClick={() => setTypeFilter(type)}
                      data-testid={`filter-type-${type}`}
                      style={{ fontSize: "0.75rem" }}
                    >
                      {type === "all" ? "All Types" : formatTypeLabel(type)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="table-responsive">
              <table className="table table-borderless align-middle table-hover">
                <thead className="table-light" style={{ fontSize: "0.78rem" }}>
                  <tr>
                    <th>#</th>
                    <th>Referrer</th>
                    <th>Referred User</th>
                    <th>Code</th>
                    <th>Type</th>
                    <th className="text-end">Reward</th>
                    <th>Date</th>
                    <th className="text-center">Status</th>
                    <th className="text-center">Action</th>
                  </tr>
                </thead>
                <tbody style={{ fontSize: "0.82rem" }}>
                  {isLoading ? (
                    Array(5).fill(0).map((_, i) => (
                      <tr key={i}>{Array(9).fill(0).map((__, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                    ))
                  ) : referralRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-4 text-muted">
                        <i className="bi bi-share fs-2 d-block mb-2 opacity-25"></i>
                        No referrals found
                      </td>
                    </tr>
                  ) : (
                    referralRows.map((referral: any, index: number) => {
                      const statusStyle = STATUS_STYLES[referral.status] || STATUS_STYLES.pending;
                      return (
                        <tr
                          key={referral.id}
                          data-testid={`referral-row-${referral.id}`}
                          style={{ borderBottom: "1px solid rgba(226,232,240,.7)" }}
                        >
                          <td>{index + 1}</td>
                          <td>
                            <div className="fw-semibold">{referral.referrerName || "-"}</div>
                            <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{referral.referrerPhone || "-"}</div>
                            <span
                              className="badge rounded-pill"
                              style={{
                                background: referral.referrerType === "driver" ? "rgba(22,163,74,.12)" : "rgba(37,99,235,.12)",
                                color: referral.referrerType === "driver" ? "#166534" : "#1d4ed8",
                                fontSize: "0.65rem",
                              }}
                            >
                              {formatTypeLabel(referral.referrerType)}
                            </span>
                          </td>
                          <td>
                            {referral.referredName ? (
                              <>
                                <div className="fw-semibold">{referral.referredName}</div>
                                <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{referral.referredPhone || "-"}</div>
                              </>
                            ) : (
                              <span className="text-muted" style={{ fontSize: "0.75rem" }}>Not yet registered</span>
                            )}
                          </td>
                          <td>
                            <span
                              style={{
                                background: "linear-gradient(135deg, rgba(79,70,229,.08), rgba(129,140,248,.18))",
                                color: "#4338ca",
                                border: "1px solid rgba(79,70,229,.14)",
                                padding: "0.35rem 0.6rem",
                                borderRadius: 999,
                                fontWeight: 700,
                                fontSize: "0.75rem",
                              }}
                            >
                              {referral.referralCode || "-"}
                            </span>
                          </td>
                          <td>
                            <span
                              className="badge rounded-pill"
                              style={{
                                background: referral.referralType === "driver" ? "rgba(22,163,74,.12)" : "rgba(59,130,246,.12)",
                                color: referral.referralType === "driver" ? "#166534" : "#1d4ed8",
                                fontSize: "0.7rem",
                              }}
                            >
                              {formatTypeLabel(referral.referralType)}
                            </span>
                          </td>
                          <td className="text-end fw-semibold">{formatCurrency(referral.rewardAmount || 0)}</td>
                          <td style={{ fontSize: "0.75rem", color: "#64748b" }}>{timeAgo(referral.createdAt)}</td>
                          <td className="text-center">
                            <span
                              style={{
                                background: statusStyle.bg,
                                color: statusStyle.color,
                                padding: "0.35rem 0.7rem",
                                borderRadius: 999,
                                fontSize: "0.7rem",
                                fontWeight: 700,
                              }}
                            >
                              {statusStyle.label}
                            </span>
                          </td>
                          <td className="text-center">
                            <div className="d-flex gap-1 justify-content-center">
                              {referral.status === "pending" ? (
                                canPayout ? (
                                <>
                                  <button
                                    className="btn btn-sm btn-success"
                                    style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                                    disabled={payMutation.isPending}
                                    onClick={async () => {
                                      if (await adminConfirm({
                                        title: "Confirm referral payout",
                                        message: `Pay ${formatCurrency(referral.rewardAmount)} to ${referral.referrerName}?`,
                                        confirmLabel: "Pay",
                                        variant: "primary",
                                      })) {
                                        payMutation.mutate(referral.id);
                                      }
                                    }}
                                    data-testid={`btn-pay-${referral.id}`}
                                  >
                                    <i className="bi bi-check-circle me-1"></i>Pay
                                  </button>
                                  <button
                                    className="btn btn-sm btn-outline-secondary"
                                    style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                                    disabled={expireMutation.isPending}
                                    onClick={() => expireMutation.mutate(referral.id)}
                                    data-testid={`btn-expire-${referral.id}`}
                                  >
                                    Expire
                                  </button>
                                </>
                                ) : (
                                  <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>Pending approval</span>
                                )
                              ) : (
                                <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>-</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
