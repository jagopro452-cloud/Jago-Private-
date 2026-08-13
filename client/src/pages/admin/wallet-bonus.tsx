import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

export default function WalletBonusPage() {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", bonusAmount: "", minimumAddAmount: "", bonusType: "percentage", maxBonusAmount: "", isActive: true });

  const { data, isLoading } = useQuery<any[]>({ queryKey: ["/api/wallet-bonus"] });
  const bonuses = Array.isArray(data) ? data : [];

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiRequest("PATCH", `/api/wallet-bonus/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/wallet-bonus"] }),
    onError: (e: any) => { queryClient.invalidateQueries({ queryKey: ["/api/wallet-bonus"] }); toast({ title: "Toggle failed", description: e.message, variant: "destructive" }); },
  });

  const saveMutation = useMutation({
    mutationFn: (payload: any) =>
      editing ? apiRequest("PUT", `/api/wallet-bonus/${editing.id}`, payload) : apiRequest("POST", "/api/wallet-bonus", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wallet-bonus"] });
      setShowModal(false);
      toast({ title: editing ? "Updated" : "Created" });
      setEditing(null);
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/wallet-bonus/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/wallet-bonus"] }); toast({ title: "Bonus deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const openAdd = () => { setEditing(null); setForm({ name: "", bonusAmount: "", minimumAddAmount: "", bonusType: "percentage", maxBonusAmount: "", isActive: true }); setShowModal(true); };
  const openEdit = (b: any) => { setEditing(b); setForm({ name: b.name, bonusAmount: b.bonusAmount, minimumAddAmount: b.minimumAddAmount || "", bonusType: b.bonusType, maxBonusAmount: b.maxBonusAmount || "", isActive: b.isActive }); setShowModal(true); };

  return (
    <>
    
      <div className="content-header">
        <div className="container-fluid">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
            <h2 className="h5 mb-0">Wallet Bonus Setup</h2>
            <button className="btn btn-primary btn-sm" onClick={openAdd} data-testid="btn-add-wallet-bonus">
              <i className="bi bi-plus me-1"></i>Add Bonus
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
                    <th>Name</th>
                    <th>Bonus</th>
                    <th>Type</th>
                    <th>Min Add Amount</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={7} className="text-center py-4"><div className="spinner-border spinner-border-sm" role="status" /></td></tr>
                  ) : bonuses.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-5 text-muted">
                        <i className="bi bi-wallet2 fs-2 d-block mb-2 opacity-25"></i>
                        No wallet bonus offers found. Click Add Bonus to create one.
                      </td>
                    </tr>
                  ) : bonuses.map((b: any, idx: number) => (
                    <tr key={b.id} data-testid={`row-bonus-${b.id}`}>
                      <td>{idx + 1}</td>
                      <td className="fw-semibold">{b.name}</td>
                      <td>{b.bonusAmount}{b.bonusType === "percentage" ? "%" : " ₹"}</td>
                      <td className="text-capitalize">{b.bonusType}</td>
                      <td>{b.minimumAddAmount ? `₹${b.minimumAddAmount}` : "—"}</td>
                      <td>
                        <label className="switcher">
                          <input className="switcher_input" type="checkbox" checked={!!b.isActive} onChange={e => toggleMutation.mutate({ id: b.id, isActive: e.target.checked })} />
                          <span className="switcher_control"></span>
                        </label>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-outline-primary me-1" onClick={() => openEdit(b)}><i className="bi bi-pencil-fill"></i></button>
                        <button className="btn btn-sm btn-outline-danger" onClick={async () => { if (await adminConfirm("Delete this wallet bonus?")) deleteMutation.mutate(b.id); }}><i className="bi bi-trash-fill"></i></button>
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
                <h5 className="modal-title">{editing ? "Edit Wallet Bonus" : "Add Wallet Bonus"}</h5>
                <button className="btn-close" onClick={() => setShowModal(false)} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label fw-semibold">Name <span className="text-danger">*</span></label>
                  <input className="form-control" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="input-bonus-name" />
                </div>
                <div className="row g-3 mb-3">
                  <div className="col-6">
                    <label className="form-label fw-semibold">Bonus Amount <span className="text-danger">*</span></label>
                    <input className="form-control" type="number" min="0" value={form.bonusAmount} onChange={e => setForm({ ...form, bonusAmount: e.target.value })} data-testid="input-bonus-amount" />
                  </div>
                  <div className="col-6">
                    <label className="form-label fw-semibold">Bonus Type</label>
                    <select className="form-select" value={form.bonusType} onChange={e => setForm({ ...form, bonusType: e.target.value })}>
                      <option value="percentage">Percentage (%)</option>
                      <option value="amount">Fixed Amount (₹)</option>
                    </select>
                  </div>
                </div>
                <div className="row g-3 mb-3">
                  <div className="col-6">
                    <label className="form-label fw-semibold">Min Add Amount</label>
                    <input className="form-control" type="number" min="0" value={form.minimumAddAmount} onChange={e => setForm({ ...form, minimumAddAmount: e.target.value })} data-testid="input-min-add" />
                  </div>
                  <div className="col-6">
                    <label className="form-label fw-semibold">Max Bonus</label>
                    <input className="form-control" type="number" min="0" value={form.maxBonusAmount} onChange={e => setForm({ ...form, maxBonusAmount: e.target.value })} data-testid="input-max-bonus" />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-light" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={!form.name || !form.bonusAmount || saveMutation.isPending} onClick={() => saveMutation.mutate(form)} data-testid="btn-save-bonus">
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
