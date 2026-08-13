import { useQuery } from "@tanstack/react-query";

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function actionBadgeClass(action: string) {
  const a = (action || "").toLowerCase();
  if (a.includes("delete")) return "bg-danger";
  if (a.includes("create") || a.includes("add")) return "bg-success";
  if (a.includes("update") || a.includes("edit") || a.includes("toggle")) return "bg-primary";
  return "bg-secondary";
}

export default function PricingAuditLogsPage() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/admin/pricing-audit-logs"] });
  const logs = Array.isArray(data?.logs) ? data.logs : [];

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <h2 className="h5 mb-0">Pricing Audit Logs</h2>
          <div style={{ fontSize: 12.5, color: "#64748b" }}>Every fare, commission, discount, coupon and surge change made by an admin — most recent first.</div>
        </div>
      </div>

      <div className="container-fluid">
        <div className="card">
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-borderless align-middle table-hover">
                <thead className="table-light">
                  <tr>
                    <th>When</th>
                    <th>Admin</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={5} className="text-center py-4"><div className="spinner-border spinner-border-sm" role="status" /></td></tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-5 text-muted">
                        <i className="bi bi-clock-history fs-2 d-block mb-2 opacity-25"></i>
                        No pricing-related admin actions recorded yet.
                      </td>
                    </tr>
                  ) : logs.map((log: any) => (
                    <tr key={log.id} data-testid={`row-audit-log-${log.id}`}>
                      <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{fmtDate(log.createdAt)}</td>
                      <td style={{ fontSize: 12.5 }}>{log.adminEmail || "—"}</td>
                      <td><span className={`badge ${actionBadgeClass(log.action)}`}>{log.action}</span></td>
                      <td style={{ fontSize: 12.5 }}>{log.entityType}{log.entityId ? ` #${String(log.entityId).slice(0, 8)}` : ""}</td>
                      <td style={{ fontSize: 11.5, color: "#64748b", maxWidth: 320 }} className="text-truncate">
                        {log.details && Object.keys(log.details).length > 0 ? JSON.stringify(log.details) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
