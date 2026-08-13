import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

function ReasonModal({ open, onClose, editing, form, setForm, onSave, saving }: any) {
  if (!open) return null;
  return (
    <div className="modal-backdrop-jago">
      <div className="modal-jago">
        <div className="modal-jago-header">
          <h5 className="modal-jago-title">{editing ? "Edit Reason" : "Add Cancel Reason"}</h5>
          <button className="modal-jago-close" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>
        <div className="d-flex flex-column gap-3">
          <div>
            <label className="form-label-jago">Reason <span className="text-danger">*</span></label>
            <input className="form-control" value={form.reason} onChange={e => setForm((f: any) => ({ ...f, reason: e.target.value }))} placeholder="Enter cancellation reason" data-testid="input-reason" />
          </div>
          <div>
            <label className="form-label-jago">User Type</label>
            <select className="form-select" value={form.userType} onChange={e => setForm((f: any) => ({ ...f, userType: e.target.value }))}>
              <option value="customer">Customer</option>
              <option value="driver">Driver</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div className="d-flex gap-2 justify-content-end mt-2">
            <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={onSave} disabled={!form.reason || saving} data-testid="btn-save-reason">
              {saving ? "Saving..." : editing ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CancellationReasonsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ reason: "", userType: "customer" });

  const { data, isLoading } = useQuery<any[]>({
    queryKey: ["/api/cancellation-reasons"],
    queryFn: () => apiRequest("GET", "/api/cancellation-reasons").then(r => r.json()).then(d => Array.isArray(d) ? d : (d?.data ? d.data : [])),
  });

  const save = useMutation({
    mutationFn: (d: any) => editing
      ? apiRequest("PUT", `/api/cancellation-reasons/${editing.id}`, d)
      : apiRequest("POST", "/api/cancellation-reasons", d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cancellation-reasons"] });
      toast({ title: editing ? "Reason updated" : "Reason created" });
      setOpen(false); setEditing(null); setForm({ reason: "", userType: "customer" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/cancellation-reasons/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/cancellation-reasons"] }); toast({ title: "Reason deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/cancellation-reasons/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/cancellation-reasons"] }),
    onError: (e: any) => { qc.invalidateQueries({ queryKey: ["/api/cancellation-reasons"] }); toast({ title: "Toggle failed", description: e.message, variant: "destructive" }); },
  });

  const openCreate = () => { setEditing(null); setForm({ reason: "", userType: "customer" }); setOpen(true); };
  const openEdit = (r: any) => { setEditing(r); setForm({ reason: r.reason, userType: r.userType || "customer" }); setOpen(true); };
  const reasons = Array.isArray(data) ? data : [];

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-4">
        <h2 className="fs-22 text-capitalize mb-0" data-testid="page-title">Cancellation Reasons</h2>
        <button className="btn btn-primary" onClick={openCreate} data-testid="btn-add-reason">
          <i className="bi bi-plus-circle me-1"></i> Add Reason
        </button>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover">
              <thead className="table-light align-middle text-capitalize">
                <tr>
                  <th>SL</th>
                  <th>Reason</th>
                  <th>User Type</th>
                  <th>Status</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <tr key={i}>{Array(5).fill(0).map((_, j) => <td key={j}><div style={{ height: "14px", background: "#f1f5f9", borderRadius: "4px" }} /></td>)}</tr>
                  ))
                ) : reasons.length ? (
                  reasons.map((r: any, idx: number) => (
                    <tr key={r.id} data-testid={`reason-row-${r.id}`}>
                      <td>{idx + 1}</td>
                      <td className="fw-medium title-color">{r.reason}</td>
                      <td>
                        <span className={`badge ${r.userType === "customer" ? "bg-info" : r.userType === "driver" ? "bg-warning text-dark" : "bg-secondary"}`}>
                          {r.userType || "customer"}
                        </span>
                      </td>
                      <td>
                        <label className="switcher">
                          <input type="checkbox" className="switcher_input" checked={r.isActive} onChange={() => toggleStatus.mutate({ id: r.id, isActive: !r.isActive })} data-testid={`toggle-reason-${r.id}`} />
                          <span className="switcher_control"></span>
                        </label>
                      </td>
                      <td className="text-center">
                        <div className="d-flex justify-content-center gap-2">
                          <button className="btn btn-sm btn-outline-primary" onClick={() => openEdit(r)} data-testid={`btn-edit-reason-${r.id}`}><i className="bi bi-pencil-fill"></i></button>
                          <button className="btn btn-sm btn-outline-danger" onClick={async () => { if (await adminConfirm("Delete this reason?")) remove.mutate(r.id); }} data-testid={`btn-delete-reason-${r.id}`}><i className="bi bi-trash-fill"></i></button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={5}>
                    <div className="d-flex flex-column justify-content-center align-items-center gap-2 py-4">
                      <i className="bi bi-x-circle" style={{ fontSize: "2rem", color: "#94a3b8" }}></i>
                      <p className="text-muted mb-0">No cancellation reasons found</p>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ReasonModal open={open} onClose={() => setOpen(false)} editing={editing} form={form} setForm={setForm} onSave={() => save.mutate(form)} saving={save.isPending} />
    </div>
  );
}
