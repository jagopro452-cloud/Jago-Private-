import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { ImageUploader } from "@/components/image-uploader";
import { adminConfirm } from "./components/AdminPrimitives";

export default function BannersPage() {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ title: "", imageUrl: "", redirectUrl: "", zone: "", isActive: true });

  const { data, isLoading } = useQuery<any[]>({ queryKey: ["/api/banners"] });
  const banners = Array.isArray(data) ? data : [];

  const saveMutation = useMutation({
    mutationFn: (payload: any) =>
      editing
        ? apiRequest("PUT", `/api/banners/${editing.id}`, payload)
        : apiRequest("POST", "/api/banners", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/banners"] });
      setShowModal(false);
      toast({ title: editing ? "Banner updated" : "Banner created" });
      setEditing(null);
      setForm({ title: "", imageUrl: "", redirectUrl: "", zone: "", isActive: true });
    },
    onError: (e: any) => toast({ title: "Failed to save banner", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/banners/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/banners"] });
      toast({ title: "Banner deleted" });
    },
    onError: (e: any) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: any) => apiRequest("PUT", `/api/banners/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/banners"] }),
    onError: (e: any) => { queryClient.invalidateQueries({ queryKey: ["/api/banners"] }); toast({ title: "Toggle failed", description: e.message, variant: "destructive" }); },
  });

  const openEdit = (b: any) => {
    setEditing(b);
    setForm({ title: b.title, imageUrl: b.imageUrl || "", redirectUrl: b.redirectUrl || "", zone: b.zone || "", isActive: b.isActive });
    setShowModal(true);
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ title: "", imageUrl: "", redirectUrl: "", zone: "", isActive: true });
    setShowModal(true);
  };

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
            <h2 className="h5 mb-0">Banner Setup</h2>
            <button className="btn btn-primary btn-sm" onClick={openAdd} data-testid="btn-add-banner">
              <i className="bi bi-plus me-1"></i>Add Banner
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
                    <th>Image</th>
                    <th>Title</th>
                    <th>Zone</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={6} className="text-center py-4"><div className="spinner-border spinner-border-sm" role="status" /></td></tr>
                  ) : banners.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-5 text-muted">
                        <i className="bi bi-flag-fill fs-2 d-block mb-2 opacity-25"></i>
                        No banners found. Click Add Banner to create one.
                      </td>
                    </tr>
                  ) : banners.map((b: any, idx: number) => (
                    <tr key={b.id} data-testid={`row-banner-${b.id}`}>
                      <td>{idx + 1}</td>
                      <td>
                        {b.imageUrl ? (
                          <img src={b.imageUrl} alt={b.title}
                            style={{ width: 80, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid #e2e8f0" }}
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <div style={{ width: 80, height: 44, borderRadius: 6, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <i className="bi bi-image text-muted"></i>
                          </div>
                        )}
                      </td>
                      <td className="fw-semibold">{b.title}</td>
                      <td>{b.zone || "All Zones"}</td>
                      <td>
                        <label className="switcher">
                          <input
                            className="switcher_input"
                            type="checkbox"
                            checked={b.isActive}
                            onChange={(e) => toggleMutation.mutate({ id: b.id, isActive: e.target.checked })}
                            data-testid={`toggle-banner-${b.id}`}
                          />
                          <span className="switcher_control"></span>
                        </label>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-outline-primary me-1" onClick={() => openEdit(b)} data-testid={`btn-edit-banner-${b.id}`}>
                          <i className="bi bi-pencil-fill"></i>
                        </button>
                        <button
                          className="btn btn-sm btn-outline-danger"
                          onClick={async () => { if (await adminConfirm("Delete this banner?")) deleteMutation.mutate(b.id); }}
                          data-testid={`btn-delete-banner-${b.id}`}
                        >
                          <i className="bi bi-trash-fill"></i>
                        </button>
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
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{editing ? "Edit Banner" : "Add Banner"}</h5>
                <button className="btn-close" onClick={() => setShowModal(false)} />
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label fw-semibold">Banner Title <span className="text-danger">*</span></label>
                    <input
                      className="form-control"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="Enter banner title"
                      data-testid="input-banner-title"
                    />
                  </div>
                  <div className="col-12">
                    <ImageUploader
                      label="Banner Image"
                      value={form.imageUrl}
                      onChange={url => setForm(f => ({ ...f, imageUrl: url }))}
                      testId="banner"
                      height={160}
                    />
                    <div className="mt-2">
                      <label className="form-label small text-muted">Or paste image URL</label>
                      <input
                        className="form-control form-control-sm"
                        value={form.imageUrl}
                        onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                        placeholder="https://..."
                        data-testid="input-banner-image"
                      />
                    </div>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Redirect URL</label>
                    <input
                      className="form-control"
                      value={form.redirectUrl}
                      onChange={(e) => setForm({ ...form, redirectUrl: e.target.value })}
                      placeholder="https://..."
                      data-testid="input-banner-redirect"
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Zone</label>
                    <input
                      className="form-control"
                      value={form.zone}
                      onChange={(e) => setForm({ ...form, zone: e.target.value })}
                      placeholder="All Zones or specific zone name"
                      data-testid="input-banner-zone"
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-light" onClick={() => setShowModal(false)}>Cancel</button>
                <button
                  className="btn btn-primary"
                  disabled={!form.title || saveMutation.isPending}
                  onClick={() => saveMutation.mutate(form)}
                  data-testid="btn-banner-save"
                >
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
