import { useQuery, useMutation } from "@tanstack/react-query";
import { adminFetch, queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

const PLAN_TYPES = [
  { value: "vehicle", label: "Vehicle Insurance", icon: "bi-truck-front-fill", color: "#1a73e8", bg: "#e8f0fe" },
  { value: "health", label: "Driver Health", icon: "bi-heart-pulse-fill", color: "#dc2626", bg: "#fee2e2" },
  { value: "passenger", label: "Passenger Cover", icon: "bi-people-fill", color: "#16a34a", bg: "#f0fdf4" },
];

const typeInfo = (t: string) => PLAN_TYPES.find(p => p.value === t) || PLAN_TYPES[0];

function PlanCard({ plan, onEdit, onDelete, onToggle }: any) {
  const type = typeInfo(plan.planType);
  const features = plan.features ? plan.features.split("\n").filter(Boolean) : [];
  return (
    <div className="col-12 col-md-6 col-xl-4" data-testid={`card-insurance-${plan.id}`}>
      <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 16, overflow: "hidden" }}>
        <div style={{ height: 5, background: plan.isActive ? `linear-gradient(90deg,${type.color},${type.color}88)` : "#e2e8f0" }} />
        <div className="card-body d-flex flex-column" style={{ padding: "1.25rem" }}>
          <div className="d-flex align-items-start justify-content-between mb-3">
            <div className="d-flex align-items-center gap-2">
              <div className="rounded-3 d-flex align-items-center justify-content-center"
                style={{ width: 40, height: 40, background: type.bg, color: type.color, fontSize: 16 }}>
                <i className={`bi ${type.icon}`}></i>
              </div>
              <div>
                <div className="fw-bold" style={{ fontSize: 14, color: "#0f172a" }}>{plan.name}</div>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: type.bg, color: type.color, fontWeight: 700 }}>{type.label}</span>
              </div>
            </div>
            <label className="switcher mb-0">
              <input type="checkbox" className="switcher_input" checked={!!plan.isActive}
                onChange={e => onToggle(plan.id, e.target.checked)} data-testid={`toggle-ins-${plan.id}`} />
              <span className="switcher_control"></span>
            </label>
          </div>

          <div className="row g-2 mb-3">
            <div className="col-6">
              <div style={{ background: "#f8fafc", borderRadius: 10, padding: "8px 12px" }}>
                <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>Daily Premium</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: type.color }}>₹{plan.premiumDaily}</div>
              </div>
            </div>
            <div className="col-6">
              <div style={{ background: "#f8fafc", borderRadius: 10, padding: "8px 12px" }}>
                <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>Monthly</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: type.color }}>₹{plan.premiumMonthly}</div>
              </div>
            </div>
          </div>

          <div style={{ padding: "8px 12px", background: type.bg + "55", borderRadius: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>Coverage Amount</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: type.color }}>₹{Number(plan.coverageAmount).toLocaleString("en-IN")}</div>
          </div>

          {features.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, flex: 1 }}>
              {features.slice(0, 4).map((f: string, i: number) => (
                <li key={i} style={{ fontSize: 12, color: "#475569", padding: "2px 0", display: "flex", alignItems: "center", gap: 6 }}>
                  <i className="bi bi-check-circle-fill" style={{ color: type.color, fontSize: 10 }}></i>{f}
                </li>
              ))}
            </ul>
          )}

          <div className="d-flex gap-2 mt-3 pt-3" style={{ borderTop: "1px solid #f1f5f9" }}>
            <button className="btn btn-sm btn-outline-primary flex-1" onClick={() => onEdit(plan)}
              data-testid={`btn-edit-ins-${plan.id}`}>
              <i className="bi bi-pencil-fill me-1"></i>Edit
            </button>
            <button className="btn btn-sm btn-outline-danger" onClick={() => onDelete(plan.id)}
              data-testid={`btn-del-ins-${plan.id}`}>
              <i className="bi bi-trash-fill"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InsurancePage() {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [activationsTab, setActivationsTab] = useState(false);
  const [form, setForm] = useState({
    name: "", planType: "vehicle", premiumDaily: "", premiumMonthly: "",
    coverageAmount: "", features: "", isActive: true,
  });

  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/insurance-plans"],
    queryFn: () => adminFetch("/api/insurance-plans").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
  });

  const { data: activations = [] } = useQuery<any[]>({
    queryKey: ["/api/driver-insurance"],
    queryFn: () => adminFetch("/api/driver-insurance").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
    enabled: activationsTab,
  });

  const { data: drivers = [] } = useQuery<any[]>({
    queryKey: ["/api/users?type=driver"],
    queryFn: () => adminFetch("/api/users?type=driver&limit=200").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d.data) ? d.data : (Array.isArray(d) ? d : [])),
  });

  const plans = Array.isArray(data) ? data : [];
  const activePlans = plans.filter(p => p.isActive);

  const save = useMutation({
    mutationFn: (d: any) => editing
      ? apiRequest("PUT", `/api/insurance-plans/${editing.id}`, d)
      : apiRequest("POST", "/api/insurance-plans", d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insurance-plans"] });
      setShowModal(false); setEditing(null);
      toast({ title: editing ? "Plan updated" : "Plan created" });
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: any) => apiRequest("PATCH", `/api/insurance-plans/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/insurance-plans"] }),
    onError: (e: any) => { queryClient.invalidateQueries({ queryKey: ["/api/insurance-plans"] }); toast({ title: "Toggle failed", description: e.message, variant: "destructive" }); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/insurance-plans/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/insurance-plans"] }); toast({ title: "Insurance plan deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const f = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const openAdd = () => { setEditing(null); setForm({ name: "", planType: "vehicle", premiumDaily: "", premiumMonthly: "", coverageAmount: "", features: "", isActive: true }); setShowModal(true); };
  const openEdit = (p: any) => { setEditing(p); setForm({ name: p.name, planType: p.planType, premiumDaily: p.premiumDaily, premiumMonthly: p.premiumMonthly, coverageAmount: p.coverageAmount, features: p.features || "", isActive: p.isActive }); setShowModal(true); };

  const curType = typeInfo(form.planType);

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0">Insurance Management</h4>
          <div className="text-muted small">Manage driver insurance plans and activations</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd} data-testid="btn-add-insurance">
          <i className="bi bi-shield-plus-fill me-1"></i>Add Insurance Plan
        </button>
      </div>

      {/* Summary */}
      <div className="row g-3 mb-4">
        {[
          { label: "Total Plans", value: plans.length, icon: "bi-shield-fill", color: "#1a73e8", bg: "#e8f0fe" },
          { label: "Active Plans", value: activePlans.length, icon: "bi-shield-check-fill", color: "#16a34a", bg: "#f0fdf4" },
          { label: "Vehicle Cover", value: plans.filter(p => p.planType === "vehicle").length, icon: "bi-truck-front-fill", color: "#7c3aed", bg: "#f5f3ff" },
          { label: "Health Cover", value: plans.filter(p => p.planType === "health").length, icon: "bi-heart-pulse-fill", color: "#dc2626", bg: "#fee2e2" },
        ].map((s, i) => (
          <div key={i} className="col-6 col-xl-3">
            <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center"
                  style={{ width: 40, height: 40, background: s.bg, color: s.color, fontSize: "1rem" }}>
                  <i className={`bi ${s.icon}`}></i>
                </div>
                <div>
                  <div className="fw-bold" style={{ fontSize: 20, color: s.color }}>{s.value}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{s.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tab: Plans / Activations */}
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <ul className="nav nav--tabs p-1 rounded bg-light">
            <li className="nav-item">
              <button className={`nav-link${!activationsTab ? " active" : ""}`} onClick={() => setActivationsTab(false)}
                data-testid="tab-plans">
                <i className="bi bi-shield-fill me-1"></i>Insurance Plans
              </button>
            </li>
            <li className="nav-item">
              <button className={`nav-link${activationsTab ? " active" : ""}`} onClick={() => setActivationsTab(true)}
                data-testid="tab-activations">
                <i className="bi bi-person-check-fill me-1"></i>Driver Activations
              </button>
            </li>
          </ul>
        </div>

        <div className="card-body p-3 p-lg-4">
          {!activationsTab ? (
            isLoading ? (
              <div className="row g-3">
                {Array(3).fill(0).map((_, i) => (
                  <div key={i} className="col-12 col-md-6 col-xl-4">
                    <div className="card border-0" style={{ borderRadius: 16, height: 280, background: "#f8fafc" }} />
                  </div>
                ))}
              </div>
            ) : plans.length === 0 ? (
              <div className="text-center py-5 text-muted">
                <i className="bi bi-shield-x fs-1 d-block mb-2" style={{ opacity: 0.25 }}></i>
                <p className="fw-semibold mb-2">No insurance plans yet</p>
                <button className="btn btn-sm btn-outline-primary" onClick={openAdd}>
                  <i className="bi bi-plus me-1"></i>Create First Plan
                </button>
              </div>
            ) : (
              <div className="row g-3">
                {plans.map(plan => (
                  <PlanCard key={plan.id} plan={plan}
                    onEdit={openEdit}
                    onDelete={async (id: string) => { if (await adminConfirm("Delete insurance plan?")) remove.mutate(id); }}
                    onToggle={(id: string, isActive: boolean) => toggle.mutate({ id, isActive })} />
                ))}
              </div>
            )
          ) : (
            <div>
              <div className="table-responsive">
                <table className="table table-borderless align-middle table-hover mb-0">
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      {["Driver", "Plan", "Coverage", "Valid From", "Valid To", "Paid", "Status"].map(h => (
                        <th key={h} style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", padding: "12px 12px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.isArray(activations) && activations.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-5 text-muted">
                        <i className="bi bi-person-x-fill fs-1 d-block mb-2" style={{ opacity: 0.2 }}></i>
                        No driver insurance activations yet
                      </td></tr>
                    ) : Array.isArray(activations) && activations.map((a: any, i: number) => (
                      <tr key={i}>
                        <td style={{ fontSize: 13, fontWeight: 600 }}>{a.driverName}</td>
                        <td style={{ fontSize: 12 }}>{a.planName}</td>
                        <td style={{ fontSize: 12, color: "#16a34a", fontWeight: 700 }}>₹{Number(a.coverageAmount || 0).toLocaleString("en-IN")}</td>
                        <td style={{ fontSize: 12 }}>{a.startDate}</td>
                        <td style={{ fontSize: 12 }}>{a.endDate}</td>
                        <td style={{ fontSize: 13, fontWeight: 700, color: "#1a73e8" }}>₹{a.paymentAmount}</td>
                        <td>
                          <span className="badge" style={{
                            background: a.isActive ? "#f0fdf4" : "#f8fafc",
                            color: a.isActive ? "#16a34a" : "#64748b", fontSize: 10
                          }}>{a.isActive ? "Active" : "Expired"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* GST + Insurance per ride info */}
      <div className="card border-0 shadow-sm" style={{ borderRadius: 14, background: "linear-gradient(135deg,#1a73e808,#16a34a08)" }}>
        <div className="card-body p-4">
          <div className="d-flex align-items-center gap-3 mb-3">
            <div style={{ width: 42, height: 42, borderRadius: 12, background: "#e8f0fe", color: "#1a73e8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
              <i className="bi bi-calculator-fill"></i>
            </div>
            <div>
              <h6 className="fw-bold mb-0">Per-Ride Charge Breakdown</h6>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>How admin earnings are calculated per trip</div>
            </div>
          </div>
          <div className="row g-3">
            {[
              { label: "Platform Commission", desc: "15% of ride fare (B2C)", color: "#1a73e8", example: "₹15 on ₹100 ride" },
              { label: "GST on Commission", desc: "18% of commission amount", color: "#d97706", example: "₹2.70 on ₹15 commission" },
              { label: "Insurance Per Ride", desc: "₹5 fixed per completed ride", color: "#0891b2", example: "₹5 per trip" },
              { label: "Admin Total", desc: "Commission + GST + Insurance", color: "#7c3aed", example: "₹22.70 on ₹100 ride" },
            ].map((item, i) => (
              <div key={i} className="col-6 col-md-3">
                <div style={{ padding: "12px 14px", background: "#fff", borderRadius: 12, border: `1.5px solid ${item.color}22` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: item.color, marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{item.desc}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: "#475569", marginTop: 6 }}>{item.example}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-backdrop-jago" onClick={() => { setShowModal(false); setEditing(null); }}>
          <div className="modal-jago" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-jago-header">
              <h5 className="modal-jago-title">
                <i className={`bi bi-shield-plus-fill me-2`} style={{ color: curType.color }}></i>
                {editing ? "Edit Insurance Plan" : "Create Insurance Plan"}
              </h5>
              <button className="modal-jago-close" onClick={() => { setShowModal(false); setEditing(null); }}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            {/* Plan type */}
            <div className="mb-3">
              <label className="form-label-jago mb-2">Plan Type</label>
              <div className="d-flex gap-2">
                {PLAN_TYPES.map(t => (
                  <button key={t.value} onClick={() => f("planType", t.value)}
                    className="btn btn-sm flex-1 d-flex align-items-center justify-content-center gap-1"
                    style={{
                      borderRadius: 10,
                      border: `1.5px solid ${form.planType === t.value ? t.color : "#e2e8f0"}`,
                      background: form.planType === t.value ? t.bg : "#fff",
                      color: form.planType === t.value ? t.color : "#64748b",
                      fontWeight: form.planType === t.value ? 700 : 500, fontSize: 11,
                    }} data-testid={`btn-ins-type-${t.value}`}>
                    <i className={`bi ${t.icon}`} style={{ fontSize: 12 }}></i>{t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="row g-3">
              <div className="col-12">
                <label className="form-label-jago">Plan Name <span className="text-danger">*</span></label>
                <input className="admin-form-control" value={form.name} onChange={e => f("name", e.target.value)}
                  placeholder="e.g. Basic Shield, Premium Protect" data-testid="input-ins-name" />
              </div>
              <div className="col-6">
                <label className="form-label-jago">Daily Premium (₹)</label>
                <div className="input-group">
                  <span className="input-group-text">₹</span>
                  <input type="number" min="0" className="admin-form-control" value={form.premiumDaily}
                    onChange={e => f("premiumDaily", e.target.value)} />
                </div>
              </div>
              <div className="col-6">
                <label className="form-label-jago">Monthly Premium (₹) <span className="text-danger">*</span></label>
                <div className="input-group">
                  <span className="input-group-text">₹</span>
                  <input type="number" min="0" className="admin-form-control" value={form.premiumMonthly}
                    onChange={e => f("premiumMonthly", e.target.value)} />
                </div>
              </div>
              <div className="col-12">
                <label className="form-label-jago">Coverage Amount (₹) <span className="text-danger">*</span></label>
                <div className="input-group">
                  <span className="input-group-text">₹</span>
                  <input type="number" min="0" className="admin-form-control" value={form.coverageAmount}
                    onChange={e => f("coverageAmount", e.target.value)} placeholder="e.g. 500000" />
                </div>
              </div>
              <div className="col-12">
                <label className="form-label-jago">Coverage Features (one per line)</label>
                <textarea className="admin-form-control" rows={4} value={form.features}
                  onChange={e => f("features", e.target.value)}
                  placeholder={"Vehicle damage coverage\nThird party liability\n24/7 claim support"} />
              </div>
              <div className="col-12 d-flex align-items-center gap-3">
                <label className="form-label-jago mb-0">Active</label>
                <label className="switcher">
                  <input type="checkbox" className="switcher_input" checked={form.isActive}
                    onChange={e => f("isActive", e.target.checked)} />
                  <span className="switcher_control"></span>
                </label>
              </div>
            </div>

            <div className="d-flex gap-2 justify-content-end pt-3 border-top mt-3">
              <button className="btn btn-outline-secondary" onClick={() => { setShowModal(false); setEditing(null); }}>Cancel</button>
              <button className="btn btn-primary"
                disabled={!form.name || !form.premiumMonthly || !form.coverageAmount || save.isPending}
                onClick={() => save.mutate(form)} data-testid="btn-save-insurance">
                {save.isPending ? <><span className="spinner-border spinner-border-sm me-2"></span>Saving…</> : editing ? "Update Plan" : "Create Plan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
