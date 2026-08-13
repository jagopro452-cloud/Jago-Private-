import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, apiRequest, getSavedAdminSession } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminHasPermission } from "@shared/permissions";

const statusBadge: Record<string, string> = {
  pending: "badge bg-warning text-dark",
  approved: "badge bg-success",
  rejected: "badge bg-danger",
};

export default function Withdrawals() {
  const { toast } = useToast();
  const qc = useQueryClient();
  // Withdrawal approval moves real payout money - restricted to
  // withdrawals.write holders (senior ops leadership + Finance) per the
  // Business Authorization Matrix. zone_manager can see this list
  // (withdrawals.read) but cannot approve/reject.
  const canApprove = adminHasPermission(getSavedAdminSession().role, "withdrawals.write");

  const { data, isLoading } = useQuery<any[]>({
    queryKey: ["/api/withdrawals"],
    queryFn: () => adminFetch("/api/withdrawals").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
  });

  const update = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      apiRequest("POST", `/api/admin/withdrawals/${id}/${action}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["/api/withdrawals"] });
      toast({ title: variables.action === "approve" ? "Withdrawal approved" : "Withdrawal rejected" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update withdrawal", description: error?.message || "Please try again.", variant: "destructive" });
    },
  });

  const withdrawals = Array.isArray(data) ? data : [];

  return (
    <div className="container-fluid">
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4">
        <h2 className="fs-22 text-capitalize mb-0" data-testid="page-title">Withdrawal Requests</h2>
        <div className="d-flex align-items-center gap-2">
          <span className="text-muted">Total:</span>
          <span className="text-primary fs-16 fw-bold" data-testid="total-count">{withdrawals.length}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover">
              <thead className="table-light align-middle text-capitalize">
                <tr>
                  <th>SL</th>
                  <th>Driver</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Account</th>
                  <th>Status</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <tr key={i}>{Array(7).fill(0).map((_, j) => <td key={j}><div style={{ height: "14px", background: "#f1f5f9", borderRadius: "4px" }} /></td>)}</tr>
                  ))
                ) : withdrawals.length ? (
                  withdrawals.map((item: any, idx: number) => (
                    <tr key={item.withdrawal.id} data-testid={`withdrawal-row-${item.withdrawal.id}`}>
                      <td>{idx + 1}</td>
                      <td>
                        <div className="media align-items-center gap-2">
                          <div className="rounded-circle d-flex align-items-center justify-content-center bg-light" style={{ width: "32px", height: "32px" }}>
                            <i className="bi bi-person-badge-fill text-muted"></i>
                          </div>
                          <div className="media-body">{item.driver?.fullName || "—"}</div>
                        </div>
                      </td>
                      <td className="fw-bold text-primary">₹{Number(item.withdrawal.amount).toFixed(2)}</td>
                      <td className="text-capitalize text-muted">{item.withdrawal.method || "—"}</td>
                      <td className="fs-12 text-muted">{item.withdrawal.accountNumber || "—"}</td>
                      <td>
                        <span className={statusBadge[item.withdrawal.status] || "badge bg-secondary"}>
                          {item.withdrawal.status}
                        </span>
                      </td>
                      <td className="text-center">
                        {item.withdrawal.status === "pending" && (
                          canApprove ? (
                            <div className="d-flex justify-content-center gap-2">
                              <button
                                className="btn btn-sm btn-success"
                                disabled={update.isPending}
                                onClick={() => update.mutate({ id: item.withdrawal.id, action: "approve" })}
                                data-testid={`btn-approve-${item.withdrawal.id}`}
                              >
                                <i className="bi bi-check-lg"></i> Approve
                              </button>
                              <button
                                className="btn btn-sm btn-outline-danger"
                                disabled={update.isPending}
                                onClick={() => update.mutate({ id: item.withdrawal.id, action: "reject" })}
                                data-testid={`btn-reject-${item.withdrawal.id}`}
                              >
                                <i className="bi bi-x-lg"></i> Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-muted" style={{ fontSize: 11 }}>Awaiting approval</span>
                          )
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={7}>
                    <div className="d-flex flex-column justify-content-center align-items-center gap-2 py-4">
                      <i className="bi bi-cash-coin" style={{ fontSize: "2rem", color: "#94a3b8" }}></i>
                      <p className="text-muted mb-0">No withdrawal requests found</p>
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
