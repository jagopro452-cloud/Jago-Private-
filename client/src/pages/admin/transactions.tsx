import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/queryClient";

export default function Transactions() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/transactions", { page }],
    queryFn: () => adminFetch(`/api/transactions?page=${page}&limit=15`).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => d?.data ? d : { data: Array.isArray(d) ? d : [], total: 0 }),
  });

  const totalPages = Math.ceil((data?.total || 0) / 15);

  return (
    <div className="container-fluid">
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4">
        <h2 className="fs-22 text-capitalize mb-0" data-testid="page-title">Transaction History</h2>
        <div className="d-flex align-items-center gap-2">
          <span className="text-muted text-capitalize">Total Records:</span>
          <span className="text-primary fs-16 fw-bold" data-testid="total-count">{data?.total || 0}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover">
              <thead className="table-light align-middle text-capitalize">
                <tr>
                  <th>SL</th>
                  <th className="text-center">Transaction ID</th>
                  <th className="text-center">Date</th>
                  <th className="text-center">User</th>
                  <th className="text-center">Credit</th>
                  <th className="text-center">Debit</th>
                  <th className="text-center">Balance</th>
                  <th className="text-center">Type</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(8).fill(0).map((_, i) => (
                    <tr key={i}>
                      {Array(8).fill(0).map((_, j) => (
                        <td key={j}><div style={{ height: "14px", background: "#f1f5f9", borderRadius: "4px" }} /></td>
                      ))}
                    </tr>
                  ))
                ) : data?.data?.length ? (
                  data.data.map((item: any, idx: number) => (
                    <tr key={item.transaction.id} data-testid={`tx-row-${item.transaction.id}`}>
                      <td>{(page - 1) * 15 + idx + 1}</td>
                      <td className="text-center">
                        <span className="fw-semibold text-primary fs-12">{item.transaction.id}</span>
                      </td>
                      <td className="text-center text-muted fs-12">
                        {new Date(item.transaction.createdAt).toLocaleDateString("en-IN")}
                      </td>
                      <td className="text-center">
                        <div className="fw-medium">{item.user?.fullName || "—"}</div>
                        <small className="text-muted d-block fs-12 text-capitalize">
                          {item.transaction.transactionType?.replace(/_/g, " ") || ""}
                        </small>
                      </td>
                      <td className="text-center fw-semibold text-success">
                        {Number(item.transaction.credit) > 0 ? `₹${Number(item.transaction.credit).toFixed(2)}` : "—"}
                      </td>
                      <td className="text-center fw-semibold text-danger">
                        {Number(item.transaction.debit) > 0 ? `₹${Number(item.transaction.debit).toFixed(2)}` : "—"}
                      </td>
                      <td className="text-center fw-bold">
                        ₹{Number(item.transaction.balance).toFixed(2)}
                      </td>
                      <td className="text-center">
                        <span className="badge bg-secondary text-capitalize">
                          {item.transaction.transactionType?.replace(/_/g, " ") || "N/A"}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8}>
                      <div className="d-flex flex-column justify-content-center align-items-center gap-2 py-4">
                        <i className="bi bi-receipt" style={{ fontSize: "2rem", color: "#94a3b8" }}></i>
                        <p className="text-muted mb-0">No transactions found</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="d-flex flex-wrap align-items-center justify-content-end gap-2 mt-3">
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <i className="bi bi-chevron-left"></i>
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map(p => (
                <button key={p} className={`btn btn-sm ${p === page ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <i className="bi bi-chevron-right"></i>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
