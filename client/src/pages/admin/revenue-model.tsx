import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const MODULE_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  ride:       { label: "Ride",       icon: "bi-car-front-fill",      color: "#1a73e8", bg: "#EBF4FF" },
  parcel:     { label: "Parcel",     icon: "bi-box-seam-fill",       color: "#16a34a", bg: "#f0fdf4" },
  carpool:    { label: "Carpool",    icon: "bi-people-fill",         color: "#7c3aed", bg: "#f5f3ff" },
  outstation: { label: "Outstation", icon: "bi-signpost-2-fill",     color: "#d97706", bg: "#fefce8" },
  b2b:        { label: "B2B",        icon: "bi-building-fill",       color: "#0891b2", bg: "#ecfeff" },
};

type ModuleConfig = {
  moduleName: string;
  revenueModel: "commission" | "subscription";
  commissionPercentage: number;
  commissionGstPercentage: number;
  subscriptionRequired: boolean;
  isActive: boolean;
  notes: string;
};

function ModuleRow({ mod, onSaved }: { mod: ModuleConfig; onSaved: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ModuleConfig>(mod);
  const meta = MODULE_META[mod.moduleName] || { label: mod.moduleName, icon: "bi-gear", color: "#64748b", bg: "#f1f5f9" };

  const saveMut = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/admin/module-revenue/${mod.moduleName}`, data),
    onSuccess: () => {
      toast({ title: `${meta.label} revenue config saved` });
      setEditing(false);
      onSaved();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const set = (key: keyof ModuleConfig, val: any) => setForm(f => ({ ...f, [key]: val }));

  const eff = form.commissionPercentage;
  const gst = form.commissionGstPercentage;
  const exFare = 200;
  const commAmt = exFare * (eff / 100);
  const gstAmt = commAmt * (gst / 100);
  const driverGet = exFare - commAmt - gstAmt;

  return (
    <tr style={{ verticalAlign: "middle" }}>
      <td className="ps-3">
        <div className="d-flex align-items-center gap-2">
          <div className="rounded-2 d-flex align-items-center justify-content-center flex-shrink-0"
            style={{ width: 34, height: 34, background: meta.bg, color: meta.color }}>
            <i className={`bi ${meta.icon}`} style={{ fontSize: 15 }}></i>
          </div>
          <div>
            <div className="fw-semibold" style={{ fontSize: 13 }}>{meta.label}</div>
            {form.notes && <div className="text-muted" style={{ fontSize: 11 }}>{form.notes}</div>}
          </div>
        </div>
      </td>
      <td>
        {editing ? (
          <select className="form-select form-select-sm" value={form.revenueModel}
            onChange={e => set("revenueModel", e.target.value as any)} style={{ width: 140 }}>
            <option value="commission">Commission</option>
            <option value="subscription">Subscription</option>
            <option value="free">Free</option>
          </select>
        ) : (
          <span className={`badge rounded-pill ${form.revenueModel === "commission" ? "bg-primary" : form.revenueModel === "subscription" ? "bg-success" : "bg-secondary"}`}
            style={{ fontSize: 11 }}>
            {form.revenueModel.charAt(0).toUpperCase() + form.revenueModel.slice(1)}
          </span>
        )}
      </td>
      <td>
        {editing ? (
          <div className="d-flex align-items-center gap-1">
            <input type="number" className="form-control form-control-sm" value={form.commissionPercentage}
              onChange={e => set("commissionPercentage", parseFloat(e.target.value) || 0)}
              style={{ width: 72 }} min={0} max={100} step={0.5} />
            <span className="text-muted" style={{ fontSize: 13 }}>%</span>
          </div>
        ) : (
          <span className="fw-semibold" style={{ fontSize: 13, color: "#1a73e8" }}>{form.commissionPercentage}%</span>
        )}
      </td>
      <td>
        {editing ? (
          <div className="d-flex align-items-center gap-1">
            <input type="number" className="form-control form-control-sm" value={form.commissionGstPercentage}
              onChange={e => set("commissionGstPercentage", parseFloat(e.target.value) || 0)}
              style={{ width: 72 }} min={0} max={30} step={0.5} />
            <span className="text-muted" style={{ fontSize: 13 }}>%</span>
          </div>
        ) : (
          <span style={{ fontSize: 13 }}>{form.commissionGstPercentage}%</span>
        )}
      </td>
      <td>
        {editing ? (
          <div className="form-check form-switch mb-0">
            <input className="form-check-input" type="checkbox" checked={form.subscriptionRequired}
              onChange={e => set("subscriptionRequired", e.target.checked)} />
          </div>
        ) : (
          <span className={`badge ${form.subscriptionRequired ? "bg-warning text-dark" : "bg-light text-secondary"}`}
            style={{ fontSize: 10 }}>
            {form.subscriptionRequired ? "Required" : "Not Required"}
          </span>
        )}
      </td>
      <td>
        <div className="form-check form-switch mb-0">
          <input className="form-check-input" type="checkbox" checked={form.isActive}
            onChange={e => {
              const v = e.target.checked;
              set("isActive", v);
              if (!editing) saveMut.mutate({ ...form, isActive: v });
            }} />
        </div>
      </td>
      <td>
        <div className="text-muted" style={{ fontSize: 11, lineHeight: 1.4 }}>
          <div>₹{exFare} fare → driver gets <strong style={{ color: "#16a34a" }}>₹{driverGet.toFixed(0)}</strong></div>
          <div>Platform: ₹{commAmt.toFixed(0)} + GST ₹{gstAmt.toFixed(0)}</div>
        </div>
      </td>
      <td className="pe-3">
        {editing ? (
          <div className="d-flex gap-1">
            <button className="btn btn-sm btn-primary px-3" style={{ fontSize: 11 }}
              disabled={saveMut.isPending}
              onClick={() => saveMut.mutate(form)}>
              {saveMut.isPending ? "Saving..." : "Save"}
            </button>
            <button className="btn btn-sm btn-outline-secondary" style={{ fontSize: 11 }}
              onClick={() => { setForm(mod); setEditing(false); }}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11 }}
            onClick={() => setEditing(true)}>
            <i className="bi bi-pencil me-1"></i>Edit
          </button>
        )}
      </td>
    </tr>
  );
}

function RevenueControlCenter() {
  const [days, setDays] = useState(7);
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/revenue/analytics", days],
    queryFn: () => apiRequest("GET", `/api/admin/revenue/analytics?days=${days}`).then(r => r.json()),
  });

  const byType: any[] = data?.byRevenueType || [];
  const byService: any[] = data?.byService || [];
  const gstWallet = data?.gstWallet || { balance: 0, total_collected: 0, total_trips: 0 };
  const outstanding = data?.outstanding || { locked_driver_count: 0, total_outstanding: 0 };
  const totalCollected = byType.reduce((s, t) => s + parseFloat(t.total_revenue || 0), 0);
  const totalGst = byType.reduce((s, t) => s + parseFloat(t.total_gst || 0), 0);
  const totalCommission = byType.reduce((s, t) => s + parseFloat(t.total_commission || 0), 0);
  const totalPlatformFee = byType.reduce((s, t) => s + parseFloat(t.total_platform_fee || 0), 0);

  return (
    <div className="mb-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h5 className="mb-0 fw-bold" style={{ fontSize: 16 }}>Revenue Control Center</h5>
          <p className="mb-0 text-muted" style={{ fontSize: 12 }}>Aggregate platform revenue collected and outstanding driver dues</p>
        </div>
        <select className="form-select form-select-sm" style={{ width: 140 }} value={days} onChange={e => setDays(parseInt(e.target.value))} data-testid="select-revenue-days">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {isLoading ? (
        <div className="text-center py-4"><div className="spinner-border text-primary spinner-border-sm"></div></div>
      ) : (
        <>
          <div className="row g-3 mb-3">
            {[
              { label: "Total Revenue Collected", value: `₹${totalCollected.toFixed(0)}`, icon: "bi-cash-stack", color: "#16a34a", bg: "#f0fdf4" },
              { label: "Commission Collected", value: `₹${totalCommission.toFixed(0)}`, icon: "bi-percent", color: "#1a73e8", bg: "#EBF4FF" },
              { label: "Platform Fee Collected", value: `₹${totalPlatformFee.toFixed(0)}`, icon: "bi-card-checklist", color: "#7c3aed", bg: "#f5f3ff" },
              { label: "GST Collected", value: `₹${totalGst.toFixed(0)}`, icon: "bi-receipt", color: "#d97706", bg: "#fefce8" },
            ].map((s, i) => (
              <div className="col-md-3" key={i} data-testid={`stat-${s.label.replace(/\s+/g, "-").toLowerCase()}`}>
                <div className="card border-0 h-100" style={{ borderRadius: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                  <div className="card-body d-flex align-items-center gap-3 p-3">
                    <div className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                      style={{ width: 44, height: 44, background: s.bg, color: s.color }}>
                      <i className={`bi ${s.icon}`} style={{ fontSize: 18 }}></i>
                    </div>
                    <div>
                      <div className="fw-bold" style={{ fontSize: 20 }}>{s.value}</div>
                      <div className="text-muted" style={{ fontSize: 12 }}>{s.label}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="row g-3 mb-3">
            <div className="col-md-4">
              <div className="card border-0 h-100" style={{ borderRadius: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <div className="card-body p-3">
                  <div className="text-muted" style={{ fontSize: 12 }}>Outstanding Driver Dues</div>
                  <div className="fw-bold" style={{ fontSize: 22, color: "#dc2626" }} data-testid="stat-total-outstanding">
                    ₹{parseFloat(outstanding.total_outstanding || 0).toFixed(0)}
                  </div>
                  <div className="text-muted" style={{ fontSize: 12 }} data-testid="stat-locked-drivers">
                    {outstanding.locked_driver_count} driver(s) currently locked
                  </div>
                </div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="card border-0 h-100" style={{ borderRadius: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <div className="card-body p-3">
                  <div className="text-muted" style={{ fontSize: 12 }}>Company GST Wallet Balance</div>
                  <div className="fw-bold" style={{ fontSize: 22 }}>₹{parseFloat(gstWallet.balance || 0).toFixed(0)}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>₹{parseFloat(gstWallet.total_collected || 0).toFixed(0)} collected lifetime, {gstWallet.total_trips || 0} trips</div>
                </div>
              </div>
            </div>
          </div>

          <div className="card border-0" style={{ borderRadius: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
            <div className="card-body p-0">
              <div className="px-4 py-3" style={{ borderBottom: "1px solid #f1f5f9" }}>
                <h6 className="mb-0 fw-semibold" style={{ fontSize: 13 }}>Revenue by Service</h6>
              </div>
              <div className="table-responsive">
                <table className="table table-borderless table-hover align-middle mb-0">
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th className="ps-3 py-2" style={{ fontSize: 11, color: "#64748b" }}>SERVICE</th>
                      <th style={{ fontSize: 11, color: "#64748b" }}>SETTLEMENTS</th>
                      <th style={{ fontSize: 11, color: "#64748b" }}>COMMISSION</th>
                      <th style={{ fontSize: 11, color: "#64748b" }}>GST</th>
                      <th className="pe-3" style={{ fontSize: 11, color: "#64748b" }}>TOTAL COLLECTED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byService.length === 0 ? (
                      <tr><td colSpan={5} className="text-center text-muted py-4">No settlements in this period</td></tr>
                    ) : byService.map((row: any, i: number) => (
                      <tr key={i}>
                        <td className="ps-3 text-capitalize" style={{ fontSize: 13 }}>{row.service_type || "unknown"}</td>
                        <td style={{ fontSize: 13 }}>{row.total_settlements}</td>
                        <td style={{ fontSize: 13 }}>₹{parseFloat(row.commission_collected || 0).toFixed(0)}</td>
                        <td style={{ fontSize: 13 }}>₹{parseFloat(row.gst_collected || 0).toFixed(0)}</td>
                        <td className="pe-3 fw-semibold" style={{ fontSize: 13 }}>₹{parseFloat(row.total_collected || 0).toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function RevenueModelPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/module-revenue"],
  });

  const modules: ModuleConfig[] = (data?.modules || []).map((m: any) => ({
    moduleName: m.moduleName,
    revenueModel: m.revenueModel || "commission",
    commissionPercentage: parseFloat(m.commissionPercentage) || 15,
    commissionGstPercentage: parseFloat(m.commissionGstPercentage) || 18,
    subscriptionRequired: !!m.subscriptionRequired,
    isActive: m.isActive !== false,
    notes: m.notes || "",
  }));

  const totalCommission = modules.filter(m => m.revenueModel === "commission" && m.isActive);
  const avgComm = totalCommission.length
    ? (totalCommission.reduce((s, m) => s + m.commissionPercentage, 0) / totalCommission.length).toFixed(1)
    : "0";

  return (
    <div className="p-4">
      {/* Header */}
      <div className="d-flex align-items-center gap-3 mb-4">
        <div className="rounded-3 d-flex align-items-center justify-content-center"
          style={{ width: 44, height: 44, background: "#EBF4FF", color: "#1a73e8" }}>
          <i className="bi bi-diagram-3-fill" style={{ fontSize: 20 }}></i>
        </div>
        <div>
          <h4 className="mb-0 fw-bold" style={{ fontSize: 20 }}>Revenue Model</h4>
          <p className="mb-0 text-muted" style={{ fontSize: 13 }}>Configure per-service revenue model — commission or subscription</p>
        </div>
      </div>

      <RevenueControlCenter />

      {/* Stats row */}
      <div className="row g-3 mb-4">
        {[
          { label: "Active Modules", value: modules.filter(m => m.isActive).length, icon: "bi-check-circle-fill", color: "#16a34a", bg: "#f0fdf4" },
          { label: "Commission Modules", value: modules.filter(m => m.revenueModel === "commission").length, icon: "bi-percent", color: "#1a73e8", bg: "#EBF4FF" },
          { label: "Subscription Modules", value: modules.filter(m => m.revenueModel === "subscription").length, icon: "bi-card-checklist", color: "#7c3aed", bg: "#f5f3ff" },
          { label: "Avg Commission Rate", value: `${avgComm}%`, icon: "bi-graph-up-arrow", color: "#d97706", bg: "#fefce8" },
        ].map((s, i) => (
          <div className="col-md-3" key={i}>
            <div className="card border-0 h-100" style={{ borderRadius: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
              <div className="card-body d-flex align-items-center gap-3 p-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: 44, height: 44, background: s.bg, color: s.color }}>
                  <i className={`bi ${s.icon}`} style={{ fontSize: 18 }}></i>
                </div>
                <div>
                  <div className="fw-bold" style={{ fontSize: 22 }}>{s.value}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>{s.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Module config table */}
      <div className="card border-0" style={{ borderRadius: 16, boxShadow: "0 1px 8px rgba(0,0,0,0.07)" }}>
        <div className="card-body p-0">
          <div className="d-flex align-items-center justify-content-between px-4 py-3"
            style={{ borderBottom: "1px solid #f1f5f9" }}>
            <div>
              <h6 className="mb-0 fw-semibold">Service Revenue Configuration</h6>
              <p className="mb-0 text-muted" style={{ fontSize: 12 }}>Each service can have independent commission % or subscription requirement</p>
            </div>
          </div>
          {isLoading ? (
            <div className="text-center py-5">
              <div className="spinner-border text-primary spinner-border-sm"></div>
              <p className="mt-2 text-muted small">Loading...</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-borderless table-hover align-middle mb-0">
                <thead style={{ background: "#f8fafc" }}>
                  <tr>
                    <th className="ps-3 py-3" style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>SERVICE</th>
                    <th style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>REVENUE MODEL</th>
                    <th style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>COMMISSION %</th>
                    <th style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>GST ON COMMISSION</th>
                    <th style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>SUBSCRIPTION REQ.</th>
                    <th style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>ACTIVE</th>
                    <th style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>CALCULATOR (₹200 FARE)</th>
                    <th className="pe-3" style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {modules.length === 0 ? (
                    <tr><td colSpan={8}>
                      <div className="text-center py-5 text-muted">
                        <i className="bi bi-diagram-3 fs-1 d-block mb-2" style={{ opacity: 0.3 }}></i>
                        <p className="mb-0">No modules configured yet</p>
                        <p className="small">Check server logs — default data should seed automatically</p>
                      </div>
                    </td></tr>
                  ) : (
                    modules.map(mod => (
                      <ModuleRow key={mod.moduleName} mod={mod}
                        onSaved={() => qc.invalidateQueries({ queryKey: ["/api/admin/module-revenue"] })} />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Info card */}
      <div className="mt-4 p-3 rounded-3 d-flex gap-3" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
        <i className="bi bi-info-circle-fill text-success mt-1" style={{ fontSize: 16, flexShrink: 0 }}></i>
        <div style={{ fontSize: 13 }}>
          <strong>How it works:</strong> When a driver accepts a trip, the system looks up the revenue config for that service type.
          If <em>commission</em>, the configured % is deducted from the fare and credited to admin.
          If <em>subscription</em>, the driver must have an active subscription plan — otherwise the trip is blocked.
          Changes apply immediately to new trips without any app update.
        </div>
      </div>
    </div>
  );
}
