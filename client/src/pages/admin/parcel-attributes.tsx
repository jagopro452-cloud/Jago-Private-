import { useQuery, useMutation } from "@tanstack/react-query";
import { adminFetch, queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

const TABS = [
  { key: "category", label: "Parcel Categories", icon: "bi-tags-fill", color: "#7c3aed", desc: "Types of parcels: Documents, Fragile, Electronics, etc." },
  { key: "weight",   label: "Weight Ranges",     icon: "bi-speedometer2", color: "#1a73e8", desc: "Define weight slabs with extra fare per range" },
  { key: "size",     label: "Size Attributes",   icon: "bi-bounding-box-circles", color: "#16a34a", desc: "Small, Medium, Large parcel size categories" },
];

const CATEGORY_ICONS = ["📦","📄","💻","📱","💍","🍱","🧴","🧸","🔧","📚","🏺","🎁","🛍️","🎵","🧳","🌸"];
const DEFAULT_CATEGORIES = [
  { name: "Documents",    icon: "📄" },
  { name: "Electronics",  icon: "💻" },
  { name: "Fragile",      icon: "🏺" },
  { name: "Food",         icon: "🍱" },
  { name: "Clothing",     icon: "🧳" },
  { name: "General",      icon: "📦" },
];

function AttrModal({ open, onClose, tab, editing, onSave, saving }: any) {
  const isCat = tab === "category";
  const isWt  = tab === "weight";
  const [form, setForm] = useState(() => editing ? {
    name:      editing.name || "",
    icon:      editing.icon || "📦",
    minValue:  editing.minValue || "",
    maxValue:  editing.maxValue || "",
    unit:      editing.unit || (isWt ? "kg" : "cm"),
    extraFare: editing.extraFare || "0",
    isActive:  editing.isActive !== false,
  } : {
    name: "", icon: "📦",
    minValue: "", maxValue: "",
    unit: isWt ? "kg" : "cm",
    extraFare: "0", isActive: true,
  });

  if (!open) return null;
  const f = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  return (
    <div className="modal-backdrop-jago">
      <div className="modal-jago" style={{ maxWidth: 480 }}>
        <div className="modal-jago-header">
          <h5 className="modal-jago-title">
            <i className={`bi ${editing ? "bi-pencil-fill" : "bi-plus-circle-fill"} me-2 text-primary`}></i>
            {editing ? "Edit" : "Add"} {isCat ? "Category" : isWt ? "Weight Range" : "Size Attribute"}
          </h5>
          <button className="modal-jago-close" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>

        <div className="d-flex flex-column gap-3">
          <div>
            <label className="form-label-jago">Name <span className="text-danger">*</span></label>
            <input className="admin-form-control" value={form.name}
              onChange={e => f("name", e.target.value)}
              placeholder={isCat ? "e.g. Fragile Items" : isWt ? "e.g. Heavy (5–10 kg)" : "e.g. Large Package"}
              data-testid="input-attr-name" />
          </div>

          {isCat && (
            <div>
              <label className="form-label-jago">Icon</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {CATEGORY_ICONS.map(ic => (
                  <button key={ic} type="button" onClick={() => f("icon", ic)}
                    style={{ fontSize: 20, padding: "6px 10px", borderRadius: 10, cursor: "pointer",
                      border: `2px solid ${form.icon === ic ? "#7c3aed" : "#e2e8f0"}`,
                      background: form.icon === ic ? "#f5f3ff" : "#f8fafc" }}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isCat && (
            <div className="row g-2 align-items-end">
              <div className="col-4">
                <label className="form-label-jago">Min Value</label>
                <input type="number" min="0" step="0.1" className="admin-form-control"
                  value={form.minValue} onChange={e => f("minValue", e.target.value)}
                  data-testid="input-attr-min" />
              </div>
              <div className="col-4">
                <label className="form-label-jago">Max Value</label>
                <input type="number" min="0" step="0.1" className="admin-form-control"
                  value={form.maxValue} onChange={e => f("maxValue", e.target.value)}
                  data-testid="input-attr-max" />
              </div>
              <div className="col-4">
                <label className="form-label-jago">Unit</label>
                <select className="admin-form-control" value={form.unit} onChange={e => f("unit", e.target.value)}>
                  {isWt
                    ? <><option value="kg">kg</option><option value="g">g</option><option value="lbs">lbs</option></>
                    : <><option value="cm">cm</option><option value="in">in</option><option value="m">m</option></>}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="form-label-jago">Extra Fare (₹)</label>
            <div className="input-group">
              <span className="input-group-text fw-bold">₹</span>
              <input type="number" min="0" step="0.5" className="admin-form-control"
                value={form.extraFare} onChange={e => f("extraFare", e.target.value)}
                placeholder="0.00" data-testid="input-attr-fare" />
            </div>
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 4 }}>Added to base fare when customer selects this attribute</div>
          </div>

          <div className="d-flex align-items-center gap-3">
            <span className="form-label-jago mb-0">Status</span>
            <label className="switcher">
              <input type="checkbox" className="switcher_input" checked={form.isActive}
                onChange={e => f("isActive", e.target.checked)} />
              <span className="switcher_control"></span>
            </label>
            <span style={{ fontSize: 11, fontWeight: 600, color: form.isActive ? "#16a34a" : "#94a3b8" }}>
              {form.isActive ? "Active" : "Inactive"}
            </span>
          </div>

          <div className="d-flex gap-2 justify-content-end pt-2 border-top">
            <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={() => onSave({ ...form, type: tab })}
              disabled={!form.name || saving} data-testid="btn-save-attr">
              {saving
                ? <><span className="spinner-border spinner-border-sm me-2"></span>Saving…</>
                : editing ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ParcelAttributesPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"category" | "weight" | "size">("category");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/parcel-attributes", tab],
    queryFn: () => adminFetch(`/api/parcel-attributes?type=${tab}`).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
  });

  const save = useMutation({
    mutationFn: (d: any) => editing
      ? apiRequest("PUT",  `/api/parcel-attributes/${editing.id}`, d)
      : apiRequest("POST", "/api/parcel-attributes", d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parcel-attributes"] });
      toast({ title: editing ? "Updated successfully" : "Created successfully" });
      setOpen(false); setEditing(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/parcel-attributes/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/parcel-attributes"] }); toast({ title: "Deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: any) => apiRequest("PUT", `/api/parcel-attributes/${id}`, { isActive, type: tab }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/parcel-attributes"] }),
    onError: (e: any) => { queryClient.invalidateQueries({ queryKey: ["/api/parcel-attributes"] }); toast({ title: "Toggle failed", description: e.message, variant: "destructive" }); },
  });

  const seedDefaults = () => DEFAULT_CATEGORIES.forEach((cat, i) =>
    setTimeout(() => save.mutate({ ...cat, type: "category", extraFare: "0", isActive: true } as any), i * 150));

  const items = Array.isArray(data) ? data : [];
  const currentTab = TABS.find(t => t.key === tab)!;

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">Parcel Attributes</h4>
          <div className="text-muted small">Configure parcel types, weight ranges, and size categories for delivery</div>
        </div>
        <div className="d-flex gap-2">
          {tab === "category" && items.length === 0 && !isLoading && (
            <button className="btn btn-outline-secondary btn-sm" onClick={seedDefaults}
              data-testid="btn-seed-defaults">
              <i className="bi bi-magic me-1"></i>Seed Defaults
            </button>
          )}
          <button className="btn btn-primary" onClick={() => { setEditing(null); setOpen(true); }}
            data-testid="btn-add-parcel-attr">
            <i className="bi bi-plus-circle me-1"></i>
            Add {tab === "category" ? "Category" : tab === "weight" ? "Weight Range" : "Size"}
          </button>
        </div>
      </div>

      {/* Tab selector cards */}
      <div className="row g-3 mb-3">
        {TABS.map(t => (
          <div key={t.key} className="col-12 col-md-4" onClick={() => setTab(t.key as any)} style={{ cursor: "pointer" }}>
            <div className="card border-0 shadow-sm" style={{ borderRadius: 14, transition: "all 0.15s",
              border: tab === t.key ? `2px solid ${t.color}` : "2px solid transparent" }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: 44, height: 44, background: t.color + "18", color: t.color, fontSize: "1.1rem" }}>
                  <i className={`bi ${t.icon}`}></i>
                </div>
                <div>
                  <div className="fw-semibold" style={{ fontSize: 13, color: tab === t.key ? t.color : "#0f172a" }}>{t.label}</div>
                  <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{t.desc}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4 d-flex align-items-center gap-2"
          style={{ borderBottom: "1px solid #f1f5f9" }}>
          <i className={`bi ${currentTab.icon}`} style={{ color: currentTab.color }}></i>
          <span className="fw-semibold" style={{ fontSize: 14 }}>{currentTab.label}</span>
          <span className="badge rounded-pill ms-1"
            style={{ background: currentTab.color + "18", color: currentTab.color, fontSize: 10 }}>
            {items.length}
          </span>
        </div>

        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover mb-0">
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  {["#", "Name", tab !== "category" ? "Range" : "Icon", "Extra Fare", "Status", "Active", "Actions"].map((h, i) => (
                    <th key={i} className={i === 0 ? "ps-4" : i === 6 ? "text-center pe-4" : ""}
                      style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", paddingTop: 12, paddingBottom: 12 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? Array(3).fill(0).map((_, i) => (
                  <tr key={i}>{Array(7).fill(0).map((_, j) => (
                    <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>
                  ))}</tr>
                )) : items.length === 0 ? (
                  <tr><td colSpan={7}>
                    <div className="text-center py-5 text-muted">
                      <i className={`bi ${currentTab.icon} fs-1 d-block mb-2`} style={{ opacity: 0.2, color: currentTab.color }}></i>
                      <p className="fw-semibold mb-1">No {currentTab.label.toLowerCase()} yet</p>
                      {tab === "category" && (
                        <button className="btn btn-sm btn-outline-primary mt-1" onClick={seedDefaults}>
                          <i className="bi bi-magic me-1"></i>Add Default Categories
                        </button>
                      )}
                    </div>
                  </td></tr>
                ) : items.map((item: any, idx: number) => (
                  <tr key={item.id} data-testid={`row-attr-${item.id}`}>
                    <td className="ps-4 text-muted small">{idx + 1}</td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                          style={{ width: 36, height: 36, background: currentTab.color + "18", fontSize: 18 }}>
                          {tab === "category"
                            ? (item.icon || "📦")
                            : <i className={`bi ${currentTab.icon}`} style={{ color: currentTab.color, fontSize: 14 }}></i>}
                        </div>
                        <span className="fw-semibold" style={{ fontSize: 13 }}>{item.name}</span>
                      </div>
                    </td>
                    <td>
                      {tab !== "category"
                        ? (item.minValue || item.maxValue)
                          ? <span className="badge bg-light text-dark" style={{ fontSize: 11 }}>
                              {item.minValue || "0"} – {item.maxValue || "∞"} {item.unit || (tab === "weight" ? "kg" : "cm")}
                            </span>
                          : <span className="text-muted small">—</span>
                        : <span style={{ fontSize: 20 }}>{item.icon || "📦"}</span>}
                    </td>
                    <td>
                      <span className="fw-semibold" style={{ fontSize: 13, color: Number(item.extraFare) > 0 ? "#16a34a" : "#94a3b8" }}>
                        {Number(item.extraFare) > 0 ? `+₹${Number(item.extraFare).toFixed(0)}` : "Free"}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${item.isActive ? "bg-success" : "bg-secondary"}`} style={{ fontSize: 10 }}>
                        {item.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <label className="switcher">
                        <input type="checkbox" className="switcher_input" checked={item.isActive}
                          onChange={() => toggle.mutate({ id: item.id, isActive: !item.isActive })}
                          data-testid={`toggle-attr-${item.id}`} />
                        <span className="switcher_control"></span>
                      </label>
                    </td>
                    <td className="text-center pe-4">
                      <div className="d-flex justify-content-center gap-1">
                        <button className="btn btn-sm btn-outline-primary" style={{ borderRadius: 8 }}
                          onClick={() => { setEditing(item); setOpen(true); }}
                          data-testid={`btn-edit-attr-${item.id}`}>
                          <i className="bi bi-pencil-fill"></i>
                        </button>
                        <button className="btn btn-sm btn-outline-danger" style={{ borderRadius: 8 }}
                          onClick={async () => { if (await adminConfirm(`Delete "${item.name}"?`)) remove.mutate(item.id); }}
                          data-testid={`btn-delete-attr-${item.id}`}>
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

      <AttrModal key={`${tab}-${editing?.id || "new"}`}
        open={open} onClose={() => { setOpen(false); setEditing(null); }}
        tab={tab} editing={editing}
        onSave={(d: any) => save.mutate(d)} saving={save.isPending} />
    </div>
  );
}
