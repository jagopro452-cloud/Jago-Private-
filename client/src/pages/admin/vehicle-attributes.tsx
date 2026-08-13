import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

export default function VehicleAttributesPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"brands" | "models">("brands");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", isActive: true });

  const { data: brands, isLoading: brandsLoading } = useQuery<any[]>({ queryKey: ["/api/vehicle-brands"] });
  const { data: models, isLoading: modelsLoading } = useQuery<any[]>({ queryKey: ["/api/vehicle-models"] });
  const brandList = Array.isArray(brands) ? brands : [];
  const modelList = Array.isArray(models) ? models : [];

  const brandSave = useMutation({
    mutationFn: (d: any) => editing ? apiRequest("PUT", `/api/vehicle-brands/${editing.id}`, d) : apiRequest("POST", "/api/vehicle-brands", d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/vehicle-brands"] }); setShowModal(false); toast({ title: "Saved" }); setEditing(null); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const brandDelete = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/vehicle-brands/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/vehicle-brands"] }); toast({ title: "Deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const modelSave = useMutation({
    mutationFn: (d: any) => editing ? apiRequest("PUT", `/api/vehicle-models/${editing.id}`, d) : apiRequest("POST", "/api/vehicle-models", d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/vehicle-models"] }); setShowModal(false); toast({ title: "Saved" }); setEditing(null); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const modelDelete = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/vehicle-models/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/vehicle-models"] }); toast({ title: "Deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const isSaving = brandSave.isPending || modelSave.isPending;

  const openAdd = () => { setEditing(null); setForm({ name: "", isActive: true }); setShowModal(true); };
  const openEdit = (item: any) => { setEditing(item); setForm({ name: item.name, isActive: item.isActive }); setShowModal(true); };

  const handleSave = () => {
    if (tab === "brands") brandSave.mutate(form);
    else modelSave.mutate(form);
  };

  const handleDelete = async (id: string) => {
    if (!(await adminConfirm(`Delete this vehicle ${tab === "brands" ? "brand" : "model"}?`))) return;
    if (tab === "brands") brandDelete.mutate(id);
    else modelDelete.mutate(id);
  };

  const currentList = tab === "brands" ? brandList : modelList;
  const currentLoading = tab === "brands" ? brandsLoading : modelsLoading;

  return (
    <>
    
      <div className="content-header">
        <div className="container-fluid">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
            <h2 className="h5 mb-0">Vehicle Attribute Setup</h2>
            <button className="btn btn-primary btn-sm" onClick={openAdd} data-testid="btn-add-vehicle-attr">
              <i className="bi bi-plus me-1"></i>Add {tab === "brands" ? "Brand" : "Model"}
            </button>
          </div>
        </div>
      </div>
      <div className="container-fluid">
        <div className="card">
          <div className="card-header border-bottom py-3">
            <ul className="nav nav--tabs p-1 rounded bg-white">
              <li className="nav-item">
                <button className={`nav-link${tab === "brands" ? " active" : ""}`} onClick={() => setTab("brands")} data-testid="tab-brands">Brands</button>
              </li>
              <li className="nav-item">
                <button className={`nav-link${tab === "models" ? " active" : ""}`} onClick={() => setTab("models")} data-testid="tab-models">Models</button>
              </li>
            </ul>
          </div>
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-borderless align-middle table-hover">
                <thead className="table-light">
                  <tr><th>#</th><th>Name</th><th>Status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {currentLoading ? (
                    <tr><td colSpan={4} className="text-center py-4"><div className="spinner-border spinner-border-sm" role="status" /></td></tr>
                  ) : currentList.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-5 text-muted">
                        <i className="bi bi-ev-front-fill fs-2 d-block mb-2 opacity-25"></i>
                        No vehicle {tab === "brands" ? "brands" : "models"} found.
                      </td>
                    </tr>
                  ) : currentList.map((item: any, idx: number) => (
                    <tr key={item.id} data-testid={`row-${tab}-${item.id}`}>
                      <td>{idx + 1}</td>
                      <td className="fw-semibold">{item.name}</td>
                      <td><span className={`badge ${item.isActive ? "bg-success" : "bg-secondary"}`}>{item.isActive ? "Active" : "Inactive"}</span></td>
                      <td>
                        <button className="btn btn-sm btn-outline-primary me-1" onClick={() => openEdit(item)}><i className="bi bi-pencil-fill"></i></button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(item.id)}><i className="bi bi-trash-fill"></i></button>
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
                <h5 className="modal-title">{editing ? "Edit" : "Add"} {tab === "brands" ? "Brand" : "Model"}</h5>
                <button className="btn-close" onClick={() => setShowModal(false)} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label fw-semibold">Name <span className="text-danger">*</span></label>
                  <input className="form-control" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="input-attr-name" />
                </div>
                <div className="form-check form-switch">
                  <input className="form-check-input" type="checkbox" id="attrIsActive" checked={!!form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
                  <label className="form-check-label" htmlFor="attrIsActive">Active</label>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-light" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={!form.name || isSaving} onClick={handleSave} data-testid="btn-save-attr">
                  {isSaving ? "Saving..." : editing ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    
    </>
  );
}
