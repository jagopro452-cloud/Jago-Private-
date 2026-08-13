import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";

const fmtDuration = (s: number) => s > 0 ? `${Math.floor(s / 60)}m ${s % 60}s` : "—";
const fmtDate = (ms: number) => new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function CallLogsPage() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/call-logs", filter],
    queryFn: () => apiRequest("GET", `/api/call-logs?status=${filter}`).then(r => r.json()).then(d => Array.isArray(d) ? d : (d?.data ? d.data : [])),
  });

  const allLogs: any[] = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
  const logs = search ? allLogs.filter((l: any) =>
    (l.from || "").toLowerCase().includes(search.toLowerCase()) ||
    (l.to || "").toLowerCase().includes(search.toLowerCase()) ||
    (l.fromPhone || "").includes(search) || (l.toPhone || "").includes(search)
  ) : allLogs;

  const answeredCount = allLogs.filter((l: any) => l.status === "answered").length;
  const missedCount = allLogs.filter((l: any) => l.status === "missed").length;
  const totalDuration = allLogs.filter((l: any) => l.status === "answered").reduce((s: number, l: any) => s + (l.duration || 0), 0);
  const avgDuration = answeredCount > 0 ? Math.round(totalDuration / answeredCount) : 0;

  const callTypeLabel = (t: string) => ({
    customer_to_driver: "Customer → Driver",
    driver_to_customer: "Driver → Customer",
    support: "Support",
  }[t] || t);

  return (
    <div className="container-fluid">
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4">
        <div>
          <h2 className="fs-22 text-capitalize mb-1">Call Logs</h2>
          <p className="text-muted small mb-0">Trip-related calls between customers, drivers and support</p>
        </div>
      </div>

      {/* Stats */}
      <div className="row g-3 mb-4">
        {[
          { label: "Total Calls", val: allLogs.length, icon: "bi-telephone-fill", color: "#1a73e8", bg: "#e8f0fe" },
          { label: "Answered", val: answeredCount, icon: "bi-telephone-inbound-fill", color: "#16a34a", bg: "#f0fdf4" },
          { label: "Missed", val: missedCount, icon: "bi-telephone-x-fill", color: "#dc2626", bg: "#fef2f2" },
          { label: "Avg Duration", val: `${Math.floor(avgDuration / 60)}m ${avgDuration % 60}s`, icon: "bi-clock-fill", color: "#d97706", bg: "#fefce8" },
        ].map((s, i) => (
          <div key={i} className="col-6 col-md-3">
            <div className="card border-0 shadow-sm" style={{ borderRadius: 12 }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: 44, height: 44, background: s.bg }}>
                  <i className={`bi ${s.icon}`} style={{ color: s.color, fontSize: "1.1rem" }}></i>
                </div>
                <div>
                  <div className="fw-bold fs-5" style={{ color: s.color }}>{s.val}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{s.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card border-0 shadow-sm" style={{ borderRadius: 12 }}>
        <div className="card-header bg-white border-bottom py-3 d-flex flex-wrap gap-2 align-items-center">
          <div className="btn-group btn-group-sm">
            {["all", "answered", "missed"].map(t => (
              <button key={t} className={`btn ${filter === t ? "btn-primary" : "btn-outline-secondary"} text-capitalize`}
                onClick={() => setFilter(t)} data-testid={`tab-call-${t}`}>{t}</button>
            ))}
          </div>
          <div className="input-group input-group-sm ms-auto" style={{ maxWidth: 260 }}>
            <span className="input-group-text bg-light border-0"><i className="bi bi-search text-muted"></i></span>
            <input className="form-control border-0 bg-light" placeholder="Search name or phone..." value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover mb-0" style={{ fontSize: "0.82rem" }}>
              <thead className="table-light">
                <tr>
                  <th>#</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Type</th>
                  <th>Duration</th>
                  <th>Date & Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <tr key={i}>{Array(7).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                  ))
                ) : logs.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-5 text-muted">
                    <i className="bi bi-telephone-fill fs-2 d-block mb-2 opacity-25"></i>
                    No call logs found
                  </td></tr>
                ) : logs.map((l: any, idx: number) => (
                  <tr key={l.id || idx} data-testid={`call-row-${idx}`}>
                    <td className="text-muted">{idx + 1}</td>
                    <td>
                      <div className="fw-semibold">{l.from || "—"}</div>
                      <small className="text-muted">{l.fromPhone || ""}</small>
                    </td>
                    <td>
                      <div className="fw-semibold">{l.to || "—"}</div>
                      <small className="text-muted">{l.toPhone || ""}</small>
                    </td>
                    <td>
                      <span className="badge bg-light text-dark border" style={{ fontSize: "0.7rem" }}>
                        {callTypeLabel(l.callType || "")}
                      </span>
                    </td>
                    <td className={l.status === "answered" ? "text-success fw-semibold" : "text-muted"}>
                      {fmtDuration(l.duration || 0)}
                    </td>
                    <td className="text-muted">{l.createdAt ? fmtDate(l.createdAt) : "—"}</td>
                    <td>
                      <span className={`badge ${l.status === "answered" ? "bg-success" : "bg-danger"}`}>
                        {l.status === "answered" ? <><i className="bi bi-telephone-fill me-1"></i>Answered</> : <><i className="bi bi-telephone-x-fill me-1"></i>Missed</>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
