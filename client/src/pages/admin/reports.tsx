import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/queryClient";
import { lazy, Suspense, useRef, useState } from "react";

const EarningsTrendChart = lazy(() => import("./reports-charts").then((m) => ({ default: m.EarningsTrendChart })));
const RevenueCompositionChart = lazy(() => import("./reports-charts").then((m) => ({ default: m.RevenueCompositionChart })));
const TripStatusChart = lazy(() => import("./reports-charts").then((m) => ({ default: m.TripStatusChart })));
const PaymentDistributionChart = lazy(() => import("./reports-charts").then((m) => ({ default: m.PaymentDistributionChart })));

const fmtCur = (v: any) => `₹${parseFloat(v || 0).toFixed(2)}`;
const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function csvCell(value: any) {
  if (value == null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv(data: any[], filename: string) {
  const rows = Array.isArray(data) ? data : [];
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))));
  const csvRows = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row?.[header])).join(",")),
  ];
  const blob = new Blob([`\uFEFF${csvRows.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function ChartFallback() {
  return <div className="h-100 d-flex align-items-center justify-content-center text-muted">Loading chart...</div>;
}

function printPDF(ref: React.RefObject<HTMLDivElement>, title: string) {
  const style = document.createElement("style");
  style.innerHTML = `@media print { body * { visibility: hidden !important; } .print-area, .print-area * { visibility: visible !important; } .print-area { position: fixed !important; top:0; left:0; width:100%; } .no-print { display: none !important; } }`;
  document.head.appendChild(style);
  const el = ref.current;
  if (el) el.classList.add("print-area");
  document.title = title;
  window.print();
  if (el) el.classList.remove("print-area");
  document.head.removeChild(style);
}

function SummaryCard({ label, value, icon, color, bg }: any) {
  return (
    <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
      <div className="card-body d-flex align-items-center gap-3 py-3">
        <div className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
          style={{ width: 44, height: 44, background: bg, color, fontSize: "1.1rem" }}>
          <i className={`bi ${icon}`}></i>
        </div>
        <div>
          <div className="fw-bold" style={{ fontSize: 18, color }}>{value}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>{label}</div>
        </div>
      </div>
    </div>
  );
}

function DateFilter({ from, to, onChange }: any) {
  return (
    <div className="d-flex gap-2 align-items-center flex-wrap no-print">
      <div className="d-flex align-items-center gap-2 px-3 py-2" style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10 }}>
        <i className="bi bi-calendar3" style={{ fontSize: 12, color: "#94a3b8" }}></i>
        <input type="date" style={{ border: "none", background: "transparent", fontSize: 13, outline: "none" }}
          value={from} onChange={e => onChange("from", e.target.value)} data-testid="input-from-date" />
      </div>
      <span className="text-muted small">to</span>
      <div className="d-flex align-items-center gap-2 px-3 py-2" style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10 }}>
        <i className="bi bi-calendar3" style={{ fontSize: 12, color: "#94a3b8" }}></i>
        <input type="date" style={{ border: "none", background: "transparent", fontSize: 13, outline: "none" }}
          value={to} onChange={e => onChange("to", e.target.value)} data-testid="input-to-date" />
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const today = new Date().toISOString().split("T")[0];
  const thirtyAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const [tab, setTab] = useState("earning");
  const [from, setFrom] = useState(thirtyAgo);
  const [to, setTo] = useState(today);
  const printRef = useRef<HTMLDivElement>(null!);

  const dateChange = (k: string, v: string) => k === "from" ? setFrom(v) : setTo(v);

  const { data: earnings, isLoading: loadEarnings } = useQuery<any>({
    queryKey: ["/api/reports/earnings", from, to],
    queryFn: () => adminFetch(`/api/reports/earnings?from=${from}&to=${to}`).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => (d && !d.message && !d.error) ? d : {}),
    enabled: tab === "earning",
  });

  const { data: trips = [], isLoading: loadTrips } = useQuery<any[]>({
    queryKey: ["/api/reports/trips", from, to],
    queryFn: () => adminFetch(`/api/reports/trips?from=${from}&to=${to}`).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
    enabled: tab === "trip",
  });

  const { data: driversData = [], isLoading: loadDrivers } = useQuery<any[]>({
    queryKey: ["/api/reports/drivers"],
    queryFn: () => adminFetch("/api/reports/drivers").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
    enabled: tab === "driver",
  });

  const { data: customers = [], isLoading: loadCustomers } = useQuery<any[]>({
    queryKey: ["/api/reports/customers"],
    queryFn: () => adminFetch("/api/reports/customers").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
    enabled: tab === "customer",
  });

  const earningRows = earnings?.rows || [];
  const summary = earnings?.summary || {};

  const earningsTrend = earningRows.map((row: any) => ({
    day: fmtDate(row.date),
    revenue: Number(row.revenue || 0),
    admin: Number(row.adminTotal || 0),
  }));

  const earningsBreakdown = [
    { name: "Commission", value: Number(summary.totalCommission || 0), color: "#2F7BFF" },
    { name: "GST", value: Number(summary.totalGst || 0), color: "#f59e0b" },
    { name: "Insurance", value: Number(summary.totalInsurance || 0), color: "#0891b2" },
  ].filter((d) => d.value > 0);

  const tripStatusData = [
    { name: "Completed", value: trips.filter((t: any) => t.currentStatus === "completed").length, color: "#16a34a" },
    { name: "Cancelled", value: trips.filter((t: any) => t.currentStatus === "cancelled").length, color: "#dc2626" },
    { name: "Ongoing", value: trips.filter((t: any) => t.currentStatus === "ongoing").length, color: "#2F7BFF" },
    { name: "Other", value: trips.filter((t: any) => !["completed", "cancelled", "ongoing"].includes(t.currentStatus)).length, color: "#94a3b8" },
  ].filter((d) => d.value > 0);

  const paymentDistribution = Object.entries(
    trips.reduce((acc: Record<string, number>, t: any) => {
      const key = (t.paymentMethod || "unknown").toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  ).map(([name, value], i) => ({
    name: name.toUpperCase(),
    value,
    color: ["#2F7BFF", "#16a34a", "#7c3aed", "#d97706", "#0891b2"][i % 5],
  }));

  const TABS = [
    { id: "earning", label: "Earnings Report", icon: "bi-bar-chart-fill", color: "#1a73e8" },
    { id: "trip", label: "Trips Report", icon: "bi-car-front-fill", color: "#16a34a" },
    { id: "driver", label: "Driver Report", icon: "bi-person-badge-fill", color: "#7c3aed" },
    { id: "customer", label: "Customer Report", icon: "bi-people-fill", color: "#d97706" },
  ];

  return (
    <div className="container-fluid">
      {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-2">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">Reports & Analytics</h4>
          <div className="text-muted small">PDF and CSV export for all reports</div>
        </div>
        <div className="d-flex gap-2 no-print">
          <button className="btn btn-outline-success btn-sm" style={{ borderRadius: 8 }}
            onClick={async () => {
              const exportData = tab === "earning" ? earningRows
                : tab === "trip" ? trips
                : tab === "driver" ? driversData
                : customers;
              exportCsv(exportData, `JAGO_${tab}_report_${from}_${to}`);
            }} data-testid="btn-export-excel">
            <i className="bi bi-filetype-csv me-1"></i>CSV
          </button>
          <button className="btn btn-outline-danger btn-sm" style={{ borderRadius: 8 }}
            onClick={() => printPDF(printRef, `JAGO ${tab} Report`)}
            data-testid="btn-export-pdf">
            <i className="bi bi-file-earmark-pdf-fill me-1"></i>PDF
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="row g-2 mb-4 no-print">
        {TABS.map(t => (
          <div key={t.id} className="col-6 col-md-3">
            <button onClick={() => setTab(t.id)} className="w-100 text-start border-0"
              style={{
                borderRadius: 12, padding: "12px 14px", cursor: "pointer",
                background: tab === t.id ? t.color : "#fff",
                color: tab === t.id ? "#fff" : "#475569",
                boxShadow: tab === t.id ? `0 4px 14px ${t.color}44` : "0 1px 4px rgba(0,0,0,0.07)",
                border: `1.5px solid ${tab === t.id ? t.color : "#e2e8f0"}`,
                transition: "all .15s",
              }} data-testid={`tab-report-${t.id}`}>
              <i className={`bi ${t.icon} me-2`} style={{ fontSize: 14 }}></i>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{t.label}</span>
            </button>
          </div>
        ))}
      </div>

      {/* EARNINGS */}
      {tab === "earning" && (
        <div ref={printRef}>
          <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
            <h5 className="fw-bold mb-0">Earnings Report</h5>
            <DateFilter from={from} to={to} onChange={dateChange} />
          </div>

          {/* Summary cards */}
          <div className="row g-3 mb-4">
            {[
              { label: "Total Revenue", value: fmtCur(summary.totalRevenue), icon: "bi-cash-stack", color: "#1a73e8", bg: "#e8f0fe" },
              { label: "Platform Commission", value: fmtCur(summary.totalCommission), icon: "bi-currency-rupee", color: "#7c3aed", bg: "#f5f3ff" },
              { label: "GST Collected", value: fmtCur(summary.totalGst), icon: "bi-receipt", color: "#d97706", bg: "#fef9c3" },
              { label: "Insurance Collected", value: fmtCur(summary.totalInsurance), icon: "bi-shield-check-fill", color: "#0891b2", bg: "#e0f2fe" },
              { label: "Admin Total Earning", value: fmtCur(summary.totalAdminEarning), icon: "bi-bank", color: "#16a34a", bg: "#f0fdf4" },
              { label: "Total Trips", value: summary.totalTrips || 0, icon: "bi-car-front-fill", color: "#dc2626", bg: "#fee2e2" },
            ].map((c, i) => (
              <div key={i} className="col-6 col-xl-4">
                <SummaryCard {...c} />
              </div>
            ))}
          </div>

          {/* Commission breakdown info box */}
          <div className="d-flex gap-2 mb-3 p-3 rounded-3" style={{ background: "#f0fdf4", border: "1px solid #86efac" }}>
            <i className="bi bi-info-circle-fill text-success mt-1" style={{ fontSize: 13, flexShrink: 0 }}></i>
            <div style={{ fontSize: 12, color: "#166534" }}>
              <strong>Admin Earning Formula:</strong> Platform Commission + GST (18% of commission) + Insurance (₹5/ride) = Total Admin Earning per ride.
              Driver receives: Fare − Platform Commission.
            </div>
          </div>

          <div className="row g-3 mb-4">
            <div className="col-xl-8">
              <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
                <div className="card-header bg-white py-3 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <h6 className="mb-0 fw-bold" style={{ color: "#0f172a" }}>Earnings Trend</h6>
                  <div className="text-muted small">Revenue vs admin earnings for selected period</div>
                </div>
                <div className="card-body" style={{ height: 280 }}>
                  <Suspense fallback={<ChartFallback />}>
                    <EarningsTrendChart data={earningsTrend} />
                  </Suspense>
                </div>
              </div>
            </div>
            <div className="col-xl-4">
              <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
                <div className="card-header bg-white py-3 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <h6 className="mb-0 fw-bold" style={{ color: "#0f172a" }}>Revenue Composition</h6>
                  <div className="text-muted small">Commission, GST and insurance</div>
                </div>
                <div className="card-body" style={{ height: 280 }}>
                  <Suspense fallback={<ChartFallback />}>
                    <RevenueCompositionChart data={earningsBreakdown} />
                  </Suspense>
                </div>
              </div>
            </div>
          </div>

          <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-borderless align-middle table-hover mb-0">
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      {["Date", "Trips", "Completed", "Revenue", "Commission", "GST (18%)", "Insurance", "Admin Total", "Driver Earning"].map(h => (
                        <th key={h} style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", padding: "12px 12px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loadEarnings ? Array(5).fill(0).map((_, i) => (
                      <tr key={i}>{Array(9).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                    )) : earningRows.length === 0 ? (
                      <tr><td colSpan={9} className="text-center py-5 text-muted">
                        <i className="bi bi-bar-chart-line-fill fs-1 d-block mb-2" style={{ opacity: 0.2 }}></i>
                        No earnings data for selected date range
                      </td></tr>
                    ) : earningRows.map((row: any, i: number) => (
                      <tr key={i}>
                        <td style={{ fontSize: 12, fontWeight: 600 }}>{fmtDate(row.date)}</td>
                        <td style={{ fontSize: 12 }}>{row.trips}</td>
                        <td><span className="badge bg-success">{row.completed}</span></td>
                        <td style={{ fontSize: 13, fontWeight: 700, color: "#16a34a" }}>{fmtCur(row.revenue)}</td>
                        <td style={{ fontSize: 12, color: "#7c3aed" }}>{fmtCur(row.commission)}</td>
                        <td style={{ fontSize: 12, color: "#d97706" }}>{fmtCur(row.gst)}</td>
                        <td style={{ fontSize: 12, color: "#0891b2" }}>{fmtCur(row.insurance)}</td>
                        <td style={{ fontSize: 13, fontWeight: 700, color: "#1a73e8" }}>{fmtCur(row.adminTotal)}</td>
                        <td style={{ fontSize: 12, color: "#64748b" }}>{fmtCur(row.driverEarning)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {earningRows.length > 0 && (
                    <tfoot style={{ background: "#f8fafc" }}>
                      <tr>
                        <td colSpan={3} style={{ fontSize: 12, fontWeight: 700, color: "#475569", padding: "10px 12px" }}>TOTAL</td>
                        <td style={{ fontSize: 13, fontWeight: 800, color: "#16a34a" }}>{fmtCur(summary.totalRevenue)}</td>
                        <td style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>{fmtCur(summary.totalCommission)}</td>
                        <td style={{ fontSize: 12, fontWeight: 700, color: "#d97706" }}>{fmtCur(summary.totalGst)}</td>
                        <td style={{ fontSize: 12, fontWeight: 700, color: "#0891b2" }}>{fmtCur(summary.totalInsurance)}</td>
                        <td style={{ fontSize: 13, fontWeight: 800, color: "#1a73e8" }}>{fmtCur(summary.totalAdminEarning)}</td>
                        <td style={{ fontSize: 12, fontWeight: 700 }}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TRIPS */}
      {tab === "trip" && (
        <div ref={printRef}>
          <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
            <h5 className="fw-bold mb-0">Trips Report</h5>
            <DateFilter from={from} to={to} onChange={dateChange} />
          </div>
          <div className="row g-3 mb-4">
            {[
              { label: "Total Trips", value: trips.length, icon: "bi-car-front-fill", color: "#1a73e8", bg: "#e8f0fe" },
              { label: "Completed", value: trips.filter((t: any) => t.currentStatus === "completed").length, icon: "bi-check-circle-fill", color: "#16a34a", bg: "#f0fdf4" },
              { label: "Cancelled", value: trips.filter((t: any) => t.currentStatus === "cancelled").length, icon: "bi-x-circle-fill", color: "#dc2626", bg: "#fee2e2" },
              { label: "Revenue", value: fmtCur(trips.filter((t: any) => t.currentStatus === "completed").reduce((s: any, t: any) => s + parseFloat(t.actualFare || 0), 0)), icon: "bi-currency-rupee", color: "#7c3aed", bg: "#f5f3ff" },
            ].map((c, i) => <div key={i} className="col-6 col-md-3"><SummaryCard {...c} /></div>)}
          </div>
          <div className="row g-3 mb-4">
            <div className="col-xl-6">
              <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
                <div className="card-header bg-white py-3 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <h6 className="mb-0 fw-bold" style={{ color: "#0f172a" }}>Trip Status Split</h6>
                </div>
                <div className="card-body" style={{ height: 250 }}>
                  <Suspense fallback={<ChartFallback />}>
                    <TripStatusChart data={tripStatusData} />
                  </Suspense>
                </div>
              </div>
            </div>
            <div className="col-xl-6">
              <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
                <div className="card-header bg-white py-3 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <h6 className="mb-0 fw-bold" style={{ color: "#0f172a" }}>Payment Method Distribution</h6>
                </div>
                <div className="card-body" style={{ height: 250 }}>
                  <Suspense fallback={<ChartFallback />}>
                    <PaymentDistributionChart data={paymentDistribution} />
                  </Suspense>
                </div>
              </div>
            </div>
          </div>
          <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-borderless align-middle table-hover mb-0">
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      {["Ref ID", "Customer", "Pickup", "Drop", "Vehicle", "Fare", "Status", "Payment", "Date"].map(h => (
                        <th key={h} style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", padding: "12px 10px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loadTrips ? Array(5).fill(0).map((_, i) => (
                      <tr key={i}>{Array(9).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                    )) : trips.length === 0 ? (
                      <tr><td colSpan={9} className="text-center py-5 text-muted">No trips in selected date range</td></tr>
                    ) : trips.map((t: any, i: number) => (
                      <tr key={i}>
                        <td style={{ fontSize: 11, fontFamily: "monospace", color: "#1a73e8" }}>{t.refId}</td>
                        <td style={{ fontSize: 12 }}>{t.customerName || "—"}</td>
                        <td style={{ fontSize: 11, color: "#64748b", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.pickupAddress}</td>
                        <td style={{ fontSize: 11, color: "#64748b", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.destinationAddress}</td>
                        <td style={{ fontSize: 12 }}>{t.vehicleName || "—"}</td>
                        <td style={{ fontSize: 12, fontWeight: 700, color: "#16a34a" }}>{fmtCur(t.actualFare || t.estimatedFare)}</td>
                        <td>
                          <span className="badge" style={{
                            background: t.currentStatus === "completed" ? "#f0fdf4" : t.currentStatus === "cancelled" ? "#fee2e2" : "#e8f0fe",
                            color: t.currentStatus === "completed" ? "#16a34a" : t.currentStatus === "cancelled" ? "#dc2626" : "#1a73e8",
                            fontSize: 10,
                          }}>
                            {t.currentStatus}
                          </span>
                        </td>
                        <td style={{ fontSize: 11, textTransform: "capitalize" }}>{t.paymentMethod}</td>
                        <td style={{ fontSize: 11, color: "#94a3b8" }}>{fmtDate(t.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DRIVERS */}
      {tab === "driver" && (
        <div ref={printRef}>
          <h5 className="fw-bold mb-3">Driver Performance Report</h5>
          <div className="row g-3 mb-4">
            {[
              { label: "Total Drivers", value: driversData.length, icon: "bi-person-badge-fill", color: "#1a73e8", bg: "#e8f0fe" },
              { label: "Active Drivers", value: driversData.filter((d: any) => d.isActive).length, icon: "bi-check-circle-fill", color: "#16a34a", bg: "#f0fdf4" },
              { label: "Verified", value: driversData.filter((d: any) => d.verificationStatus === "approved").length, icon: "bi-patch-check-fill", color: "#7c3aed", bg: "#f5f3ff" },
              { label: "Total Revenue", value: fmtCur(driversData.reduce((s: any, d: any) => s + parseFloat(d.totalEarnings || 0), 0)), icon: "bi-currency-rupee", color: "#d97706", bg: "#fef9c3" },
            ].map((c, i) => <div key={i} className="col-6 col-md-3"><SummaryCard {...c} /></div>)}
          </div>
          <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-borderless align-middle table-hover mb-0">
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      {["#", "Driver", "Phone", "Vehicle", "Total Trips", "Total Earnings", "Status", "Verified", "Joined"].map(h => (
                        <th key={h} style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", padding: "12px 10px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loadDrivers ? Array(5).fill(0).map((_, i) => (
                      <tr key={i}>{Array(9).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                    )) : driversData.map((d: any, i: number) => (
                      <tr key={i}>
                        <td style={{ fontSize: 12, color: "#94a3b8" }}>{i + 1}</td>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{d.fullName}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>{d.email}</div>
                        </td>
                        <td style={{ fontSize: 12 }}>{d.phone}</td>
                        <td style={{ fontSize: 12 }}>{d.vehicleCategory || "—"}<br /><span style={{ fontSize: 10, color: "#94a3b8" }}>{d.vehicleNumber}</span></td>
                        <td style={{ fontSize: 13, fontWeight: 700, color: "#1a73e8" }}>{d.totalTrips}</td>
                        <td style={{ fontSize: 13, fontWeight: 700, color: "#16a34a" }}>{fmtCur(d.totalEarnings)}</td>
                        <td><span className="badge" style={{ background: d.isActive ? "#f0fdf4" : "#f8fafc", color: d.isActive ? "#16a34a" : "#64748b", fontSize: 10 }}>{d.isActive ? "Active" : "Inactive"}</span></td>
                        <td><span className="badge" style={{ background: d.verificationStatus === "approved" ? "#f0fdf4" : "#fee2e2", color: d.verificationStatus === "approved" ? "#16a34a" : "#dc2626", fontSize: 10 }}>{d.verificationStatus || "pending"}</span></td>
                        <td style={{ fontSize: 11, color: "#94a3b8" }}>{fmtDate(d.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOMERS */}
      {tab === "customer" && (
        <div ref={printRef}>
          <h5 className="fw-bold mb-3">Customer Report</h5>
          <div className="row g-3 mb-4">
            {[
              { label: "Total Customers", value: customers.length, icon: "bi-people-fill", color: "#1a73e8", bg: "#e8f0fe" },
              { label: "Active", value: customers.filter((c: any) => c.isActive).length, icon: "bi-check-circle-fill", color: "#16a34a", bg: "#f0fdf4" },
              { label: "Total Trips", value: customers.reduce((s: any, c: any) => s + parseInt(c.totalTrips || 0), 0), icon: "bi-car-front-fill", color: "#7c3aed", bg: "#f5f3ff" },
              { label: "Total Revenue", value: fmtCur(customers.reduce((s: any, c: any) => s + parseFloat(c.totalSpent || 0), 0)), icon: "bi-currency-rupee", color: "#d97706", bg: "#fef9c3" },
            ].map((c, i) => <div key={i} className="col-6 col-md-3"><SummaryCard {...c} /></div>)}
          </div>
          <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-borderless align-middle table-hover mb-0">
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      {["#", "Customer", "Phone", "Total Trips", "Total Spent", "Status", "Joined"].map(h => (
                        <th key={h} style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", padding: "12px 10px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loadCustomers ? Array(5).fill(0).map((_, i) => (
                      <tr key={i}>{Array(7).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                    )) : customers.map((c: any, i: number) => (
                      <tr key={i}>
                        <td style={{ fontSize: 12, color: "#94a3b8" }}>{i + 1}</td>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.fullName}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>{c.email}</div>
                        </td>
                        <td style={{ fontSize: 12 }}>{c.phone}</td>
                        <td style={{ fontSize: 13, fontWeight: 700, color: "#1a73e8" }}>{c.totalTrips}</td>
                        <td style={{ fontSize: 13, fontWeight: 700, color: "#16a34a" }}>{fmtCur(c.totalSpent)}</td>
                        <td><span className="badge" style={{ background: c.isActive ? "#f0fdf4" : "#f8fafc", color: c.isActive ? "#16a34a" : "#64748b", fontSize: 10 }}>{c.isActive ? "Active" : "Inactive"}</span></td>
                        <td style={{ fontSize: 11, color: "#94a3b8" }}>{fmtDate(c.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
