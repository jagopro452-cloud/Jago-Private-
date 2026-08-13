import { useQuery, useMutation } from "@tanstack/react-query";
import { adminFetch, queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

const CITIES = [
  "Hyderabad","Vijayawada","Visakhapatnam","Tirupati","Warangal","Bengaluru","Chennai",
  "Mumbai","Delhi","Pune","Kolkata","Ahmedabad","Surat","Jaipur","Lucknow","Kochi",
  "Coimbatore","Madurai","Nagpur","Indore","Bhopal","Chandigarh","Guwahati","Bhubaneswar",
];

function RouteModal({ open, onClose, editing, vehicles, onSave, saving }: any) {
  const [form, setForm] = useState(() => editing ? {
    fromCity: editing.fromCity || "",
    toCity: editing.toCity || "",
    estimatedKm: editing.estimatedKm || "",
    baseFare: editing.baseFare || "",
    farePerKm: editing.farePerKm || "0",
    tollCharges: editing.tollCharges || "0",
    vehicleCategoryId: editing.vehicleCategoryId || "",
    isActive: editing.isActive ?? true,
  } : {
    fromCity: "", toCity: "", estimatedKm: "", baseFare: "",
    farePerKm: "0", tollCharges: "0", vehicleCategoryId: "", isActive: true,
  });

  if (!open) return null;
  const f = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));

  const totalFare = Number(form.baseFare || 0) + Number(form.farePerKm || 0) * Number(form.estimatedKm || 0) + Number(form.tollCharges || 0);

  return (
    <div className="modal-backdrop-jago" onClick={onClose}>
      <div className="modal-jago" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-jago-header">
          <h5 className="modal-jago-title">
            <i className={`bi ${editing ? "bi-pencil-fill" : "bi-signpost-2-fill"} me-2 text-primary`}></i>
            {editing ? "Edit Route" : "Add Intercity Route"}
          </h5>
          <button className="modal-jago-close" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>

        {/* Route visual */}
        <div style={{ background: "linear-gradient(135deg, #e8f0fe, #f0fdf4)", borderRadius: 12, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>From</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a73e8" }}>{form.fromCity || "—"}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <i className="bi bi-arrow-right" style={{ fontSize: 20, color: "#94a3b8" }}></i>
            {form.estimatedKm && <span style={{ fontSize: 10, color: "#64748b" }}>{form.estimatedKm} km</span>}
          </div>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>To</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#16a34a" }}>{form.toCity || "—"}</div>
          </div>
          {totalFare > 0 && (
            <div style={{ borderLeft: "1px solid #e2e8f0", paddingLeft: 14, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#64748b" }}>Est. Fare</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#7c3aed" }}>₹{totalFare.toFixed(0)}</div>
            </div>
          )}
        </div>

        <div className="row g-3">
          <div className="col-6">
            <label className="form-label-jago">From City <span className="text-danger">*</span></label>
            <select className="admin-form-control" value={form.fromCity} onChange={e => f("fromCity", e.target.value)}
              data-testid="select-from-city">
              <option value="">Select city</option>
              {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-6">
            <label className="form-label-jago">To City <span className="text-danger">*</span></label>
            <select className="admin-form-control" value={form.toCity} onChange={e => f("toCity", e.target.value)}
              data-testid="select-to-city">
              <option value="">Select city</option>
              {CITIES.filter(c => c !== form.fromCity).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-6">
            <label className="form-label-jago">Estimated Distance (km)</label>
            <div className="input-group">
              <input type="number" min="0" className="admin-form-control" value={form.estimatedKm}
                onChange={e => f("estimatedKm", e.target.value)} placeholder="e.g. 275" data-testid="input-km" />
              <span className="input-group-text">km</span>
            </div>
          </div>
          <div className="col-6">
            <label className="form-label-jago">Base Fare (₹) <span className="text-danger">*</span></label>
            <div className="input-group">
              <span className="input-group-text fw-bold">₹</span>
              <input type="number" min="0" className="admin-form-control" value={form.baseFare}
                onChange={e => f("baseFare", e.target.value)} placeholder="e.g. 1800" data-testid="input-base-fare" />
            </div>
          </div>
          <div className="col-6">
            <label className="form-label-jago">Fare per km (₹)</label>
            <div className="input-group">
              <span className="input-group-text fw-bold">₹</span>
              <input type="number" min="0" step="0.5" className="admin-form-control" value={form.farePerKm}
                onChange={e => f("farePerKm", e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="col-6">
            <label className="form-label-jago">Toll Charges (₹)</label>
            <div className="input-group">
              <span className="input-group-text fw-bold">₹</span>
              <input type="number" min="0" className="admin-form-control" value={form.tollCharges}
                onChange={e => f("tollCharges", e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="col-12">
            <label className="form-label-jago">Vehicle Category (Optional)</label>
            <select className="admin-form-control" value={form.vehicleCategoryId}
              onChange={e => f("vehicleCategoryId", e.target.value)} data-testid="select-vehicle">
              <option value="">All Vehicles</option>
              {vehicles.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 4 }}>Leave empty to apply to all vehicle types</div>
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
          <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!form.fromCity || !form.toCity || !form.baseFare || saving}
            onClick={() => onSave(form)} data-testid="btn-save-route">
            {saving ? <><span className="spinner-border spinner-border-sm me-2"></span>Saving…</> : editing ? "Update Route" : "Add Route"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IntercityRoutesPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [search, setSearch] = useState("");

  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/intercity-routes"],
    queryFn: () => adminFetch("/api/intercity-routes").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
  });

  const { data: vehicles = [] } = useQuery<any[]>({
    queryKey: ["/api/vehicle-categories"],
    queryFn: () => adminFetch("/api/vehicle-categories").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
  });

  const routes = Array.isArray(data) ? data : [];
  const filtered = routes.filter(r =>
    !search || r.fromCity?.toLowerCase().includes(search.toLowerCase()) ||
    r.toCity?.toLowerCase().includes(search.toLowerCase())
  );

  const activeRoutes = routes.filter(r => r.isActive);
  const avgFare = routes.length ? routes.reduce((s, r) => s + Number(r.baseFare || 0), 0) / routes.length : 0;

  const save = useMutation({
    mutationFn: (d: any) => editing
      ? apiRequest("PUT", `/api/intercity-routes/${editing.id}`, d)
      : apiRequest("POST", "/api/intercity-routes", d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intercity-routes"] });
      toast({ title: editing ? "Route updated" : "Route added" });
      setOpen(false); setEditing(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: any) => apiRequest("PATCH", `/api/intercity-routes/${id}`, { isActive }),
    onMutate: async ({ id, isActive }: any) => {
      await queryClient.cancelQueries({ queryKey: ["/api/intercity-routes"] });
      const previous = queryClient.getQueryData<any[]>(["/api/intercity-routes"]);
      queryClient.setQueryData<any[]>(["/api/intercity-routes"], (current = []) =>
        current.map((route) => route.id === id ? { ...route, isActive } : route),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/intercity-routes"], context.previous);
      }
      toast({ title: "Error", description: "Failed to update route status", variant: "destructive" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/intercity-routes"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/intercity-routes/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/intercity-routes"] }); toast({ title: "Route deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">Intercity Routes</h4>
          <div className="text-muted small">Manage intercity car sharing routes and pricing between cities</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setOpen(true); }}
          data-testid="btn-add-route">
          <i className="bi bi-signpost-2-fill me-1"></i>Add Route
        </button>
      </div>

      {/* Summary */}
      <div className="row g-3 mb-3">
        {[
          { label: "Total Routes", val: routes.length, icon: "bi-signpost-2-fill", color: "#1a73e8", bg: "#e8f0fe" },
          { label: "Active Routes", val: activeRoutes.length, icon: "bi-check-circle-fill", color: "#16a34a", bg: "#f0fdf4" },
          { label: "Cities Connected", val: new Set(routes.flatMap(r => [r.fromCity, r.toCity])).size, icon: "bi-geo-alt-fill", color: "#d97706", bg: "#fefce8" },
          { label: "Avg Base Fare", val: `₹${avgFare.toFixed(0)}`, icon: "bi-currency-rupee", color: "#7c3aed", bg: "#f5f3ff" },
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

      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4 d-flex align-items-center justify-content-between flex-wrap gap-2"
          style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div className="fw-semibold" style={{ fontSize: 14 }}>
            <i className="bi bi-signpost-2-fill me-2 text-primary"></i>
            Route List
            <span className="badge ms-2" style={{ background: "#e8f0fe", color: "#1a73e8", fontSize: 10 }}>{filtered.length}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "6px 12px" }}>
            <i className="bi bi-search" style={{ fontSize: 12, color: "#94a3b8" }}></i>
            <input style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, width: 160 }}
              placeholder="Search city…" value={search} onChange={e => setSearch(e.target.value)}
              data-testid="input-search-route" />
          </div>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover mb-0">
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  {["#", "Route", "Distance", "Base Fare", "Per Km", "Toll", "Vehicle", "Active", "Actions"].map((h, i) => (
                    <th key={i} className={i === 0 ? "ps-4" : i === 8 ? "text-center pe-4" : ""}
                      style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", padding: "12px 8px" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? Array(4).fill(0).map((_, i) => (
                  <tr key={i}>{Array(9).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                )) : filtered.length === 0 ? (
                  <tr><td colSpan={9}>
                    <div className="text-center py-5 text-muted">
                      <i className="bi bi-signpost-2-fill fs-1 d-block mb-2" style={{ opacity: 0.25 }}></i>
                      <p className="fw-semibold mb-2">No intercity routes found</p>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => { setEditing(null); setOpen(true); }}>
                        <i className="bi bi-plus me-1"></i>Add First Route
                      </button>
                    </div>
                  </td></tr>
                ) : filtered.map((r: any, idx: number) => (
                  <tr key={r.id} data-testid={`row-route-${r.id}`}>
                    <td className="ps-4 text-muted small">{idx + 1}</td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div style={{ padding: "4px 10px", background: "linear-gradient(135deg, #e8f0fe, #f0fdf4)", borderRadius: 8, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#1a73e8" }}>{r.fromCity}</span>
                          <i className="bi bi-arrow-right" style={{ fontSize: 10, color: "#94a3b8" }}></i>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#16a34a" }}>{r.toCity}</span>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>{r.estimatedKm ? `${r.estimatedKm} km` : "—"}</td>
                    <td>
                      <span className="fw-semibold" style={{ fontSize: 13, color: "#16a34a" }}>₹{r.baseFare}</span>
                    </td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>
                      {Number(r.farePerKm) > 0 ? `₹${r.farePerKm}/km` : "Fixed"}
                    </td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>
                      {Number(r.tollCharges) > 0 ? `₹${r.tollCharges}` : "—"}
                    </td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>{r.vehicleName || "All"}</td>
                    <td>
                      <label className="switcher">
                        <input type="checkbox" className="switcher_input" checked={!!r.isActive}
                          onChange={ev => toggle.mutate({ id: r.id, isActive: ev.target.checked })}
                          data-testid={`toggle-route-${r.id}`} />
                        <span className="switcher_control"></span>
                      </label>
                    </td>
                    <td className="text-center pe-4">
                      <div className="d-flex justify-content-center gap-1">
                        <button className="btn btn-sm btn-outline-primary" style={{ borderRadius: 8 }}
                          onClick={() => { setEditing(r); setOpen(true); }} data-testid={`btn-edit-route-${r.id}`}>
                          <i className="bi bi-pencil-fill"></i>
                        </button>
                        <button className="btn btn-sm btn-outline-danger" style={{ borderRadius: 8 }}
                          onClick={async () => { if (await adminConfirm("Delete route?")) remove.mutate(r.id); }}
                          data-testid={`btn-delete-route-${r.id}`}>
                          <i className="bi bi-trash-fill"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <RouteModal key={editing?.id || "new"} open={open} onClose={() => { setOpen(false); setEditing(null); }}
        editing={editing} vehicles={Array.isArray(vehicles) ? vehicles : []}
        onSave={(d: any) => save.mutate(d)} saving={save.isPending} />
    </div>
  );
}
