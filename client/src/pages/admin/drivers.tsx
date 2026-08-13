import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ImageUploader } from "@/components/image-uploader";
import { AdminDataTable, AdminEmptyState } from "@/pages/admin/components/AdminPrimitives";

const avatarBg = (name: string) => {
  const colors = ["#1a73e8","#16a34a","#d97706","#9333ea","#0891b2","#dc2626","#0ea5e9"];
  return colors[(name || "A").charCodeAt(0) % colors.length];
};
const initials = (name: string) => (name || "?").split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
const VSTATUS: Record<string, { label: string; cls: string; color: string }> = {
  pending:  { label: "Pending", cls: "badge bg-warning text-dark", color: "#d97706" },
  approved: { label: "Approved", cls: "badge bg-success", color: "#16a34a" },
  rejected: { label: "Rejected", cls: "badge bg-danger", color: "#dc2626" },
};

// ── Verify Modal ──────────────────────────────────────────────────────────────
function VerifyModal({ driver, open, onClose }: { driver: any; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [docs, setDocs] = useState({
    licenseImage: driver?.licenseImage || "",
    vehicleImage: driver?.vehicleImage || "",
    profileImage: driver?.profileImage || "",
    licenseNumber: driver?.licenseNumber || "",
    vehicleNumber: driver?.vehicleNumber || "",
    vehicleModel: driver?.vehicleModel || "",
  });
  const [rejectNote, setRejectNote] = useState(driver?.rejectionNote || "");
  const [showRejectForm, setShowRejectForm] = useState(false);

  const saveDocs = useMutation({
    mutationFn: (d: any) => apiRequest("PATCH", `/api/admin/drivers/${driver.id}/documents`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/users"] }); },
    onError: (e: any) => toast({ title: "Failed to save document info", description: e.message, variant: "destructive" }),
  });

  const verify = useMutation({
    mutationFn: (d: any) => apiRequest("PATCH", `/api/drivers/${driver.id}/verify`, d),
    onSuccess: (_, vars: any) => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: vars.status === "approved" ? "✅ Driver approved!" : "❌ Driver rejected" });
      onClose();
    },
  });

  const handleDocChange = (field: string, val: string) => {
    const updated = { ...docs, [field]: val };
    setDocs(updated);
    saveDocs.mutate({ [field]: val });
  };

  if (!open || !driver) return null;
  const name = driver.fullName || driver.firstName || "Driver";
  const vs = VSTATUS[driver.verificationStatus || "pending"] || VSTATUS.pending;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}>
      <div style={{ background: "white", borderRadius: 18, width: "100%", maxWidth: 880, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.25)" }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: "50%", background: avatarBg(name), color: "white", fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {initials(name)}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{name}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{driver.phone} · {driver.email || "—"}</div>
          </div>
          <span className={vs.cls} style={{ marginLeft: 8, fontSize: 11 }}>{vs.label}</span>
          <button onClick={onClose} data-testid="btn-modal-close"
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#94a3b8" }}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* Left: fields */}
          <div style={{ width: 300, borderRight: "1px solid #f1f5f9", padding: "18px 16px", overflowY: "auto", flexShrink: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>Driver Details</div>

            {[
              { label: "License Number", field: "licenseNumber", placeholder: "e.g. DL-0420110012345", icon: "bi-card-text" },
              { label: "Vehicle Number", field: "vehicleNumber", placeholder: "e.g. TS09EP1234", icon: "bi-car-front" },
              { label: "Vehicle Model", field: "vehicleModel", placeholder: "e.g. Honda Activa 6G", icon: "bi-tools" },
            ].map(({ label, field, placeholder, icon }) => (
              <div key={field}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>
                  <i className={`bi ${icon} me-1 text-primary`}></i>{label}
                </label>
                <input className="admin-form-control" style={{ fontSize: 12 }}
                  value={(docs as any)[field]}
                  onChange={e => handleDocChange(field, e.target.value)}
                  placeholder={placeholder}
                  data-testid={`input-driver-${field}`}
                />
              </div>
            ))}

            <div style={{ borderTop: "1px dashed #e2e8f0", paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>Profile Image</div>
              <ImageUploader label="Profile Photo" value={docs.profileImage}
                onChange={url => handleDocChange("profileImage", url)} testId="profile" />
            </div>

            {showRejectForm && (
              <div style={{ background: "#fff5f5", border: "1px solid #fca5a5", borderRadius: 10, padding: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#dc2626", display: "block", marginBottom: 6 }}>
                  Rejection Reason <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <textarea rows={3} className="admin-form-control" style={{ fontSize: 12 }}
                  value={rejectNote} onChange={e => setRejectNote(e.target.value)}
                  placeholder="Explain why the driver is being rejected…"
                  data-testid="input-reject-note" />
              </div>
            )}

            {/* Action buttons */}
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
              {!showRejectForm ? (
                <>
                  <button className="btn btn-success w-100"
                    disabled={verify.isPending}
                    onClick={() => verify.mutate({ status: "approved" })}
                    data-testid="btn-approve-driver">
                    {verify.isPending ? <span className="spinner-border spinner-border-sm me-2"></span> : <i className="bi bi-check-circle-fill me-2"></i>}
                    Approve Driver
                  </button>
                  <button className="btn btn-outline-danger w-100"
                    onClick={() => setShowRejectForm(true)}
                    data-testid="btn-show-reject">
                    <i className="bi bi-x-circle me-2"></i>Reject Driver
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-danger w-100"
                    disabled={!rejectNote || verify.isPending}
                    onClick={() => verify.mutate({ status: "rejected", note: rejectNote })}
                    data-testid="btn-confirm-reject">
                    {verify.isPending ? <span className="spinner-border spinner-border-sm me-2"></span> : <i className="bi bi-x-circle-fill me-2"></i>}
                    Confirm Rejection
                  </button>
                  <button className="btn btn-outline-secondary w-100" onClick={() => setShowRejectForm(false)}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Right: document images */}
          <div style={{ flex: 1, padding: "18px 16px", overflowY: "auto" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 14 }}>Document Uploads</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <ImageUploader label="🪪 Driving License" value={docs.licenseImage}
                onChange={url => handleDocChange("licenseImage", url)} testId="license" />
              <ImageUploader label="🚗 Vehicle Photo" value={docs.vehicleImage}
                onChange={url => handleDocChange("vehicleImage", url)} testId="vehicle" />
            </div>

            {/* Document checklist */}
            <div style={{ marginTop: 20, background: "#f8fafc", borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 10 }}>Verification Checklist</div>
              {[
                { label: "License Number", ok: !!docs.licenseNumber },
                { label: "License Photo", ok: !!docs.licenseImage },
                { label: "Vehicle Number", ok: !!docs.vehicleNumber },
                { label: "Vehicle Photo", ok: !!docs.vehicleImage },
                { label: "Profile Photo", ok: !!docs.profileImage },
              ].map(({ label, ok }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <i className={`bi ${ok ? "bi-check-circle-fill text-success" : "bi-circle text-muted"}`} style={{ fontSize: 14 }}></i>
                  <span style={{ fontSize: 12, color: ok ? "#16a34a" : "#94a3b8", fontWeight: ok ? 600 : 400 }}>{label}</span>
                </div>
              ))}
            </div>

            {driver.rejectionNote && (
              <div style={{ marginTop: 16, background: "#fff5f5", border: "1px solid #fca5a5", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", marginBottom: 4 }}>
                  <i className="bi bi-exclamation-triangle-fill me-1"></i>Previous Rejection Note
                </div>
                <div style={{ fontSize: 12, color: "#7f1d1d" }}>{driver.rejectionNote}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Drivers() {
  const [search, setSearch] = useState("");
  const [verifyTab, setVerifyTab] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [page, setPage] = useState(1);
  const [verifyTarget, setVerifyTarget] = useState<any>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
    vehicleNumber: "",
    vehicleModel: "",
    licenseNumber: "",
  });
  const { toast } = useToast();
  const qc = useQueryClient();

  const normalizedPhone = form.phone.replace(/\D/g, "");
  const emailLooksValid = !form.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());

  const addDriver = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/drivers", {
      fullName: form.fullName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      password: form.password,
      vehicleNumber: form.vehicleNumber.trim(),
      vehicleModel: form.vehicleModel.trim(),
      licenseNumber: form.licenseNumber.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Driver added successfully" });
      setShowAdd(false);
      setForm({ fullName: "", phone: "", email: "", password: "", confirmPassword: "", vehicleNumber: "", vehicleModel: "", licenseNumber: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canSubmitDriver =
    form.fullName.trim().length > 0 &&
    normalizedPhone.length >= 10 &&
    emailLooksValid &&
    form.password.length >= 8 &&
    form.password === form.confirmPassword &&
    !addDriver.isPending;

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/users", { userType: "driver", search, page, verificationStatus: verifyTab }],
    queryFn: () => {
      const params = new URLSearchParams({ userType: "driver", page: String(page), limit: "50" });
      if (search) params.set("search", search);
      if (verifyTab !== "all") params.set("verificationStatus", verifyTab);
      return adminFetch(`/api/users?${params}`).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => d?.data ? d : { data: Array.isArray(d) ? d : [], total: 0 });
    },
  });

  useEffect(() => {
    setPage(1);
  }, [search, verifyTab]);

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: any) => apiRequest("PATCH", `/api/users/${id}/status`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/users"] }),
  });

  const drivers: any[] = Array.isArray(data?.data) ? data.data : [];
  const summary = data?.summary || {};
  const totalDrivers = Number(summary.total ?? data?.total ?? drivers.length);
  const pendingCount = Number(summary.pending ?? 0);
  const approvedCount = Number(summary.approved ?? 0);
  const rejectedCount = Number(summary.rejected ?? 0);
  const totalRows = Number(data?.total ?? drivers.length);
  const totalPages = Math.max(1, Math.ceil(totalRows / 50));
  const firstRow = totalRows === 0 ? 0 : (page - 1) * 50 + 1;
  const lastRow = Math.min(page * 50, totalRows);

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">Driver Management</h4>
          <div className="text-muted small">Onboarding, verification, and driver administration</div>
        </div>
        <button className="btn btn-primary btn-sm d-flex align-items-center gap-1"
          onClick={() => setShowAdd(true)} data-testid="btn-add-driver">
          <i className="bi bi-person-plus-fill"></i> Add Driver
        </button>
      </div>

      {showAdd && (
        <div className="modal show d-block" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content border-0 shadow-lg" style={{ borderRadius: 16 }}>
              <div className="modal-header border-0 pb-0">
                <h5 className="modal-title fw-bold">Add New Driver (JAGO Pilot)</h5>
                <button className="btn-close" onClick={() => setShowAdd(false)}></button>
              </div>
              <div className="modal-body px-4 pb-4">
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label fw-semibold small">Full Name <span className="text-danger">*</span></label>
                    <input className="form-control" placeholder="e.g. Suresh Reddy"
                      value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                      data-testid="input-driver-name" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold small">Phone Number <span className="text-danger">*</span></label>
                    <input className="form-control" placeholder="+91 9876543210" type="tel"
                      value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      data-testid="input-driver-phone" />
                    {form.phone && normalizedPhone.length < 10 && (
                      <div className="text-danger small mt-1">Enter a valid 10-digit phone number</div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold small">Email <span className="text-muted">(optional)</span></label>
                    <input className="form-control" placeholder="suresh@example.com" type="email"
                      value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      data-testid="input-driver-email" />
                    {form.email && !emailLooksValid && (
                      <div className="text-danger small mt-1">Enter a valid email address</div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold small">Login Password <span className="text-danger">*</span></label>
                    <input className="form-control" placeholder="Minimum 8 characters" type="password"
                      value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      data-testid="input-driver-password" />
                    {form.password && form.password.length < 8 && (
                      <div className="text-danger small mt-1">Password must be at least 8 characters</div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold small">Confirm Password <span className="text-danger">*</span></label>
                    <input className="form-control" placeholder="Re-enter password" type="password"
                      value={form.confirmPassword} onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                      data-testid="input-driver-confirm-password" />
                    {form.confirmPassword && form.password !== form.confirmPassword && (
                      <div className="text-danger small mt-1">Passwords do not match</div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold small">License Number</label>
                    <input className="form-control" placeholder="e.g. AP1234567890"
                      value={form.licenseNumber} onChange={e => setForm(f => ({ ...f, licenseNumber: e.target.value }))}
                      data-testid="input-driver-license" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold small">Vehicle Number</label>
                    <input className="form-control" placeholder="e.g. TS 09 AB 1234"
                      value={form.vehicleNumber} onChange={e => setForm(f => ({ ...f, vehicleNumber: e.target.value }))}
                      data-testid="input-driver-vehicle-number" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold small">Vehicle Model</label>
                    <input className="form-control" placeholder="e.g. Honda Activa, TVS Jupiter"
                      value={form.vehicleModel} onChange={e => setForm(f => ({ ...f, vehicleModel: e.target.value }))}
                      data-testid="input-driver-vehicle-model" />
                  </div>
                </div>
                <div className="alert alert-info mt-3 mb-0 py-2" style={{ fontSize: 12, borderRadius: 8 }}>
                  <i className="bi bi-info-circle me-1"></i>
                  Driver will be added with <strong>Pending Verification</strong> status and a password login. Upload documents and approve from the driver list.
                </div>
                <div className="d-flex gap-2 mt-4">
                  <button className="btn btn-light flex-1" onClick={() => setShowAdd(false)}>Cancel</button>
                  <button className="btn btn-primary flex-1"
                    disabled={!canSubmitDriver}
                    onClick={() => addDriver.mutate()}
                    data-testid="btn-save-driver">
                    {addDriver.isPending ? "Saving…" : "Add Driver"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="row g-3 mb-3">
        {[
          { label: "Total Drivers", val: totalDrivers, icon: "bi-people-fill", color: "#1a73e8", bg: "#e8f0fe" },
          { label: "Pending Verification", val: pendingCount, icon: "bi-hourglass-split", color: "#d97706", bg: "#fefce8", alert: pendingCount > 0 },
          { label: "Approved", val: approvedCount, icon: "bi-check-circle-fill", color: "#16a34a", bg: "#f0fdf4" },
          { label: "Rejected", val: rejectedCount, icon: "bi-x-circle-fill", color: "#dc2626", bg: "#fff5f5" },
        ].map((s, i) => (
          <div key={i} className="col-6 col-xl-3" style={{ cursor: "pointer" }}
            onClick={() => { if (i === 1) setVerifyTab("pending"); else if (i === 2) setVerifyTab("approved"); else if (i === 3) setVerifyTab("rejected"); else setVerifyTab("all"); }}>
            <div className="card border-0 shadow-sm" style={{ borderRadius: 14, border: s.alert ? `2px solid ${s.color}` : undefined }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: 44, height: 44, background: s.bg, color: s.color, fontSize: "1.1rem" }}>
                  <i className={`bi ${s.icon}`}></i>
                </div>
                <div>
                  <div className="fw-bold lh-1 mb-1" style={{ fontSize: 22, color: s.color }}>
                    {isLoading ? "—" : s.val}
                  </div>
                  <div className="text-muted small">{s.label}</div>
                </div>
                {s.alert && s.val > 0 && (
                  <div className="ms-auto">
                    <span className="badge bg-warning text-dark rounded-pill" style={{ fontSize: 9 }}>Action needed</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4 d-flex align-items-center justify-content-between flex-wrap gap-2"
          style={{ borderBottom: "1px solid #f1f5f9" }}>
          <ul className="nav nav--tabs p-1 rounded bg-light">
            {([
              ["all", "All Drivers", totalDrivers],
              ["pending", "Pending Verification", pendingCount],
              ["approved", "Approved", approvedCount],
              ["rejected", "Rejected", rejectedCount],
            ] as const).map(([val, label, cnt]) => (
              <li key={val} className="nav-item">
                <button className={`nav-link${verifyTab === val ? " active" : ""}`}
                  onClick={() => setVerifyTab(val)} data-testid={`tab-driver-${val}`}>
                  {label}
                  {cnt > 0 && <span className="ms-1 badge rounded-pill"
                    style={{ background: verifyTab === val ? "rgba(255,255,255,0.3)" : "#e2e8f0", color: verifyTab === val ? "white" : "#475569", fontSize: 9 }}>
                    {cnt}
                  </span>}
                </button>
              </li>
            ))}
          </ul>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "6px 12px" }}>
            <i className="bi bi-search" style={{ fontSize: 12, color: "#94a3b8" }}></i>
            <input style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, width: 200 }}
              placeholder="Search drivers..." value={search} onChange={e => setSearch(e.target.value)}
              data-testid="input-driver-search" />
          </div>
        </div>

        <div className="card-body p-0">
          <AdminDataTable minWidth={1080} aria-label="Drivers list">
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  {["#","Driver","Contact","Vehicle Info","Documents","Rating","Status","Verification","Action"].map((h, i) => (
                    <th key={i} className={i === 0 ? "ps-4" : i === 8 ? "text-center pe-4" : ""}
                      style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", paddingTop: 12, paddingBottom: 12 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(4).fill(0).map((_, i) => (
                    <tr key={i}>{Array(9).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                  ))
                ) : drivers.length === 0 ? (
                  <tr><td colSpan={9}>
                    <AdminEmptyState icon="bi-people" title="No drivers found" />
                  </td></tr>
                ) : drivers.map((driver: any, idx: number) => {
                  const name = driver.fullName || `${driver.firstName || ""} ${driver.lastName || ""}`.trim() || "Driver";
                  const vs = VSTATUS[driver.verificationStatus || "pending"] || VSTATUS.pending;
                  const docsCount = [driver.licenseImage, driver.vehicleImage, driver.profileImage, driver.licenseNumber, driver.vehicleNumber].filter(Boolean).length;
                  return (
                    <tr key={driver.id} data-testid={`row-driver-${driver.id}`}>
                      <td className="ps-4 text-muted small">{(page - 1) * 50 + idx + 1}</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0 position-relative"
                            style={{ width: 38, height: 38, background: avatarBg(name), color: "white", fontSize: 13, fontWeight: 700 }}>
                            {driver.profileImage ? (
                              <img src={driver.profileImage} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover" }}
                                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            ) : initials(name)}
                          </div>
                          <div>
                            <div className="fw-semibold" style={{ fontSize: 13 }}>{name}</div>
                            <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{driver.email || "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: 12, color: "#64748b" }}>
                        {driver.phone || "—"}
                      </td>
                      <td>
                        {driver.vehicleNumber ? (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{driver.vehicleNumber}</div>
                            <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{driver.vehicleModel || "—"}</div>
                          </div>
                        ) : <span className="text-muted small">—</span>}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ width: 60, height: 5, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${(docsCount / 5) * 100}%`, background: docsCount >= 4 ? "#16a34a" : docsCount >= 2 ? "#d97706" : "#ef4444", borderRadius: 4 }} />
                          </div>
                          <span style={{ fontSize: 10, color: "#64748b" }}>{docsCount}/5</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#d97706" }}>
                          ⭐ {parseFloat(driver.rating || "5.0").toFixed(1)}
                        </div>
                      </td>
                      <td>
                        <label className="switcher">
                          <input type="checkbox" className="switcher_input" checked={driver.isActive}
                            onChange={() => toggleActive.mutate({ id: driver.id, isActive: !driver.isActive })}
                            data-testid={`toggle-driver-${driver.id}`} />
                          <span className="switcher_control"></span>
                        </label>
                      </td>
                      <td>
                        <span className={vs.cls} style={{ fontSize: 10 }}>{vs.label}</span>
                      </td>
                      <td className="text-center pe-4">
                        <button className="btn btn-sm"
                          style={{ borderRadius: 8, fontSize: 11,
                            background: driver.verificationStatus === "pending" ? "#fef3c7" : "#f1f5f9",
                            color: driver.verificationStatus === "pending" ? "#d97706" : "#64748b",
                            border: `1px solid ${driver.verificationStatus === "pending" ? "#fde047" : "#e2e8f0"}`,
                          }}
                          onClick={() => setVerifyTarget(driver)}
                          data-testid={`btn-verify-${driver.id}`}>
                          <i className="bi bi-shield-check me-1"></i>
                          {driver.verificationStatus === "approved" ? "View" : "Verify"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
          </AdminDataTable>
          <div className="d-flex align-items-center justify-content-between px-4 py-3 border-top flex-wrap gap-2">
            <div className="text-muted small">
              Showing {firstRow}-{lastRow} of {totalRows} drivers
            </div>
            <div className="d-flex align-items-center gap-2">
              <button className="btn btn-sm btn-light"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                data-testid="btn-drivers-prev">
                Previous
              </button>
              <span className="small text-muted">Page {page} of {totalPages}</span>
              <button className="btn btn-sm btn-light"
                disabled={page >= totalPages || isLoading}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                data-testid="btn-drivers-next">
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {verifyTarget && (
        <VerifyModal driver={verifyTarget} open={!!verifyTarget} onClose={() => setVerifyTarget(null)} />
      )}
    </div>
  );
}
