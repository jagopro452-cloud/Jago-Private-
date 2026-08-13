import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

export default function DriverLevelsPage() {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", minPoints: "", maxPoints: "", reward: "", rewardType: "cashback", isActive: true });

  const { data, isLoading } = useQuery<any[]>({ queryKey: ["/api/driver-levels"] });
  const levels = Array.isArray(data) ? data : [];

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiRequest("PATCH", `/api/driver-levels/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/driver-levels"] }),
    onError: (e: any) => { queryClient.invalidateQueries({ queryKey: ["/api/driver-levels"] }); toast({ title: "Toggle failed", description: e.message, variant: "destructive" }); },
  });

  const saveMutation = useMutation({
    mutationFn: (payload: any) =>
      editing ? apiRequest("PUT", `/api/driver-levels/${editing.id}`, payload) : apiRequest("POST", "/api/driver-levels", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver-levels"] });
      setShowModal(false);
      toast({ title: editing ? "Level updated" : "Level created" });
      setEditing(null);
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/driver-levels/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/driver-levels"] }); toast({ title: "Level deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const openAdd = () => { setEditing(null); setForm({ name: "", minPoints: "", maxPoints: "", reward: "", rewardType: "cashback", isActive: true }); setShowModal(true); };
  const openEdit = (l: any) => { setEditing(l); setForm({ name: l.name, minPoints: l.minPoints, maxPoints: l.maxPoints, reward: l.reward || "", rewardType: l.rewardType || "cashback", isActive: l.isActive }); setShowModal(true); };

  return (
    <>
    
      <div className="content-header">
        <div className="container-fluid">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
            <h2 className="h5 mb-0">Driver Level Setup</h2>
            <button className="btn btn-primary btn-sm" onClick={openAdd} data-testid="btn-add-driver-level">
              <i className="bi bi-plus me-1"></i>Add Level
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
                    <th>Level Name</th>
                    <th>Min Points</th>
                    <th>Max Points</th>
                    <th>Reward</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={7} className="text-center py-4"><div className="spinner-border spinner-border-sm" role="status" /></td></tr>
                  ) : levels.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-5 text-muted">
                        <i className="bi bi-bar-chart-fill fs-2 d-block mb-2 opacity-25"></i>
                        No driver levels found. Click Add Level to create one.
                      </td>
                    </tr>
                  ) : levels.map((l: any, idx: number) => (
                    <tr key={l.id} data-testid={`row-driver-level-${l.id}`}>
                      <td>{idx + 1}</td>
                      <td className="fw-semibold">{l.name}</td>
                      <td>{l.minPoints}</td>
                      <td>{l.maxPoints}</td>
                      <td>{l.reward ? `${l.reward} (${l.rewardType})` : "—"}</td>
                      <td>
                        <label className="switcher">
                          <input className="switcher_input" type="checkbox" checked={!!l.isActive} onChange={e => toggleMutation.mutate({ id: l.id, isActive: e.target.checked })} />
                          <span className="switcher_control"></span>
                        </label>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-outline-primary me-1" onClick={() => openEdit(l)}><i className="bi bi-pencil-fill"></i></button>
                        <button className="btn btn-sm btn-outline-danger" onClick={async () => { if (await adminConfirm("Delete this driver level?")) deleteMutation.mutate(l.id); }}><i className="bi bi-trash-fill"></i></button>
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
                <h5 className="modal-title">{editing ? "Edit Driver Level" : "Add Driver Level"}</h5>
                <button className="btn-close" onClick={() => setShowModal(false)} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label fw-semibold">Level Name <span className="text-danger">*</span></label>
                  <input className="form-control" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Gold, Silver" data-testid="input-level-name" />
                </div>
                <div className="row g-3 mb-3">
                  <div className="col-6">
                    <label className="form-label fw-semibold">Min Points</label>
                    <input className="form-control" type="number" min="0" value={form.minPoints} onChange={e => setForm({ ...form, minPoints: e.target.value })} data-testid="input-min-points" />
                  </div>
                  <div className="col-6">
                    <label className="form-label fw-semibold">Max Points</label>
                    <input className="form-control" type="number" min="0" value={form.maxPoints} onChange={e => setForm({ ...form, maxPoints: e.target.value })} data-testid="input-max-points" />
                  </div>
                </div>
                <div className="row g-3 mb-3">
                  <div className="col-6">
                    <label className="form-label fw-semibold">Reward Amount</label>
                    <input className="form-control" type="number" min="0" value={form.reward} onChange={e => setForm({ ...form, reward: e.target.value })} data-testid="input-reward" />
                  </div>
                  <div className="col-6">
                    <label className="form-label fw-semibold">Reward Type</label>
                    <select className="form-select" value={form.rewardType} onChange={e => setForm({ ...form, rewardType: e.target.value })}>
                      <option value="cashback">Cashback</option>
                      <option value="discount">Discount</option>
                      <option value="points">Bonus Points</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-light" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={!form.name || saveMutation.isPending} onClick={() => saveMutation.mutate(form)} data-testid="btn-save-level">
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
