import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

function BlogModal({ open, onClose, editing, form, setForm, onSave, saving }: any) {
  if (!open) return null;
  return (
    <div className="modal-backdrop-jago">
      <div className="modal-jago" style={{ maxWidth: "600px" }}>
        <div className="modal-jago-header">
          <h5 className="modal-jago-title">{editing ? "Edit Blog Post" : "Add Blog Post"}</h5>
          <button className="modal-jago-close" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>
        <div className="d-flex flex-column gap-3">
          <div>
            <label className="form-label-jago">Title <span className="text-danger">*</span></label>
            <input className="form-control" value={form.title} onChange={e => setForm((f: any) => ({ ...f, title: e.target.value }))} placeholder="Blog post title" data-testid="input-blog-title" />
          </div>
          <div>
            <label className="form-label-jago">Short Description</label>
            <input className="form-control" value={form.shortDesc} onChange={e => setForm((f: any) => ({ ...f, shortDesc: e.target.value }))} placeholder="Short description" />
          </div>
          <div>
            <label className="form-label-jago">Content</label>
            <textarea className="form-control" rows={4} value={form.content} onChange={e => setForm((f: any) => ({ ...f, content: e.target.value }))} placeholder="Blog content..." data-testid="input-blog-content"></textarea>
          </div>
          <div>
            <label className="form-label-jago">Tags</label>
            <input className="form-control" value={form.tags} onChange={e => setForm((f: any) => ({ ...f, tags: e.target.value }))} placeholder="e.g. ride, driver, tips" />
          </div>
          <div className="d-flex gap-2 justify-content-end mt-2">
            <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={onSave} disabled={!form.title || saving} data-testid="btn-save-blog">
              {saving ? "Saving..." : editing ? "Update" : "Publish"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BlogsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ title: "", shortDesc: "", content: "", tags: "" });

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/blogs", { page }],
    queryFn: () => apiRequest("GET", `/api/blogs?page=${page}&limit=10`).then(r => r.json()).then(d => (d && !d.message) ? d : {}),
  });

  const save = useMutation({
    mutationFn: (d: any) => editing
      ? apiRequest("PUT", `/api/blogs/${editing.id}`, d)
      : apiRequest("POST", "/api/blogs", d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/blogs"] });
      toast({ title: editing ? "Blog updated" : "Blog published" });
      setOpen(false); setEditing(null); setForm({ title: "", shortDesc: "", content: "", tags: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/blogs/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/blogs"] }); toast({ title: "Blog deleted" }); },
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/blogs/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/blogs"] }),
  });

  const openCreate = () => { setEditing(null); setForm({ title: "", shortDesc: "", content: "", tags: "" }); setOpen(true); };
  const openEdit = (b: any) => { setEditing(b); setForm({ title: b.title, shortDesc: b.shortDesc || "", content: b.content || "", tags: b.tags || "" }); setOpen(true); };
  const blogs = data?.data || data || [];
  const totalPages = Math.ceil((data?.total || 0) / 10);

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-4">
        <h2 className="fs-22 text-capitalize mb-0" data-testid="page-title">Blog Posts</h2>
        <button className="btn btn-primary" onClick={openCreate} data-testid="btn-add-blog">
          <i className="bi bi-plus-circle me-1"></i> Add Post
        </button>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover">
              <thead className="table-light align-middle text-capitalize">
                <tr>
                  <th>SL</th>
                  <th>Title</th>
                  <th>Tags</th>
                  <th>Published</th>
                  <th>Status</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <tr key={i}>{Array(6).fill(0).map((_, j) => <td key={j}><div style={{ height: "14px", background: "#f1f5f9", borderRadius: "4px" }} /></td>)}</tr>
                  ))
                ) : blogs.length ? (
                  blogs.map((b: any, idx: number) => (
                    <tr key={b.id} data-testid={`blog-row-${b.id}`}>
                      <td>{(page - 1) * 10 + idx + 1}</td>
                      <td>
                        <div className="fw-medium title-color">{b.title}</div>
                        {b.shortDesc && <div className="text-muted fs-12">{b.shortDesc.substring(0, 60)}...</div>}
                      </td>
                      <td>
                        {b.tags ? b.tags.split(",").map((t: string) => (
                          <span key={t} className="badge bg-light text-primary me-1" style={{ border: "1px solid #dbeafe" }}>{t.trim()}</span>
                        )) : "—"}
                      </td>
                      <td className="text-muted fs-12">{new Date(b.createdAt || b.created_at).toLocaleDateString("en-IN")}</td>
                      <td>
                        <label className="switcher">
                          <input type="checkbox" className="switcher_input" checked={b.isActive} onChange={() => toggleStatus.mutate({ id: b.id, isActive: !b.isActive })} data-testid={`toggle-blog-${b.id}`} />
                          <span className="switcher_control"></span>
                        </label>
                      </td>
                      <td className="text-center">
                        <div className="d-flex justify-content-center gap-2">
                          <button className="btn btn-sm btn-outline-primary" onClick={() => openEdit(b)} data-testid={`btn-edit-blog-${b.id}`}><i className="bi bi-pencil-fill"></i></button>
                          <button className="btn btn-sm btn-outline-danger" onClick={async () => { if (await adminConfirm("Delete this blog?")) remove.mutate(b.id); }} data-testid={`btn-delete-blog-${b.id}`}><i className="bi bi-trash-fill"></i></button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={6}>
                    <div className="d-flex flex-column justify-content-center align-items-center gap-2 py-4">
                      <i className="bi bi-newspaper" style={{ fontSize: "2rem", color: "#94a3b8" }}></i>
                      <p className="text-muted mb-0">No blog posts found</p>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="d-flex flex-wrap align-items-center justify-content-end gap-2 mt-3">
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><i className="bi bi-chevron-left"></i></button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map(p => (
                <button key={p} className={`btn btn-sm ${p === page ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}><i className="bi bi-chevron-right"></i></button>
            </div>
          )}
        </div>
      </div>

      <BlogModal open={open} onClose={() => setOpen(false)} editing={editing} form={form} setForm={setForm} onSave={() => save.mutate(form)} saving={save.isPending} />
    </div>
  );
}
