import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/queryClient";

function Stars({ rating }: { rating: number }) {
  return (
    <div className="d-flex gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <i key={i} className={`bi ${i <= rating ? "bi-star-fill" : "bi-star"}`} style={{ fontSize: "0.75rem", color: i <= rating ? "#f59e0b" : "#d1d5db" }}></i>
      ))}
    </div>
  );
}

export default function Reviews() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/reviews", { page }],
    queryFn: () => adminFetch(`/api/reviews?page=${page}&limit=15`).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => d?.data ? d : { data: Array.isArray(d) ? d : [], total: 0 }),
  });

  const totalPages = Math.ceil((data?.total || 0) / 15);
  const reviews = data?.data || [];

  return (
    <div className="container-fluid">
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4">
        <h2 className="fs-22 text-capitalize mb-0" data-testid="page-title">Reviews &amp; Ratings</h2>
        <div className="d-flex align-items-center gap-2">
          <span className="text-muted">Total Reviews:</span>
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
                  <th>Customer</th>
                  <th>Driver</th>
                  <th>Rating</th>
                  <th>Review</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(8).fill(0).map((_, i) => (
                    <tr key={i}>{Array(6).fill(0).map((_, j) => <td key={j}><div style={{ height: "14px", background: "#f1f5f9", borderRadius: "4px" }} /></td>)}</tr>
                  ))
                ) : reviews.length ? (
                  reviews.map((item: any, idx: number) => (
                    <tr key={item.review.id} data-testid={`review-row-${item.review.id}`}>
                      <td>{(page - 1) * 15 + idx + 1}</td>
                      <td>
                        <div className="media align-items-center gap-2">
                          <div className="rounded-circle d-flex align-items-center justify-content-center bg-light" style={{ width: "32px", height: "32px" }}>
                            <i className="bi bi-person-fill text-muted"></i>
                          </div>
                          <div className="media-body">{item.customer?.fullName || "—"}</div>
                        </div>
                      </td>
                      <td>{item.driver?.fullName || "—"}</td>
                      <td>
                        <div className="d-flex flex-column gap-1">
                          <Stars rating={item.review.rating} />
                          <span className="fs-12 text-muted">{item.review.rating}/5</span>
                        </div>
                      </td>
                      <td style={{ maxWidth: "200px" }}>
                        <p className="mb-0 text-muted fs-12" style={{ whiteSpace: "pre-wrap" }}>{item.review.review || "—"}</p>
                      </td>
                      <td className="text-muted fs-12">{new Date(item.review.createdAt).toLocaleDateString("en-IN")}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={6}>
                    <div className="d-flex flex-column justify-content-center align-items-center gap-2 py-4">
                      <i className="bi bi-star" style={{ fontSize: "2rem", color: "#94a3b8" }}></i>
                      <p className="text-muted mb-0">No reviews found</p>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="d-flex flex-wrap align-items-center justify-content-end gap-2 mt-3">
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><i className="bi bi-chevron-left"></i></button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map(p => (
                <button key={p} className={`btn btn-sm ${p === page ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}><i className="bi bi-chevron-right"></i></button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
