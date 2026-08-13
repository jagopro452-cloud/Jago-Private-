import { useQuery, useMutation } from "@tanstack/react-query";
import { adminFetch, queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

const PLAN_TYPES = [
  { value: "ride", label: "Ride", icon: "bi-car-front-fill", color: "#1a73e8", bg: "#e8f0fe" },
  { value: "parcel", label: "Parcel", icon: "bi-box-seam-fill", color: "#16a34a", bg: "#f0fdf4" },
  { value: "both", label: "Both", icon: "bi-grid-fill", color: "#7c3aed", bg: "#f5f3ff" },
];

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  ride: { label: "Ride", color: "#1a73e8", bg: "#e8f0fe", icon: "bi-car-front-fill" },
  parcel: { label: "Parcel", color: "#16a34a", bg: "#f0fdf4", icon: "bi-box-seam-fill" },
  both: { label: "Ride + Parcel", color: "#7c3aed", bg: "#f5f3ff", icon: "bi-grid-fill" },
};

function PlanCard({ plan, onEdit, onDelete, onToggle }: any) {
  const type = TYPE_LABELS[plan.planType || "both"] || TYPE_LABELS.both;
  const features = plan.features ? plan.features.split("\n").filter(Boolean) : [];

  return (
    <div className="col-12 col-md-6 col-xl-4" data-testid={`card-plan-${plan.id}`}>
      <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 16, overflow: "hidden", border: `1.5px solid ${plan.isActive ? type.color + "22" : "#e2e8f0"} !important` }}>
        <div style={{ height: 5, background: plan.isActive ? `linear-gradient(90deg, ${type.color}, ${type.color}88)` : "#e2e8f0" }} />
        <div className="card-body d-flex flex-column" style={{ padding: "1.25rem" }}>
          <div className="d-flex align-items-start justify-content-between mb-2">
            <div className="d-flex align-items-center gap-2">
              <div className="rounded-3 d-flex align-items-center justify-content-center"
                style={{ width: 38, height: 38, background: type.bg, color: type.color, fontSize: 15 }}>
                <i className={`bi ${type.icon}`}></i>
              </div>
              <div>
                <div className="fw-bold" style={{ fontSize: 14, color: "#0f172a" }}>{plan.name}</div>
                <span className="badge" style={{ background: type.bg, color: type.color, fontSize: 9, padding: "2px 7px" }}>
                  {type.label}
                </span>
              </div>
            </div>
            <label className="switcher mb-0">
              <input type="checkbox" className="switcher_input" checked={!!plan.isActive}
                onChange={e => onToggle(plan.id, e.target.checked)} data-testid={`toggle-plan-${plan.id}`} />
              <span className="switcher_control"></span>
            </label>
          </div>

          <div className="d-flex align-items-end gap-1 mb-3">
            <span style={{ fontSize: 28, fontWeight: 800, color: type.color, lineHeight: 1 }}>₹{plan.price}</span>
            <span style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>/ {plan.durationDays} days</span>
          </div>

          <div className="row g-2 mb-3">
            {plan.maxRides > 0 && (
              <div className="col-6">
                <div style={{ background: "#e8f0fe", borderRadius: 8, padding: "6px 10px" }}>
                  <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>Rides</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#1a73e8" }}>{plan.maxRides}</div>
                </div>
              </div>
            )}
            {plan.maxParcels > 0 && (
              <div className="col-6">
                <div style={{ background: "#f0fdf4", borderRadius: 8, padding: "6px 10px" }}>
                  <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>Parcels</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#16a34a" }}>{plan.maxParcels}</div>
                </div>
              </div>
            )}
          </div>

          {features.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, flex: 1 }}>
              {features.slice(0, 4).map((f: string, i: number) => (
                <li key={i} style={{ fontSize: 11.5, color: "#475569", padding: "2px 0", display: "flex", alignItems: "center", gap: 6 }}>
                  <i className="bi bi-check-circle-fill" style={{ color: type.color, fontSize: 10 }}></i>
                  {f}
                </li>
              ))}
              {features.length > 4 && <li style={{ fontSize: 11, color: "#94a3b8" }}>+{features.length - 4} more</li>}
            </ul>
          )}

          <div className="d-flex gap-2 mt-3 pt-3" style={{ borderTop: "1px solid #f1f5f9" }}>
            <button className="btn btn-sm btn-outline-primary flex-1" onClick={() => onEdit(plan)}
              data-testid={`btn-edit-plan-${plan.id}`}>
              <i className="bi bi-pencil-fill me-1"></i>Edit
            </button>
            <button className="btn btn-sm btn-outline-danger" onClick={() => onDelete(plan.id)}
              data-testid={`btn-delete-plan-${plan.id}`}>
              <i className="bi bi-trash-fill"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SubscriptionsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    name: "", price: "", durationDays: "30", features: "",
    isActive: true, planType: "both", maxRides: "0", maxParcels: "0",
  });

  const { data, isLoading } = useQuery<any[]>({
    queryKey: ["/api/subscription-plans"],
    queryFn: () => adminFetch("/api/subscription-plans").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
  });
  const plans = Array.isArray(data) ? data : [];

  const filtered = tab === "all" ? plans : plans.filter(p => p.planType === tab);
  const ridePlans = plans.filter(p => p.planType === "ride");
  const parcelPlans = plans.filter(p => p.planType === "parcel");
  const bothPlans = plans.filter(p => p.planType === "both");
  const activePlans = plans.filter(p => p.isActive);

  const save = useMutation({
    mutationFn: (payload: any) => editing
      ? apiRequest("PUT", `/api/subscription-plans/${editing.id}`, payload)
      : apiRequest("POST", "/api/subscription-plans", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription-plans"] });
      setShowModal(false); setEditing(null);
      toast({ title: editing ? "Plan updated" : "Plan created" });
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: any) => apiRequest("PATCH", `/api/subscription-plans/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/subscription-plans"] }),
    onError: (e: any) => { queryClient.invalidateQueries({ queryKey: ["/api/subscription-plans"] }); toast({ title: "Toggle failed", description: e.message, variant: "destructive" }); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/subscription-plans/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/subscription-plans"] }); toast({ title: "Plan deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", price: "", durationDays: "30", features: "", isActive: true, planType: tab === "all" ? "both" : tab, maxRides: "0", maxParcels: "0" });
    setShowModal(true);
  };

  const openEdit = (p: any) => {
    setEditing(p);
    setForm({ name: p.name, price: p.price, durationDays: p.durationDays, features: p.features || "", isActive: p.isActive, planType: p.planType || "both", maxRides: p.maxRides || "0", maxParcels: p.maxParcels || "0" });
    setShowModal(true);
  };

  const f = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const curType = TYPE_LABELS[form.planType] || TYPE_LABELS.both;

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">Subscription Plans</h4>
          <div className="text-muted small">Manage ride and parcel subscription packages for customers</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd} data-testid="btn-add-plan">
          <i className="bi bi-plus-circle-fill me-1"></i>Add Plan
        </button>
      </div>

      {/* Summary cards */}
      <div className="row g-3 mb-4">
        {[
          { label: "Total Plans", val: plans.length, icon: "bi-card-checklist", color: "#1a73e8", bg: "#e8f0fe" },
          { label: "Active Plans", val: activePlans.length, icon: "bi-check-circle-fill", color: "#16a34a", bg: "#f0fdf4" },
          { label: "Ride Plans", val: ridePlans.length + bothPlans.length, icon: "bi-car-front-fill", color: "#1a73e8", bg: "#eff6ff" },
          { label: "Parcel Plans", val: parcelPlans.length + bothPlans.length, icon: "bi-box-seam-fill", color: "#16a34a", bg: "#f0fdf4" },
        ].map((s, i) => (
          <div key={i} className="col-6 col-xl-3">
            <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: 40, height: 40, background: s.bg, color: s.color, fontSize: "1rem" }}>
                  <i className={`bi ${s.icon}`}></i>
                </div>
                <div>
                  <div className="fw-bold" style={{ fontSize: 20, color: s.color }}>{isLoading ? "—" : s.val}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{s.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs + Grid */}
      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <ul className="nav nav--tabs p-1 rounded bg-light">
            {[["all", "All Plans", plans.length], ["ride", "Ride Only", ridePlans.length], ["parcel", "Parcel Only", parcelPlans.length], ["both", "Ride + Parcel", bothPlans.length]].map(([val, label, cnt]) => (
              <li key={val as string} className="nav-item">
                <button className={`nav-link${tab === val ? " active" : ""}`}
                  onClick={() => setTab(val as string)} data-testid={`tab-sub-${val}`}>
                  {label}
                  {(cnt as number) > 0 && <span className="badge ms-1 rounded-pill"
                    style={{ background: tab === val ? "rgba(255,255,255,0.3)" : "#e2e8f0", color: tab === val ? "white" : "#475569", fontSize: 9 }}>
                    {cnt}
                  </span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="card-body p-3 p-lg-4">
          {isLoading ? (
            <div className="row g-3">
              {Array(3).fill(0).map((_, i) => (
                <div key={i} className="col-12 col-md-6 col-xl-4">
                  <div className="card border-0" style={{ borderRadius: 16, height: 280, background: "#f8fafc" }} />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <i className="bi bi-card-checklist fs-1 d-block mb-2" style={{ opacity: 0.25 }}></i>
              <p className="fw-semibold mb-2">No {tab === "all" ? "" : tab + " "}plans found</p>
              <button className="btn btn-sm btn-outline-primary" onClick={openAdd}>
                <i className="bi bi-plus me-1"></i>Create First Plan
              </button>
            </div>
          ) : (
            <div className="row g-3">
              {filtered.map(plan => (
                <PlanCard key={plan.id} plan={plan}
                  onEdit={openEdit}
                  onDelete={async (id: string) => { if (await adminConfirm("Delete subscription plan?")) remove.mutate(id); }}
                  onToggle={(id: string, isActive: boolean) => toggle.mutate({ id, isActive })}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-backdrop-jago" onClick={() => { setShowModal(false); setEditing(null); }}>
          <div className="modal-jago" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-jago-header">
              <h5 className="modal-jago-title">
                <i className={`bi bi-card-checklist me-2`} style={{ color: curType.color }}></i>
                {editing ? "Edit Plan" : "Create Subscription Plan"}
              </h5>
              <button className="modal-jago-close" onClick={() => { setShowModal(false); setEditing(null); }}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            {/* Plan type selector */}
            <div className="mb-3">
              <label className="form-label-jago mb-2">Plan Type</label>
              <div className="d-flex gap-2">
                {PLAN_TYPES.map(t => (
                  <button key={t.value}
                    className={`btn btn-sm flex-1 d-flex align-items-center justify-content-center gap-1`}
                    style={{
                      borderRadius: 10, border: `1.5px solid ${form.planType === t.value ? t.color : "#e2e8f0"}`,
                      background: form.planType === t.value ? t.bg : "#fff",
                      color: form.planType === t.value ? t.color : "#64748b",
                      fontWeight: form.planType === t.value ? 700 : 500, fontSize: 12
                    }}
                    onClick={() => f("planType", t.value)} data-testid={`btn-type-${t.value}`}>
                    <i className={`bi ${t.icon}`} style={{ fontSize: 13 }}></i>{t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="row g-3">
              <div className="col-12">
                <label className="form-label-jago">Plan Name <span className="text-danger">*</span></label>
                <input className="admin-form-control" value={form.name} onChange={e => f("name", e.target.value)}
                  placeholder="e.g. Ride Basic, Parcel Pro" data-testid="input-plan-name" />
              </div>
              <div className="col-6">
                <label className="form-label-jago">Price (₹) <span className="text-danger">*</span></label>
                <div className="input-group">
                  <span className="input-group-text fw-bold">₹</span>
                  <input type="number" min="0" className="admin-form-control" value={form.price}
                    onChange={e => f("price", e.target.value)} data-testid="input-plan-price" />
                </div>
              </div>
              <div className="col-6">
                <label className="form-label-jago">Duration (Days)</label>
                <input type="number" min="1" className="admin-form-control" value={form.durationDays}
                  onChange={e => f("durationDays", e.target.value)} />
              </div>

              {(form.planType === "ride" || form.planType === "both") && (
                <div className="col-6">
                  <label className="form-label-jago">
                    <i className="bi bi-car-front-fill me-1 text-primary" style={{ fontSize: 11 }}></i>
                    Max Rides (0 = unlimited)
                  </label>
                  <input type="number" min="0" className="admin-form-control" value={form.maxRides}
                    onChange={e => f("maxRides", e.target.value)} data-testid="input-max-rides" />
                </div>
              )}
              {(form.planType === "parcel" || form.planType === "both") && (
                <div className="col-6">
                  <label className="form-label-jago">
                    <i className="bi bi-box-seam-fill me-1 text-success" style={{ fontSize: 11 }}></i>
                    Max Parcels (0 = unlimited)
                  </label>
                  <input type="number" min="0" className="admin-form-control" value={form.maxParcels}
                    onChange={e => f("maxParcels", e.target.value)} data-testid="input-max-parcels" />
                </div>
              )}

              <div className="col-12">
                <label className="form-label-jago">Features (one per line)</label>
                <textarea className="admin-form-control" rows={4} value={form.features}
                  onChange={e => f("features", e.target.value)}
                  placeholder={"Unlimited rides\nPriority driver matching\n24/7 support\nNo surge pricing"} />
              </div>
              <div className="col-12 d-flex align-items-center gap-3">
                <label className="form-label-jago mb-0">Active on Launch</label>
                <label className="switcher">
                  <input type="checkbox" className="switcher_input" checked={form.isActive}
                    onChange={e => f("isActive", e.target.checked)} />
                  <span className="switcher_control"></span>
                </label>
              </div>
            </div>

            <div className="d-flex gap-2 justify-content-end pt-3 border-top mt-3">
              <button className="btn btn-outline-secondary" onClick={() => { setShowModal(false); setEditing(null); }}>Cancel</button>
              <button className="btn btn-primary" disabled={!form.name || !form.price || save.isPending}
                onClick={() => save.mutate(form)} data-testid="btn-save-plan">
                {save.isPending ? <><span className="spinner-border spinner-border-sm me-2"></span>Saving…</> : editing ? "Update Plan" : "Create Plan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
