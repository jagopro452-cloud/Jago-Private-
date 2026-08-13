import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

export default function SurgePricingPage() {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ zoneId: "", startTime: "", endTime: "", multiplier: "", reason: "", isActive: true });

  const { data, isLoading } = useQuery<any[]>({ queryKey: ["/api/surge-pricing"] });
  const { data: zonesData } = useQuery<any[]>({ queryKey: ["/api/zones"] });
  const surges = Array.isArray(data) ? data : [];
  const zones = Array.isArray(zonesData) ? zonesData : [];

  const saveMutation = useMutation({
    mutationFn: (d: any) => editing ? apiRequest("PUT", `/api/surge-pricing/${editing.id}`, d) : apiRequest("POST", "/api/surge-pricing", d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/surge-pricing"] });
      setShowModal(false);
      toast({ title: editing ? "Updated" : "Created" });
      setEditing(null);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/surge-pricing/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/surge-pricing"] }); toast({ title: "Surge rule deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: any) => apiRequest("PATCH", `/api/surge-pricing/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/surge-pricing"] }),
    onError: (e: any) => { queryClient.invalidateQueries({ queryKey: ["/api/surge-pricing"] }); toast({ title: "Toggle failed", description: e.message, variant: "destructive" }); },
  });

  const openAdd = () => { setEditing(null); setForm({ zoneId: "", startTime: "", endTime: "", multiplier: "", reason: "", isActive: true }); setShowModal(true); };
  const openEdit = (s: any) => { setEditing(s); setForm({ zoneId: s.zoneId || "", startTime: s.startTime || "", endTime: s.endTime || "", multiplier: s.multiplier || "", reason: s.reason || "", isActive: s.isActive }); setShowModal(true); };

  return (
    <>
    
      <div className="content-header">
        <div className="container-fluid">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
            <h2 className="h5 mb-0">Surge Pricing</h2>
            <button className="btn btn-primary btn-sm" onClick={openAdd} data-testid="btn-add-surge">
              <i className="bi bi-plus me-1"></i>Add Surge Rule
            </button>
          </div>
        </div>
      </div>
      <div className="container-fluid">
        <div className="card">
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-borderless align-middle table-hover">
                <thead className="table-light">
                  <tr>
                    <th>#</th>
                    <th>Zone</th>
                    <th>Start Time</th>
                    <th>End Time</th>
                    <th>Multiplier</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={8} className="text-center py-4"><div className="spinner-border spinner-border-sm" role="status" /></td></tr>
                  ) : surges.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-5 text-muted">
                        <i className="bi bi-graph-up-arrow fs-2 d-block mb-2 opacity-25"></i>
                        No surge pricing rules found.
                      </td>
                    </tr>
                  ) : surges.map((s: any, idx: number) => (
                    <tr key={s.id} data-testid={`row-surge-${s.id}`}>
                      <td>{idx + 1}</td>
                      <td className="fw-semibold">{s.zoneName || "All Zones"}</td>
                      <td>{s.startTime || "—"}</td>
                      <td>{s.endTime || "—"}</td>
                      <td><span className="badge bg-warning text-dark">{s.multiplier}x</span></td>
                      <td>{s.reason || "—"}</td>
                      <td>
                        <label className="switcher">
                          <input className="switcher_input" type="checkbox" checked={s.isActive} onChange={e => toggleMutation.mutate({ id: s.id, isActive: e.target.checked })} />
                          <span className="switcher_control"></span>
                        </label>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-outline-primary me-1" onClick={() => openEdit(s)}><i className="bi bi-pencil-fill"></i></button>
                        <button className="btn btn-sm btn-outline-danger" onClick={async () => { if (await adminConfirm("Delete this surge rule?")) deleteMutation.mutate(s.id); }}><i className="bi bi-trash-fill"></i></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal fade show d-block" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{editing ? "Edit Surge Rule" : "Add Surge Rule"}</h5>
                <button className="btn-close" onClick={() => setShowModal(false)} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label fw-semibold">Zone</label>
                  <select className="form-select" value={form.zoneId} onChange={e => setForm({ ...form, zoneId: e.target.value })} data-testid="select-surge-zone">
                    <option value="">All Zones</option>
                    {zones.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </div>
                <div className="row g-3 mb-3">
                  <div className="col-6">
                    <label className="form-label fw-semibold">Start Time</label>
                    <input className="form-control" type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} data-testid="input-surge-start" />
                  </div>
                  <div className="col-6">
                    <label className="form-label fw-semibold">End Time</label>
                    <input className="form-control" type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} data-testid="input-surge-end" />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold">Multiplier <span className="text-danger">*</span></label>
                  <input className="form-control" type="number" min="1" step="0.1" value={form.multiplier} onChange={e => setForm({ ...form, multiplier: e.target.value })} placeholder="e.g. 1.5" data-testid="input-surge-multiplier" />
                  <div className="form-text">1.5x means 50% surge charge added to base fare</div>
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold">Reason</label>
                  <input className="form-control" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Peak hours, Rain" data-testid="input-surge-reason" />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-light" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={!form.multiplier || saveMutation.isPending} onClick={() => saveMutation.mutate(form)} data-testid="btn-save-surge">
                  {saveMutation.isPending ? "Saving..." : editing ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    
    </>
  );
}
