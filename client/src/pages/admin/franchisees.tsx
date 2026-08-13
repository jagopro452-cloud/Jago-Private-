import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, adminFetch } from "@/lib/queryClient";
import { useState, useMemo, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

// ── helpers ──────────────────────────────────────────────────────────────────
const avatarBg = (name: string) => {
  const colors = ["#1a73e8","#16a34a","#d97706","#9333ea","#0891b2","#dc2626","#0f766e","#b45309"];
  return colors[(name || "A").charCodeAt(0) % colors.length];
};
const initials = (name: string) =>
  (name || "?").split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
const fmt = (n: any) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (d: any) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-");
  return new Date(+y, +mo - 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
};
function commissionPreview(fr: any, fare = 200) {
  if (fr.commission_type === "flat") return Number(fr.commission_flat || 0);
  return fare * Number(fr.commission_percent || 0) / 100;
}
function getAdminToken() {
  try { return JSON.parse(localStorage.getItem("jago-admin") || "{}").token || ""; } catch { return ""; }
}

// ── Avatar component (shows photo or initials) ────────────────────────────
function FrAvatar({ fr, size = 40, fontSize = 14 }: { fr: any; size?: number; fontSize?: number }) {
  if (fr.photo_url) {
    return (
      <img
        src={fr.photo_url}
        alt={fr.name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "2px solid #fff", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}
      />
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: avatarBg(fr.name), display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize, flexShrink: 0, border: "2px solid #fff", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>
      {initials(fr.name)}
    </div>
  );
}

// ── Photo upload widget ───────────────────────────────────────────────────
function PhotoUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${getAdminToken()}` },
        body: fd,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      onChange(data.url);
    } catch {
      alert("Photo upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="d-flex align-items-center gap-3">
      <div
        style={{ width: 90, height: 90, borderRadius: "50%", border: "2px dashed #7c3aed", cursor: "pointer", overflow: "hidden", flexShrink: 0, background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <span className="spinner-border spinner-border-sm" style={{ color: "#7c3aed" }}></span>
        ) : value ? (
          <img src={value} alt="photo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div className="text-center" style={{ color: "#7c3aed", fontSize: 12 }}>
            <i className="bi bi-camera fs-4 d-block"></i>Upload
          </div>
        )}
        <div style={{ position: "absolute", bottom: 0, right: 0, background: "#7c3aed", borderRadius: "50%", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <i className="bi bi-pencil-fill text-white" style={{ fontSize: 10 }}></i>
        </div>
      </div>
      <div>
        <div className="fw-semibold" style={{ fontSize: 14 }}>Owner / Contact Photo</div>
        <div className="text-muted" style={{ fontSize: 12 }}>Click to upload. JPG/PNG, max 5MB.</div>
        {value && (
          <button className="btn btn-sm btn-link text-danger p-0 mt-1" style={{ fontSize: 12 }} onClick={() => onChange("")}>
            <i className="bi bi-trash me-1"></i>Remove photo
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────
type FormState = {
  name: string; ownerName: string; email: string; password: string; phone: string;
  whatsapp: string; altContactName: string; altContactPhone: string;
  zoneId: string; isActive: boolean; photoUrl: string;
  franchiseType: string; serviceAreaDesc: string; website: string;
  commissionType: "percentage" | "flat"; commissionPercent: string; commissionFlat: string;
  minGuaranteed: string; payoutCycle: string;
  address: string; city: string; state: string; pincode: string;
  gstNumber: string; panNumber: string;
  bankName: string; bankAccount: string; bankIfsc: string; bankHolderName: string;
  agreementDate: string; contractEndDate: string; notes: string;
};

const emptyForm: FormState = {
  name: "", ownerName: "", email: "", password: "", phone: "", whatsapp: "",
  altContactName: "", altContactPhone: "", zoneId: "", isActive: true, photoUrl: "",
  franchiseType: "area", serviceAreaDesc: "", website: "",
  commissionType: "percentage", commissionPercent: "", commissionFlat: "",
  minGuaranteed: "", payoutCycle: "monthly",
  address: "", city: "", state: "Telangana", pincode: "", gstNumber: "", panNumber: "",
  bankName: "", bankAccount: "", bankIfsc: "", bankHolderName: "",
  agreementDate: "", contractEndDate: "", notes: "",
};

const FORM_TABS = ["Profile", "Commission", "Contact & Docs", "Banking", "Contract"] as const;
type FormTab = typeof FORM_TABS[number];

const DETAIL_TABS = ["Overview", "Monthly", "Drivers", "Payouts", "Services"] as const;
type DetailTab = typeof DETAIL_TABS[number];

export default function FranchiseesPage() {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [viewingFr, setViewingFr] = useState<any>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formTab, setFormTab] = useState<FormTab>("Profile");
  const [detailTab, setDetailTab] = useState<DetailTab>("Overview");
  const [search, setSearch] = useState("");
  const [filterZone, setFilterZone] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showPayoutForm, setShowPayoutForm] = useState(false);
  const [payoutForm, setPayoutForm] = useState({ amount: "", periodStart: "", periodEnd: "", paymentMethod: "bank_transfer", paymentRef: "", notes: "" });

  const f = (k: keyof FormState, v: any) => setForm(p => ({ ...p, [k]: v }));

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/franchisees"],
    queryFn: () => adminFetch("/api/admin/franchisees").then(r => r.ok ? r.json() : r.json().then((d: any) => { throw new Error(d?.message || "Error") })).then((d: any) => Array.isArray(d) ? d : []),
    refetchInterval: 30000,
  });
  const { data: zones = [] } = useQuery<any[]>({
    queryKey: ["/api/zones"],
    queryFn: () => adminFetch("/api/zones").then(r => r.ok ? r.json() : r.json().then((d: any) => { throw new Error(d?.message || "Error") })).then((d: any) => Array.isArray(d) ? d : (d?.data ? d.data : [])),
  });
  const { data: detailStats } = useQuery<any>({
    queryKey: ["/api/admin/franchisees", viewingFr?.id, "stats"],
    queryFn: () => adminFetch(`/api/admin/franchisees/${viewingFr.id}/stats`).then(r => r.json()),
    enabled: !!viewingFr?.id && detailTab === "Overview",
  });
  const { data: monthlyData = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/franchisees", viewingFr?.id, "monthly"],
    queryFn: () => adminFetch(`/api/admin/franchisees/${viewingFr.id}/monthly`).then(r => r.json()),
    enabled: !!viewingFr?.id && detailTab === "Monthly",
  });
  const { data: driversData = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/franchisees", viewingFr?.id, "drivers"],
    queryFn: () => adminFetch(`/api/admin/franchisees/${viewingFr.id}/drivers`).then(r => r.json()),
    enabled: !!viewingFr?.id && detailTab === "Drivers",
  });
  const { data: payoutsData = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/franchisees", viewingFr?.id, "payouts"],
    queryFn: () => adminFetch(`/api/admin/franchisees/${viewingFr.id}/payouts`).then(r => r.json()),
    enabled: !!viewingFr?.id && detailTab === "Payouts",
  });
  const { data: servicesData } = useQuery<any>({
    queryKey: ["/api/admin/franchisees", viewingFr?.id, "services"],
    queryFn: () => adminFetch(`/api/admin/franchisees/${viewingFr.id}/services`).then(r => r.json()),
    enabled: !!viewingFr?.id && detailTab === "Services",
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (payload: any) =>
      editing ? apiRequest("PUT", `/api/admin/franchisees/${editing.id}`, payload) : apiRequest("POST", "/api/admin/franchisees", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/franchisees"] });
      toast({ title: editing ? "Franchise updated" : "Franchise created successfully" });
      setShowModal(false); setEditing(null); setForm(emptyForm); setFormTab("Profile");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/franchisees/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/franchisees"] }); toast({ title: "Franchise deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: any) => apiRequest("PUT", `/api/admin/franchisees/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/franchisees"] }),
    onError: (e: any) => { queryClient.invalidateQueries({ queryKey: ["/api/admin/franchisees"] }); toast({ title: "Toggle failed", description: e.message, variant: "destructive" }); },
  });
  const payoutMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", `/api/admin/franchisees/${viewingFr.id}/payouts`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/franchisees", viewingFr.id, "payouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/franchisees"] });
      toast({ title: "Payout recorded" });
      setShowPayoutForm(false);
      setPayoutForm({ amount: "", periodStart: "", periodEnd: "", paymentMethod: "bank_transfer", paymentRef: "", notes: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const serviceToggleMutation = useMutation({
    mutationFn: ({ franchiseId, serviceKey, isEnabled }: any) => apiRequest("PUT", `/api/admin/franchisees/${franchiseId}/services/${serviceKey}`, { isEnabled }),
    onSuccess: () => {
      if (!viewingFr?.id) return;
      queryClient.invalidateQueries({ queryKey: ["/api/admin/franchisees", viewingFr.id, "services"] });
      toast({ title: "Franchise service updated" });
    },
    onError: (e: any) => toast({ title: "Service update failed", description: e.message, variant: "destructive" }),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(emptyForm); setFormTab("Profile"); setShowModal(true); };
  const openEdit = (fr: any) => {
    setEditing(fr);
    setForm({
      name: fr.name || "", ownerName: fr.owner_name || "", email: fr.email || "", password: "",
      phone: fr.phone || "", whatsapp: fr.whatsapp || "",
      altContactName: fr.alt_contact_name || "", altContactPhone: fr.alt_contact_phone || "",
      zoneId: fr.zone_id || "", isActive: fr.is_active, photoUrl: fr.photo_url || "",
      franchiseType: fr.franchise_type || "area", serviceAreaDesc: fr.service_area_desc || "", website: fr.website || "",
      commissionType: fr.commission_type === "flat" ? "flat" : "percentage",
      commissionPercent: String(fr.commission_percent || ""),
      commissionFlat: String(fr.commission_flat || ""),
      minGuaranteed: String(fr.min_guaranteed || ""),
      payoutCycle: fr.payout_cycle || "monthly",
      address: fr.address || "", city: fr.city || "", state: fr.state || "Telangana", pincode: fr.pincode || "",
      gstNumber: fr.gst_number || "", panNumber: fr.pan_number || "",
      bankName: fr.bank_name || "", bankAccount: fr.bank_account || "", bankIfsc: fr.bank_ifsc || "", bankHolderName: fr.bank_holder_name || "",
      agreementDate: fr.agreement_date?.substring(0, 10) || "",
      contractEndDate: fr.contract_end_date?.substring(0, 10) || "",
      notes: fr.notes || "",
    });
    setFormTab("Profile"); setShowModal(true);
  };
  const openDetail = (fr: any) => { setViewingFr(fr); setDetailTab("Overview"); setShowPayoutForm(false); };

  const handleSave = () => {
    if (!form.name || !form.ownerName || !form.email) {
      toast({ title: "Required fields missing", description: "Name, Owner Name and Email are required", variant: "destructive" }); return;
    }
    if (!editing && !form.password) {
      toast({ title: "Password required", description: "Set a login password for this franchise account", variant: "destructive" }); return;
    }
    saveMutation.mutate({
      name: form.name, ownerName: form.ownerName, email: form.email,
      password: form.password || undefined, phone: form.phone || undefined,
      whatsapp: form.whatsapp || undefined, altContactName: form.altContactName || undefined,
      altContactPhone: form.altContactPhone || undefined, zoneId: form.zoneId || undefined,
      isActive: form.isActive, photoUrl: form.photoUrl || undefined,
      franchiseType: form.franchiseType, serviceAreaDesc: form.serviceAreaDesc || undefined,
      website: form.website || undefined,
      commissionType: form.commissionType,
      commissionPercent: form.commissionType === "percentage" ? parseFloat(form.commissionPercent) || 0 : 0,
      commissionFlat: form.commissionType === "flat" ? parseFloat(form.commissionFlat) || 0 : 0,
      minGuaranteed: parseFloat(form.minGuaranteed) || 0, payoutCycle: form.payoutCycle,
      address: form.address || undefined, city: form.city || undefined, state: form.state || undefined, pincode: form.pincode || undefined,
      gstNumber: form.gstNumber || undefined, panNumber: form.panNumber || undefined,
      bankName: form.bankName || undefined, bankAccount: form.bankAccount || undefined, bankIfsc: form.bankIfsc || undefined, bankHolderName: form.bankHolderName || undefined,
      agreementDate: form.agreementDate || undefined, contractEndDate: form.contractEndDate || undefined,
      notes: form.notes || undefined,
    });
  };

  // ── Derived data ──────────────────────────────────────────────────────────
  const franchisees = Array.isArray(data) ? data : [];
  const zonesArr = Array.isArray(zones) ? zones : [];
  const filtered = useMemo(() => franchisees.filter(fr => {
    const q = search.toLowerCase();
    const matchSearch = !search || [fr.name, fr.owner_name, fr.email, fr.phone, fr.city, fr.franchise_type].some(v => (v || "").toLowerCase().includes(q));
    const matchZone = !filterZone || fr.zone_id === filterZone;
    const matchCity = !filterCity || String(fr.city || "").toLowerCase() === filterCity.toLowerCase();
    const matchStatus = filterStatus === "all" || (filterStatus === "active" ? fr.is_active : !fr.is_active);
    return matchSearch && matchZone && matchCity && matchStatus;
  }), [franchisees, search, filterZone, filterCity, filterStatus]);

  const cityOptions = useMemo(() => {
    const cities = new Set<string>();
    franchisees.forEach((fr: any) => {
      const city = String(fr.city || "").trim();
      if (city) cities.add(city);
    });
    return Array.from(cities).sort((a, b) => a.localeCompare(b));
  }, [franchisees]);

  const totalEarnings = franchisees.reduce((s, x) => s + Number(x.total_earnings || 0), 0);
  const totalPaidOut = franchisees.reduce((s, x) => s + Number(x.total_paid_out_actual || 0), 0);
  const pendingAmount = (fr: any) => Math.max(0, Number(fr.total_earnings || 0) - Number(fr.total_paid_out_actual || 0));
  const contractDaysLeft = (fr: any) => {
    if (!fr.contract_end_date) return null;
    return Math.ceil((new Date(fr.contract_end_date).getTime() - Date.now()) / 86400000);
  };
  const previewComm = form.commissionType === "flat"
    ? parseFloat(form.commissionFlat) || 0
    : 200 * (parseFloat(form.commissionPercent) || 0) / 100;

  return (
    <div className="p-4">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
        <div>
          <h4 className="mb-0 fw-bold" style={{ color: "#1a1a2e" }}>
            <i className="bi bi-building me-2" style={{ color: "#7c3aed" }}></i>Franchise Management
          </h4>
          <small className="text-muted">Zone-wise franchise partners — profiles, commissions, payouts</small>
        </div>
        <button className="btn px-3 py-2 fw-semibold text-white" style={{ background: "#7c3aed", borderRadius: 8 }} onClick={openCreate}>
          <i className="bi bi-plus-lg me-1"></i>Add Franchise
        </button>
      </div>

      {/* Summary */}
      <div className="row g-3 mb-4">
        {[
          { label: "Total Franchises", val: franchisees.length, sub: `${franchisees.filter(f => f.is_active).length} active`, icon: "bi-building", color: "#7c3aed" },
          { label: "Total Zone Trips", val: fmt(franchisees.reduce((s, x) => s + Number(x.total_trips || 0), 0)), sub: "completed", icon: "bi-car-front-fill", color: "#1a73e8" },
          { label: "Total Commission Earned", val: `₹${fmt(totalEarnings)}`, sub: "all franchises combined", icon: "bi-currency-rupee", color: "#16a34a" },
          { label: "Pending Payouts", val: `₹${fmt(totalEarnings - totalPaidOut)}`, sub: `₹${fmt(totalPaidOut)} paid out`, icon: "bi-clock-history", color: totalEarnings - totalPaidOut > 0 ? "#d97706" : "#64748b" },
        ].map(c => (
          <div className="col-6 col-md-3" key={c.label}>
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 12 }}>
              <div className="card-body p-3 d-flex align-items-center gap-3">
                <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: 44, height: 44, background: c.color + "18" }}>
                  <i className={`${c.icon} fs-5`} style={{ color: c.color }}></i>
                </div>
                <div>
                  <div className="fw-bold fs-5">{c.val}</div>
                  <div className="text-muted small">{c.label}</div>
                  <div style={{ fontSize: 11, color: c.color }}>{c.sub}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 12 }}>
        <div className="card-body p-3">
          <div className="row g-2 align-items-center">
            <div className="col-md-5">
              <div className="input-group">
                <span className="input-group-text border-0 bg-light"><i className="bi bi-search text-muted"></i></span>
                <input className="form-control border-0 bg-light" placeholder="Name, owner, email, city, type…"
                  value={search} onChange={e => setSearch(e.target.value)} />
                {search && <button className="btn border-0 bg-light" onClick={() => setSearch("")}><i className="bi bi-x"></i></button>}
              </div>
            </div>
            <div className="col-md-2">
              <select className="form-select border-0 bg-light" value={filterZone} onChange={e => setFilterZone(e.target.value)}>
                <option value="">All Zones</option>
                {zonesArr.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <select className="form-select border-0 bg-light" value={filterCity} onChange={e => setFilterCity(e.target.value)}>
                <option value="">All Cities</option>
                {cityOptions.map((city) => <option key={city} value={city}>{city}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <select className="form-select border-0 bg-light" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="col-md-1 text-muted small text-end">{filtered.length} of {franchisees.length}</div>
          </div>
        </div>
      </div>

      {/* Franchise Cards Grid */}
      {isLoading ? (
        <div className="text-center py-5"><div className="spinner-border" style={{ color: "#7c3aed" }}></div></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <i className="bi bi-building fs-1 d-block mb-2 opacity-25"></i>
          {franchisees.length === 0 ? "No franchises yet. Click 'Add Franchise' to create one." : "No franchises match your filter."}
        </div>
      ) : (
        <>
          {/* Card Grid */}
          <div className="row g-3 mb-4">
            {filtered.map(fr => {
              const pending = pendingAmount(fr);
              const days = contractDaysLeft(fr);
              return (
                <div className="col-md-6 col-xl-4" key={fr.id}>
                  <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 14, transition: "box-shadow 0.2s" }}
                    onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)")}
                    onMouseLeave={e => (e.currentTarget.style.boxShadow = "")}>
                    <div style={{ height: 5, borderRadius: "14px 14px 0 0", background: `linear-gradient(90deg, ${avatarBg(fr.name)}, ${avatarBg(fr.name)}88)` }}></div>
                    <div className="card-body p-3">
                      <div className="d-flex align-items-start gap-3 mb-3">
                        <FrAvatar fr={fr} size={56} fontSize={18} />
                        <div className="flex-grow-1 min-w-0">
                          <div className="d-flex align-items-center justify-content-between gap-1 mb-1">
                            <div className="fw-bold text-truncate" style={{ fontSize: 15 }}>{fr.name}</div>
                            <span className={`badge rounded-pill flex-shrink-0 ${fr.is_active ? "bg-success" : "bg-secondary"}`} style={{ fontSize: 10 }}>
                              {fr.is_active ? "Active" : "Off"}
                            </span>
                          </div>
                          <div className="text-muted text-truncate" style={{ fontSize: 13 }}>{fr.owner_name}</div>
                          {fr.franchise_type && (
                            <span className="badge rounded-pill mt-1" style={{ background: "#7c3aed12", color: "#7c3aed", fontSize: 10 }}>
                              {fr.franchise_type} franchise
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="d-flex flex-column gap-1 mb-3" style={{ fontSize: 12 }}>
                        {fr.phone && <div className="d-flex align-items-center gap-2 text-muted">
                          <i className="bi bi-telephone" style={{ width: 14 }}></i>{fr.phone}
                          {fr.whatsapp && <span className="ms-1" style={{ color: "#25d366" }}><i className="bi bi-whatsapp me-1"></i>{fr.whatsapp}</span>}
                        </div>}
                        {fr.email && <div className="d-flex align-items-center gap-2 text-muted text-truncate">
                          <i className="bi bi-envelope" style={{ width: 14 }}></i>{fr.email}
                        </div>}
                        {(fr.city || fr.address) && <div className="d-flex align-items-center gap-2 text-muted text-truncate">
                          <i className="bi bi-geo-alt" style={{ width: 14 }}></i>{[fr.city, fr.pincode].filter(Boolean).join(" — ")}
                        </div>}
                        {fr.website && <div className="d-flex align-items-center gap-2 text-muted text-truncate">
                          <i className="bi bi-globe" style={{ width: 14 }}></i>
                          <a href={fr.website} target="_blank" rel="noreferrer" className="text-muted text-truncate" style={{ fontSize: 11 }}>{fr.website.replace(/^https?:\/\//, "")}</a>
                        </div>}
                      </div>

                      <div className="d-flex gap-2 mb-3">
                        <div className="flex-1 text-center rounded-2 p-2" style={{ background: "#f8f9fb", flex: 1 }}>
                          <div className="fw-bold" style={{ color: "#1a73e8", fontSize: 15 }}>{fmt(fr.total_trips)}</div>
                          <div className="text-muted" style={{ fontSize: 10 }}>Trips</div>
                        </div>
                        <div className="flex-1 text-center rounded-2 p-2" style={{ background: "#f8f9fb", flex: 1 }}>
                          <div className="fw-bold" style={{ color: "#16a34a", fontSize: 15 }}>₹{fmt(fr.total_earnings)}</div>
                          <div className="text-muted" style={{ fontSize: 10 }}>Earned</div>
                        </div>
                        <div className="flex-1 text-center rounded-2 p-2" style={{ background: pending > 0 ? "#fffbeb" : "#f0fdf4", flex: 1 }}>
                          <div className="fw-bold" style={{ color: pending > 0 ? "#d97706" : "#16a34a", fontSize: 15 }}>₹{fmt(pending)}</div>
                          <div className="text-muted" style={{ fontSize: 10 }}>Due</div>
                        </div>
                      </div>

                      <div className="d-flex flex-wrap gap-1 mb-3">
                        {fr.zone_name && (
                          <span className="badge rounded-pill" style={{ background: "#7c3aed18", color: "#7c3aed", fontSize: 11 }}>
                            <i className="bi bi-map me-1"></i>{fr.zone_name}
                          </span>
                        )}
                        <span className="badge rounded-pill fw-semibold" style={{
                          background: fr.commission_type === "flat" ? "#d9770618" : "#1a73e818",
                          color: fr.commission_type === "flat" ? "#d97706" : "#1a73e8", fontSize: 11
                        }}>
                          {fr.commission_type === "flat" ? `₹${Number(fr.commission_flat || 0).toFixed(0)}/ride` : `${Number(fr.commission_percent || 0).toFixed(1)}%`}
                        </span>
                        {fr.gst_number && <span className="badge rounded-pill" style={{ background: "#f1f5f9", color: "#64748b", fontSize: 10 }}>GST ✓</span>}
                        {fr.bank_account && <span className="badge rounded-pill" style={{ background: "#f1f5f9", color: "#64748b", fontSize: 10 }}>Bank ✓</span>}
                      </div>

                      {days !== null && days < 90 && (
                        <div className={`rounded-2 px-2 py-1 mb-2 d-flex align-items-center gap-2`}
                          style={{ background: days < 0 ? "#fef2f2" : days < 30 ? "#fff7ed" : "#fffbeb", fontSize: 11 }}>
                          <i className={`bi ${days < 0 ? "bi-x-circle-fill text-danger" : "bi-exclamation-triangle-fill text-warning"}`}></i>
                          <span style={{ color: days < 0 ? "#dc2626" : "#d97706" }}>
                            {days < 0 ? `Contract expired ${Math.abs(days)}d ago` : `Contract expires in ${days} days`}
                          </span>
                        </div>
                      )}

                      <div className="d-flex gap-2 pt-2" style={{ borderTop: "1px solid #f1f5f9" }}>
                        <button className="btn btn-sm flex-1 fw-semibold" style={{ background: "#7c3aed12", color: "#7c3aed", borderRadius: 8 }}
                          onClick={() => openDetail(fr)}>
                          <i className="bi bi-bar-chart-fill me-1"></i>Details
                        </button>
                        <button className="btn btn-sm btn-light px-2" title="Edit" onClick={() => openEdit(fr)}>
                          <i className="bi bi-pencil-fill" style={{ color: "#7c3aed" }}></i>
                        </button>
                        <div className="form-check form-switch mb-0 d-flex align-items-center px-2">
                          <input className="form-check-input" type="checkbox" checked={fr.is_active}
                            onChange={e => toggleMutation.mutate({ id: fr.id, isActive: e.target.checked })} />
                        </div>
                        <button className="btn btn-sm btn-light px-2" title="Delete"
                          onClick={() => { if (confirm(`Delete "${fr.name}"?`)) deleteMutation.mutate(fr.id); }}>
                          <i className="bi bi-trash-fill text-danger"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Reference Table */}
          <div className="card border-0 shadow-sm" style={{ borderRadius: 12 }}>
            <div className="card-header border-0 bg-white px-4 py-3">
              <h6 className="mb-0 fw-bold text-muted">Quick Reference Table</h6>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-hover mb-0 align-middle" style={{ fontSize: 13 }}>
                  <thead style={{ background: "#f8f9fb" }}>
                    <tr>
                      <th className="border-0 ps-4 py-3">Franchise</th>
                      <th className="border-0">Zone</th>
                      <th className="border-0">Commission</th>
                      <th className="border-0">Trips</th>
                      <th className="border-0">Earned</th>
                      <th className="border-0">Due</th>
                      <th className="border-0">Last Login</th>
                      <th className="border-0">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(fr => (
                      <tr key={fr.id}>
                        <td className="ps-4">
                          <div className="d-flex align-items-center gap-2">
                            <FrAvatar fr={fr} size={32} fontSize={11} />
                            <div>
                              <div className="fw-semibold">{fr.name}</div>
                              <div className="text-muted" style={{ fontSize: 11 }}>{fr.owner_name}</div>
                            </div>
                          </div>
                        </td>
                        <td>{fr.zone_name ? <span className="badge rounded-pill" style={{ background: "#7c3aed18", color: "#7c3aed" }}>{fr.zone_name}</span> : <span className="text-muted">—</span>}</td>
                        <td>
                          <span className="badge rounded-pill" style={{ background: fr.commission_type === "flat" ? "#d9770618" : "#1a73e818", color: fr.commission_type === "flat" ? "#d97706" : "#1a73e8" }}>
                            {fr.commission_type === "flat" ? `₹${Number(fr.commission_flat).toFixed(0)}/ride` : `${Number(fr.commission_percent).toFixed(1)}%`}
                          </span>
                        </td>
                        <td className="fw-semibold">{fmt(fr.total_trips)}</td>
                        <td className="fw-bold" style={{ color: "#16a34a" }}>₹{fmt(fr.total_earnings)}</td>
                        <td>
                          {pendingAmount(fr) > 0
                            ? <span className="fw-semibold" style={{ color: "#d97706" }}>₹{fmt(pendingAmount(fr))}</span>
                            : <span className="text-success small">Cleared</span>}
                        </td>
                        <td className="text-muted">{fr.last_login_at ? fmtDate(fr.last_login_at) : "Never"}</td>
                        <td>
                          <div className="d-flex gap-1">
                            <button className="btn btn-sm btn-light px-2" onClick={() => openDetail(fr)}><i className="bi bi-bar-chart-fill" style={{ color: "#1a73e8" }}></i></button>
                            <button className="btn btn-sm btn-light px-2" onClick={() => openEdit(fr)}><i className="bi bi-pencil-fill" style={{ color: "#7c3aed" }}></i></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Create/Edit Modal ── */}
      {showModal && (
        <div className="modal show d-block" style={{ background: "rgba(0,0,0,0.55)" }}>
          <div className="modal-dialog modal-dialog-centered modal-xl" style={{ maxWidth: 820 }}>
            <div className="modal-content border-0 shadow-lg" style={{ borderRadius: 16 }}>
              <div className="modal-header border-0 px-4 pt-4 pb-2" style={{ background: "#7c3aed08" }}>
                <div>
                  <h5 className="modal-title fw-bold mb-0">{editing ? `Edit — ${editing.name}` : "Add New Franchise"}</h5>
                  <small className="text-muted">Complete all sections for a full franchise profile</small>
                </div>
                <button className="btn-close" onClick={() => setShowModal(false)}></button>
              </div>

              <div className="px-4 pt-2" style={{ borderBottom: "1px solid #f1f5f9" }}>
                <ul className="nav nav-tabs border-0 gap-1">
                  {FORM_TABS.map(tab => (
                    <li className="nav-item" key={tab}>
                      <button
                        className="nav-link border-0 fw-semibold px-3 py-2"
                        style={{ borderRadius: "8px 8px 0 0", fontSize: 13, background: formTab === tab ? "#7c3aed" : "transparent", color: formTab === tab ? "#fff" : "#64748b" }}
                        onClick={() => setFormTab(tab)}>{tab}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="modal-body px-4 py-3" style={{ maxHeight: "68vh", overflowY: "auto" }}>

                {/* Profile Tab */}
                {formTab === "Profile" && (
                  <div className="row g-3">
                    <div className="col-12">
                      <PhotoUpload value={form.photoUrl} onChange={url => f("photoUrl", url)} />
                    </div>
                    <div className="col-12"><hr className="my-0" /></div>
                    <div className="col-12">
                      <label className="form-label small fw-semibold">Franchise Business Name <span className="text-danger">*</span></label>
                      <input className="form-control" placeholder="e.g. Hyderabad North Franchise Pvt. Ltd." value={form.name} onChange={e => f("name", e.target.value)} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Owner / Contact Person <span className="text-danger">*</span></label>
                      <input className="form-control" placeholder="Full legal name" value={form.ownerName} onChange={e => f("ownerName", e.target.value)} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Franchise Type</label>
                      <select className="form-select" value={form.franchiseType} onChange={e => f("franchiseType", e.target.value)}>
                        <option value="area">Area Franchise</option>
                        <option value="city">City Franchise</option>
                        <option value="district">District Franchise</option>
                        <option value="state">State Franchise</option>
                        <option value="master">Master Franchise</option>
                        <option value="micro">Micro / Colony Franchise</option>
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Primary Phone</label>
                      <div className="input-group">
                        <span className="input-group-text"><i className="bi bi-telephone"></i></span>
                        <input className="form-control" placeholder="10-digit" value={form.phone} onChange={e => f("phone", e.target.value)} />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">WhatsApp Number</label>
                      <div className="input-group">
                        <span className="input-group-text" style={{ color: "#25d366" }}><i className="bi bi-whatsapp"></i></span>
                        <input className="form-control" placeholder="WhatsApp (if different)" value={form.whatsapp} onChange={e => f("whatsapp", e.target.value)} />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Login Email <span className="text-danger">*</span></label>
                      <div className="input-group">
                        <span className="input-group-text"><i className="bi bi-envelope"></i></span>
                        <input className="form-control" type="email" placeholder="franchise@example.com" value={form.email} onChange={e => f("email", e.target.value)} />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">{editing ? "New Password (leave blank to keep)" : "Login Password"} {!editing && <span className="text-danger">*</span>}</label>
                      <div className="input-group">
                        <span className="input-group-text"><i className="bi bi-lock"></i></span>
                        <input className="form-control" type="password" placeholder="••••••••" value={form.password} onChange={e => f("password", e.target.value)} />
                      </div>
                    </div>
                    <div className="col-12"><hr className="my-0" /><div className="fw-semibold small mt-1 mb-1 text-muted">Alternate / Secondary Contact</div></div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Alt. Contact Name</label>
                      <input className="form-control" placeholder="e.g. Manager name" value={form.altContactName} onChange={e => f("altContactName", e.target.value)} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Alt. Contact Phone</label>
                      <input className="form-control" placeholder="10-digit" value={form.altContactPhone} onChange={e => f("altContactPhone", e.target.value)} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Assign to Zone</label>
                      <select className="form-select" value={form.zoneId} onChange={e => f("zoneId", e.target.value)}>
                        <option value="">— No zone —</option>
                        {zonesArr.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Website / Social Media</label>
                      <div className="input-group">
                        <span className="input-group-text"><i className="bi bi-globe"></i></span>
                        <input className="form-control" placeholder="https://…" value={form.website} onChange={e => f("website", e.target.value)} />
                      </div>
                    </div>
                    <div className="col-12">
                      <label className="form-label small fw-semibold">Service Area Description</label>
                      <textarea className="form-control" rows={2} placeholder="e.g. Covers Gachibowli, Madhapur, Kondapur and surrounding areas" value={form.serviceAreaDesc} onChange={e => f("serviceAreaDesc", e.target.value)} />
                    </div>
                    <div className="col-12">
                      <div className="form-check form-switch">
                        <input className="form-check-input" type="checkbox" checked={form.isActive} onChange={e => f("isActive", e.target.checked)} id="activeSwitch" />
                        <label className="form-check-label fw-semibold" htmlFor="activeSwitch">Active (franchise can log in and earn commission)</label>
                      </div>
                    </div>
                  </div>
                )}

                {/* Commission Tab */}
                {formTab === "Commission" && (
                  <div className="row g-3">
                    <div className="col-12">
                      <div className="rounded-3 p-4" style={{ background: "#f8f9fb", border: "1px solid #e9ecef" }}>
                        <div className="fw-bold mb-1" style={{ fontSize: 15 }}><i className="bi bi-cash-coin me-2" style={{ color: "#d97706" }}></i>Commission per Completed Ride</div>
                        <div className="text-muted mb-3" style={{ fontSize: 12 }}>Admin sets this. Franchise earns this amount from every completed ride in their zone.</div>
                        <div className="d-flex gap-2 mb-3">
                          {[["percentage", "bi-percent", "Percentage %", "#1a73e8"], ["flat", "bi-currency-rupee", "Fixed ₹ per ride", "#d97706"]].map(([val, icon, label, color]) => (
                            <button key={val} type="button" className="btn fw-semibold px-4"
                              style={form.commissionType === val ? { background: color, color: "#fff", border: "none" } : { border: "1px solid #dee2e6" }}
                              onClick={() => f("commissionType", val)}>
                              <i className={`${icon} me-2`}></i>{label}
                            </button>
                          ))}
                        </div>
                        {form.commissionType === "percentage" ? (
                          <div className="d-flex align-items-center gap-3">
                            <div className="input-group" style={{ width: 200 }}>
                              <input type="number" className="form-control fw-bold" style={{ fontSize: 22 }} placeholder="0"
                                value={form.commissionPercent} onChange={e => f("commissionPercent", e.target.value)} min={0} max={100} step={0.5} />
                              <span className="input-group-text fw-bold" style={{ color: "#1a73e8" }}>%</span>
                            </div>
                            <span className="text-muted">of total ride fare</span>
                          </div>
                        ) : (
                          <div className="d-flex align-items-center gap-3">
                            <div className="input-group" style={{ width: 200 }}>
                              <span className="input-group-text fw-bold" style={{ color: "#d97706" }}>₹</span>
                              <input type="number" className="form-control fw-bold" style={{ fontSize: 22 }} placeholder="0"
                                value={form.commissionFlat} onChange={e => f("commissionFlat", e.target.value)} min={0} step={0.5} />
                            </div>
                            <span className="text-muted">per completed ride</span>
                          </div>
                        )}
                        {previewComm > 0 && (
                          <div className="mt-3 rounded-2 p-2 d-flex align-items-center gap-2"
                            style={{ background: "#16a34a10", border: "1px solid #16a34a30" }}>
                            <i className="bi bi-calculator" style={{ color: "#16a34a" }}></i>
                            <span style={{ fontSize: 13 }}>On ₹200 fare → franchise earns <strong style={{ color: "#16a34a", fontSize: 17 }}>₹{previewComm.toFixed(2)}</strong></span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Minimum Monthly Guarantee (₹)</label>
                      <div className="input-group">
                        <span className="input-group-text">₹</span>
                        <input className="form-control" type="number" placeholder="0 = no guarantee" value={form.minGuaranteed} onChange={e => f("minGuaranteed", e.target.value)} min={0} />
                      </div>
                      <div className="form-text">Pay this minimum even if zone trips are low.</div>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Payout Cycle</label>
                      <select className="form-select" value={form.payoutCycle} onChange={e => f("payoutCycle", e.target.value)}>
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Bi-weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="manual">Manual (on demand)</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Contact & Docs Tab */}
                {formTab === "Contact & Docs" && (
                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label small fw-semibold">Business Address</label>
                      <textarea className="form-control" rows={2} placeholder="Full address" value={form.address} onChange={e => f("address", e.target.value)} />
                    </div>
                    <div className="col-md-5">
                      <label className="form-label small fw-semibold">City</label>
                      <input className="form-control" placeholder="e.g. Hyderabad" value={form.city} onChange={e => f("city", e.target.value)} />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-semibold">Pincode</label>
                      <input className="form-control" placeholder="500001" value={form.pincode} onChange={e => f("pincode", e.target.value)} maxLength={6} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">State</label>
                      <select className="form-select" value={form.state} onChange={e => f("state", e.target.value)}>
                        {["Andhra Pradesh","Telangana","Karnataka","Tamil Nadu","Maharashtra","Delhi","Gujarat","Rajasthan","Uttar Pradesh","Other"].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="col-12"><hr className="my-1" /><div className="fw-semibold small text-muted">Legal / Business Documents</div></div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">GST Number</label>
                      <input className="form-control" placeholder="22AAAAA0000A1Z5" value={form.gstNumber}
                        onChange={e => f("gstNumber", e.target.value.toUpperCase())} maxLength={15} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">PAN Number</label>
                      <input className="form-control" placeholder="ABCDE1234F" value={form.panNumber}
                        onChange={e => f("panNumber", e.target.value.toUpperCase())} maxLength={10} />
                    </div>
                  </div>
                )}

                {/* Banking Tab */}
                {formTab === "Banking" && (
                  <div className="row g-3">
                    <div className="col-12">
                      <div className="rounded-3 p-3" style={{ background: "#1a73e808", border: "1px solid #1a73e830" }}>
                        <i className="bi bi-shield-lock me-2" style={{ color: "#1a73e8" }}></i>
                        <span style={{ fontSize: 13 }}>Banking details are used to process payouts. Handle with care.</span>
                      </div>
                    </div>
                    <div className="col-12">
                      <label className="form-label small fw-semibold">Bank Name</label>
                      <input className="form-control" placeholder="e.g. State Bank of India / HDFC / ICICI" value={form.bankName} onChange={e => f("bankName", e.target.value)} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Account Number</label>
                      <input className="form-control" placeholder="Bank account number" value={form.bankAccount} onChange={e => f("bankAccount", e.target.value)} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">IFSC Code</label>
                      <input className="form-control" placeholder="SBIN0001234" value={form.bankIfsc}
                        onChange={e => f("bankIfsc", e.target.value.toUpperCase())} maxLength={11} />
                    </div>
                    <div className="col-12">
                      <label className="form-label small fw-semibold">Account Holder Name (as per bank)</label>
                      <input className="form-control" placeholder="Exact name as registered with bank" value={form.bankHolderName} onChange={e => f("bankHolderName", e.target.value)} />
                    </div>
                  </div>
                )}

                {/* Contract Tab */}
                {formTab === "Contract" && (
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Agreement Start Date</label>
                      <input className="form-control" type="date" value={form.agreementDate} onChange={e => f("agreementDate", e.target.value)} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Contract End Date</label>
                      <input className="form-control" type="date" value={form.contractEndDate} onChange={e => f("contractEndDate", e.target.value)} />
                      {form.contractEndDate && new Date(form.contractEndDate) < new Date() && (
                        <div className="text-danger small mt-1"><i className="bi bi-exclamation-triangle me-1"></i>This date is in the past — contract already expired.</div>
                      )}
                    </div>
                    <div className="col-12">
                      <label className="form-label small fw-semibold">Internal Notes / Special Terms</label>
                      <textarea className="form-control" rows={6}
                        placeholder="Any special terms agreed with this franchise partner, reminders, or admin notes…"
                        value={form.notes} onChange={e => f("notes", e.target.value)} />
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer border-0 px-4 pb-4 pt-0 d-flex justify-content-between align-items-center">
                <div className="d-flex gap-1">
                  {FORM_TABS.map(t => <div key={t} className="rounded-circle" style={{ width: 8, height: 8, background: formTab === t ? "#7c3aed" : "#e2e8f0" }}></div>)}
                </div>
                <div className="d-flex gap-2">
                  <button className="btn btn-light px-4" onClick={() => setShowModal(false)}>Cancel</button>
                  <button className="btn text-white px-4 fw-semibold" style={{ background: "#7c3aed", borderRadius: 8 }}
                    disabled={saveMutation.isPending} onClick={handleSave}>
                    {saveMutation.isPending && <span className="spinner-border spinner-border-sm me-1"></span>}
                    {editing ? "Update Franchise" : "Create Franchise"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Modal ── */}
      {viewingFr && (
        <div className="modal show d-block" style={{ background: "rgba(0,0,0,0.55)" }}>
          <div className="modal-dialog modal-dialog-centered modal-xl" style={{ maxWidth: 880 }}>
            <div className="modal-content border-0 shadow-lg" style={{ borderRadius: 16 }}>
              <div className="px-4 pt-4 pb-0" style={{ background: `${avatarBg(viewingFr.name)}0e`, borderRadius: "16px 16px 0 0" }}>
                <div className="d-flex align-items-start justify-content-between mb-3">
                  <div className="d-flex align-items-center gap-3">
                    <FrAvatar fr={viewingFr} size={68} fontSize={22} />
                    <div>
                      <h5 className="mb-0 fw-bold">{viewingFr.name}</h5>
                      <div className="text-muted mb-1" style={{ fontSize: 13 }}>
                        <i className="bi bi-person me-1"></i>{viewingFr.owner_name}
                        {viewingFr.franchise_type && <span className="ms-2 badge rounded-pill" style={{ background: "#7c3aed15", color: "#7c3aed", fontSize: 11 }}>{viewingFr.franchise_type} franchise</span>}
                      </div>
                      <div className="d-flex flex-wrap gap-1 mt-1" style={{ fontSize: 12 }}>
                        {viewingFr.phone && <span><i className="bi bi-telephone me-1"></i>{viewingFr.phone}</span>}
                        {viewingFr.whatsapp && <span className="ms-2" style={{ color: "#25d366" }}><i className="bi bi-whatsapp me-1"></i>{viewingFr.whatsapp}</span>}
                        {viewingFr.email && <span className="ms-2 text-muted"><i className="bi bi-envelope me-1"></i>{viewingFr.email}</span>}
                      </div>
                      <div className="d-flex flex-wrap gap-1 mt-2">
                        {viewingFr.zone_name && <span className="badge rounded-pill" style={{ background: "#7c3aed18", color: "#7c3aed" }}><i className="bi bi-map me-1"></i>{viewingFr.zone_name}</span>}
                        <span className="badge rounded-pill fw-semibold" style={{ background: viewingFr.commission_type === "flat" ? "#d9770618" : "#1a73e818", color: viewingFr.commission_type === "flat" ? "#d97706" : "#1a73e8" }}>
                          {viewingFr.commission_type === "flat" ? `₹${Number(viewingFr.commission_flat).toFixed(0)}/ride` : `${Number(viewingFr.commission_percent).toFixed(1)}% commission`}
                        </span>
                        {viewingFr.city && <span className="badge rounded-pill" style={{ background: "#f1f5f9", color: "#64748b" }}><i className="bi bi-geo-alt me-1"></i>{viewingFr.city}</span>}
                        {viewingFr.gst_number && <span className="badge rounded-pill" style={{ background: "#f1f5f9", color: "#64748b" }}>GST: {viewingFr.gst_number}</span>}
                        {viewingFr.pan_number && <span className="badge rounded-pill" style={{ background: "#f1f5f9", color: "#64748b" }}>PAN: {viewingFr.pan_number}</span>}
                        <span className={`badge rounded-pill ${viewingFr.is_active ? "bg-success" : "bg-secondary"}`}>{viewingFr.is_active ? "Active" : "Inactive"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="d-flex gap-2 align-items-start flex-shrink-0">
                    <button className="btn btn-sm btn-light fw-semibold" onClick={() => { openEdit(viewingFr); setViewingFr(null); }}>
                      <i className="bi bi-pencil me-1"></i>Edit
                    </button>
                    <button className="btn-close" onClick={() => setViewingFr(null)}></button>
                  </div>
                </div>

                <ul className="nav nav-tabs border-0 gap-1">
                  {DETAIL_TABS.map(tab => (
                    <li className="nav-item" key={tab}>
                      <button className="nav-link border-0 fw-semibold px-3 py-2"
                        style={{ borderRadius: "8px 8px 0 0", fontSize: 13, background: detailTab === tab ? "#fff" : "transparent", color: detailTab === tab ? "#7c3aed" : "#64748b", boxShadow: detailTab === tab ? "0 -2px 0 #7c3aed inset" : "none" }}
                        onClick={() => setDetailTab(tab)}>{tab}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="modal-body px-4 py-3" style={{ maxHeight: "62vh", overflowY: "auto" }}>

                {detailTab === "Overview" && (!detailStats
                  ? <div className="text-center py-5"><div className="spinner-border" style={{ color: "#7c3aed" }}></div></div>
                  : <>
                    <div className="row g-3 mb-3">
                      {[
                        { label: "Completed Trips", val: fmt(detailStats.summary?.completed_trips), color: "#16a34a", icon: "bi-check-circle-fill" },
                        { label: "Cancelled", val: fmt(detailStats.summary?.cancelled_trips), color: "#dc2626", icon: "bi-x-circle-fill" },
                        { label: "Zone Revenue", val: `₹${fmt(detailStats.summary?.total_revenue)}`, color: "#1a73e8", icon: "bi-cash-stack" },
                        { label: "Commission Earned", val: `₹${fmt(detailStats.summary?.franchise_earnings)}`, color: "#d97706", icon: "bi-currency-rupee" },
                        { label: "Pending Payout", val: `₹${fmt(pendingAmount(viewingFr))}`, color: pendingAmount(viewingFr) > 0 ? "#d97706" : "#16a34a", icon: "bi-clock-history" },
                        { label: "Drivers in Zone", val: fmt(detailStats.summary?.active_drivers), color: "#7c3aed", icon: "bi-people-fill" },
                      ].map(c => (
                        <div className="col-6 col-md-4" key={c.label}>
                          <div className="border rounded-3 p-3 text-center h-100" style={{ borderColor: c.color + "30" }}>
                            <i className={`${c.icon} mb-1`} style={{ color: c.color, fontSize: 20 }}></i>
                            <div className="fw-bold" style={{ color: c.color, fontSize: 20 }}>{c.val}</div>
                            <div className="text-muted small">{c.label}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="row g-2 mb-3">
                      {[
                        ["Alt. Contact", viewingFr.alt_contact_name ? `${viewingFr.alt_contact_name} (${viewingFr.alt_contact_phone || "—"})` : null],
                        ["Address", viewingFr.address ? `${viewingFr.address}, ${viewingFr.city || ""} ${viewingFr.pincode || ""}`.trim() : null],
                        ["Bank", viewingFr.bank_name && viewingFr.bank_account ? `${viewingFr.bank_name} — ${viewingFr.bank_account}` : null],
                        ["IFSC", viewingFr.bank_ifsc],
                        ["Agreement", fmtDate(viewingFr.agreement_date)],
                        ["Expires", viewingFr.contract_end_date ? (() => { const d = contractDaysLeft(viewingFr); return `${fmtDate(viewingFr.contract_end_date)} (${d !== null ? (d < 0 ? `expired ${Math.abs(d)}d ago` : `${d}d left`) : "—"})`; })() : null],
                        ["Payout Cycle", viewingFr.payout_cycle],
                        ["Min Guarantee", viewingFr.min_guaranteed > 0 ? `₹${fmt(viewingFr.min_guaranteed)}/cycle` : "None"],
                        ["Service Area", viewingFr.service_area_desc],
                        ["Website", viewingFr.website],
                        ["Last Login", viewingFr.last_login_at ? fmtDate(viewingFr.last_login_at) : "Never"],
                      ].filter(([, v]) => v && v !== "—" && v !== "None—").map(([label, val]) => (
                        <div className="col-md-6" key={String(label)}>
                          <div className="d-flex gap-2 p-2 rounded-2" style={{ background: "#f8f9fb", fontSize: 13 }}>
                            <span className="text-muted flex-shrink-0" style={{ minWidth: 90 }}>{label}:</span>
                            <span className="fw-semibold text-break">{val}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {viewingFr.notes && (
                      <div className="rounded-3 p-3 mb-3" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
                        <div className="fw-semibold small mb-1"><i className="bi bi-sticky me-1"></i>Notes</div>
                        <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{viewingFr.notes}</div>
                      </div>
                    )}

                    <h6 className="fw-bold mb-2">Recent Trips in Zone</h6>
                    <div className="table-responsive" style={{ maxHeight: 220, overflowY: "auto" }}>
                      <table className="table table-sm table-hover mb-0">
                        <thead style={{ background: "#f8f9fb", position: "sticky", top: 0 }}>
                          <tr><th>Ref</th><th>Customer</th><th>Fare</th><th>Commission</th><th>Status</th><th>Date</th></tr>
                        </thead>
                        <tbody>
                          {(detailStats.recentTrips || []).map((t: any) => (
                            <tr key={t.ref_id}>
                              <td className="small fw-semibold" style={{ color: "#7c3aed" }}>{t.ref_id}</td>
                              <td className="small">{t.customer_name || "—"}</td>
                              <td className="small">₹{fmt(t.total_fare)}</td>
                              <td className="small fw-semibold" style={{ color: "#16a34a" }}>₹{commissionPreview(viewingFr, Number(t.total_fare || 0)).toFixed(0)}</td>
                              <td><span className={`badge rounded-pill ${t.current_status === "completed" ? "bg-success" : t.current_status === "cancelled" ? "bg-danger" : "bg-secondary"}`} style={{ fontSize: 10 }}>{t.current_status}</span></td>
                              <td className="small text-muted">{fmtDate(t.created_at)}</td>
                            </tr>
                          ))}
                          {!(detailStats.recentTrips || []).length && <tr><td colSpan={6} className="text-center text-muted py-3">No trips yet in this zone</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {detailTab === "Monthly" && (
                  monthlyData.length === 0
                    ? <div className="text-center py-5 text-muted"><i className="bi bi-calendar3 fs-1 d-block mb-2 opacity-25"></i>No monthly data yet.</div>
                    : <>
                      <div className="mb-3 fw-semibold"><i className="bi bi-graph-up-arrow text-success me-2"></i>Last 12 months performance</div>
                      <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                          <thead style={{ background: "#f8f9fb" }}><tr><th>Month</th><th>Trips</th><th>Zone Revenue</th><th>Commission Earned</th><th>Bar</th></tr></thead>
                          <tbody>
                            {monthlyData.map((m: any) => {
                              const maxC = Math.max(...monthlyData.map((x: any) => Number(x.commission || 0)), 1);
                              return (
                                <tr key={m.month}>
                                  <td className="fw-semibold">{monthLabel(m.month)}</td>
                                  <td>{fmt(m.trips)}</td>
                                  <td>₹{fmt(m.revenue)}</td>
                                  <td className="fw-bold" style={{ color: "#16a34a" }}>₹{fmt(m.commission)}</td>
                                  <td style={{ width: 160 }}>
                                    <div className="rounded-pill" style={{ height: 10, background: "#e9ecef" }}>
                                      <div className="rounded-pill" style={{ height: 10, width: `${Math.round(Number(m.commission) / maxC * 100)}%`, background: "#16a34a" }}></div>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot style={{ background: "#f8f9fb" }}>
                            <tr>
                              <td className="fw-bold">Total</td>
                              <td className="fw-bold">{fmt(monthlyData.reduce((s: number, m: any) => s + Number(m.trips || 0), 0))}</td>
                              <td className="fw-bold">₹{fmt(monthlyData.reduce((s: number, m: any) => s + Number(m.revenue || 0), 0))}</td>
                              <td className="fw-bold" style={{ color: "#16a34a" }}>₹{fmt(monthlyData.reduce((s: number, m: any) => s + Number(m.commission || 0), 0))}</td>
                              <td></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </>
                )}

                {detailTab === "Drivers" && (
                  driversData.length === 0
                    ? <div className="text-center py-5 text-muted"><i className="bi bi-people fs-1 d-block mb-2 opacity-25"></i>No drivers have operated in this zone yet.</div>
                    : <>
                      <div className="mb-2 text-muted small">{driversData.length} drivers operated in {viewingFr.zone_name || "this zone"}</div>
                      <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                          <thead style={{ background: "#f8f9fb" }}><tr><th>#</th><th>Driver</th><th>Phone</th><th>Vehicle</th><th>Trips</th><th>Revenue</th><th>Last Trip</th></tr></thead>
                          <tbody>
                            {driversData.map((d: any, i: number) => (
                              <tr key={d.id}>
                                <td className="text-muted">{i + 1}</td>
                                <td>
                                  <div className="d-flex align-items-center gap-2">
                                    <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                      style={{ width: 30, height: 30, fontSize: 11, background: avatarBg(d.full_name) }}>
                                      {initials(d.full_name)}
                                    </div>
                                    <span className="fw-semibold" style={{ fontSize: 14 }}>{d.full_name}</span>
                                  </div>
                                </td>
                                <td className="text-muted small">{d.phone || "—"}</td>
                                <td className="small text-muted">
                                  {d.vehicle_category_name || d.vehicle_model || "—"}
                                  {d.vehicle_number ? <div className="text-muted" style={{ fontSize: 11 }}>{d.vehicle_number}</div> : null}
                                </td>
                                <td><span className="badge rounded-pill" style={{ background: "#1a73e818", color: "#1a73e8" }}>{fmt(d.trips)}</span></td>
                                <td className="fw-semibold" style={{ color: "#16a34a" }}>₹{fmt(d.revenue)}</td>
                                <td className="text-muted small">{d.last_trip ? fmtDate(d.last_trip) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                )}

                {detailTab === "Payouts" && (
                  <>
                    <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
                      <div>
                        <span className="fw-semibold">Payout History</span>
                        <span className="ms-2 text-muted small">
                          Earned: <strong style={{ color: "#16a34a" }}>₹{fmt(viewingFr.total_earnings)}</strong> ·
                          Paid: <strong>₹{fmt(viewingFr.total_paid_out_actual)}</strong> ·
                          Pending: <strong style={{ color: pendingAmount(viewingFr) > 0 ? "#d97706" : "#16a34a" }}>₹{fmt(pendingAmount(viewingFr))}</strong>
                        </span>
                      </div>
                      <button className="btn btn-sm fw-semibold text-white" style={{ background: "#16a34a", borderRadius: 8 }} onClick={() => setShowPayoutForm(v => !v)}>
                        <i className={`bi ${showPayoutForm ? "bi-x" : "bi-plus"} me-1`}></i>{showPayoutForm ? "Cancel" : "Record Payout"}
                      </button>
                    </div>

                    {showPayoutForm && (
                      <div className="rounded-3 p-3 mb-3" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                        <div className="fw-semibold mb-3"><i className="bi bi-cash-coin me-1 text-success"></i>Record New Payout</div>
                        <div className="row g-2">
                          <div className="col-md-4">
                            <label className="form-label small fw-semibold">Amount (₹) *</label>
                            <div className="input-group">
                              <span className="input-group-text">₹</span>
                              <input className="form-control" type="number" placeholder={`${fmt(pendingAmount(viewingFr))} (full pending)`}
                                value={payoutForm.amount} onChange={e => setPayoutForm(p => ({ ...p, amount: e.target.value }))} />
                            </div>
                          </div>
                          <div className="col-md-4">
                            <label className="form-label small fw-semibold">Period Start</label>
                            <input className="form-control" type="date" value={payoutForm.periodStart} onChange={e => setPayoutForm(p => ({ ...p, periodStart: e.target.value }))} />
                          </div>
                          <div className="col-md-4">
                            <label className="form-label small fw-semibold">Period End</label>
                            <input className="form-control" type="date" value={payoutForm.periodEnd} onChange={e => setPayoutForm(p => ({ ...p, periodEnd: e.target.value }))} />
                          </div>
                          <div className="col-md-4">
                            <label className="form-label small fw-semibold">Payment Method</label>
                            <select className="form-select" value={payoutForm.paymentMethod} onChange={e => setPayoutForm(p => ({ ...p, paymentMethod: e.target.value }))}>
                              <option value="bank_transfer">Bank Transfer / NEFT</option>
                              <option value="upi">UPI</option>
                              <option value="rtgs">RTGS</option>
                              <option value="cheque">Cheque</option>
                              <option value="cash">Cash</option>
                            </select>
                          </div>
                          <div className="col-md-4">
                            <label className="form-label small fw-semibold">UTR / Reference No.</label>
                            <input className="form-control" placeholder="Transaction reference" value={payoutForm.paymentRef} onChange={e => setPayoutForm(p => ({ ...p, paymentRef: e.target.value }))} />
                          </div>
                          <div className="col-md-4">
                            <label className="form-label small fw-semibold">Notes</label>
                            <input className="form-control" placeholder="Optional" value={payoutForm.notes} onChange={e => setPayoutForm(p => ({ ...p, notes: e.target.value }))} />
                          </div>
                          {viewingFr.bank_account && (
                            <div className="col-12">
                              <div className="rounded-2 p-2 d-flex align-items-center gap-2" style={{ background: "#fff", border: "1px solid #e2e8f0", fontSize: 12 }}>
                                <i className="bi bi-bank text-muted"></i>
                                <span className="text-muted">Paying to:</span>
                                <strong>{viewingFr.bank_name}</strong>
                                <span>— Acc: {viewingFr.bank_account}</span>
                                {viewingFr.bank_ifsc && <span>— IFSC: {viewingFr.bank_ifsc}</span>}
                              </div>
                            </div>
                          )}
                          <div className="col-12 d-flex gap-2">
                            <button className="btn btn-success fw-semibold px-4"
                              disabled={!payoutForm.amount || payoutMutation.isPending}
                              onClick={() => payoutMutation.mutate({ ...payoutForm, amount: parseFloat(payoutForm.amount), status: "paid" })}>
                              {payoutMutation.isPending ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-check-circle me-1"></i>}
                              Mark as Paid
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {payoutsData.length === 0
                      ? <div className="text-center py-4 text-muted"><i className="bi bi-receipt fs-2 d-block mb-2 opacity-25"></i>No payouts recorded yet.</div>
                      : (
                        <div className="table-responsive">
                          <table className="table table-hover align-middle mb-0">
                            <thead style={{ background: "#f8f9fb" }}><tr><th>Date</th><th>Period</th><th>Amount</th><th>Method</th><th>UTR / Ref</th><th>Status</th></tr></thead>
                            <tbody>
                              {payoutsData.map((p: any) => (
                                <tr key={p.id}>
                                  <td className="small">{fmtDate(p.created_at)}</td>
                                  <td className="small text-muted">{p.period_start && p.period_end ? `${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}` : "—"}</td>
                                  <td className="fw-bold" style={{ color: "#16a34a" }}>₹{fmt(p.amount)}</td>
                                  <td className="small">{(p.payment_method || "—").replace(/_/g, " ")}</td>
                                  <td className="small text-muted">{p.payment_ref || "—"}</td>
                                  <td>
                                    <span className={`badge rounded-pill ${p.status === "paid" ? "bg-success" : p.status === "processing" ? "bg-warning text-dark" : "bg-secondary"}`} style={{ fontSize: 11 }}>{p.status}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot style={{ background: "#f8f9fb" }}>
                              <tr>
                                <td colSpan={2} className="fw-bold">Total Paid Out</td>
                                <td className="fw-bold" style={{ color: "#16a34a" }}>₹{fmt(payoutsData.filter((p: any) => p.status === "paid").reduce((s: number, p: any) => s + Number(p.amount), 0))}</td>
                                <td colSpan={3}></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                  </>
                )}

                {detailTab === "Services" && (
                  (() => {
                    const services = Array.isArray(servicesData?.services) ? servicesData.services : [];
                    return services.length === 0
                      ? (
                        <div className="text-center py-5 text-muted">
                          <i className="bi bi-grid fs-1 d-block mb-2 opacity-25"></i>
                          No franchise service mapping available yet.
                        </div>
                      )
                      : (
                        <>
                          <div className="mb-3">
                            <div className="fw-semibold mb-1">
                              <i className="bi bi-toggles2 me-2 text-primary"></i>
                              Ride activation matrix
                            </div>
                            <div className="text-muted small">
                              This controls which ride services this franchise can operate in its zone. Disabling a service here also blocks franchise driver onboarding and new customer bookings for that service in the franchise zone.
                            </div>
                          </div>

                          <div className="row g-3">
                            {services.map((svc: any) => {
                              const statusTone =
                                svc.status === "active"
                                  ? { bg: "#dcfce7", color: "#166534", label: "Active" }
                                  : svc.status === "platform_inactive"
                                    ? { bg: "#fee2e2", color: "#991b1b", label: "Platform Off" }
                                    : svc.status === "franchise_disabled"
                                      ? { bg: "#fef3c7", color: "#92400e", label: "Franchise Off" }
                                      : svc.status === "fare_missing"
                                        ? { bg: "#fce7f3", color: "#9d174d", label: "Fare Missing" }
                                        : { bg: "#e2e8f0", color: "#475569", label: "Vehicle Off" };

                              return (
                                <div className="col-12 col-lg-6" key={svc.serviceKey}>
                                  <div className="border rounded-3 p-3 h-100" style={{ borderColor: "#e2e8f0", background: "#fff" }}>
                                    <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                                      <div>
                                        <div className="fw-bold" style={{ fontSize: 16 }}>{svc.serviceName || svc.serviceKey}</div>
                                        <div className="text-muted small">{(svc.serviceCategory || "rides").toUpperCase()}</div>
                                      </div>
                                      <span className="badge rounded-pill" style={{ background: statusTone.bg, color: statusTone.color, fontSize: 11 }}>
                                        {statusTone.label}
                                      </span>
                                    </div>

                                    <div className="row g-2 mb-3">
                                      <div className="col-6">
                                        <div className="rounded-3 p-2 h-100" style={{ background: "#f8fafc" }}>
                                          <div className="text-muted small">Platform</div>
                                          <div className="fw-semibold" style={{ color: svc.platformActive ? "#166534" : "#991b1b" }}>
                                            {svc.platformActive ? "Active" : "Inactive"}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="col-6">
                                        <div className="rounded-3 p-2 h-100" style={{ background: "#f8fafc" }}>
                                          <div className="text-muted small">Franchise</div>
                                          <div className="fw-semibold" style={{ color: svc.franchiseEnabled ? "#166534" : "#92400e" }}>
                                            {svc.franchiseEnabled ? "Enabled" : "Disabled"}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="col-6">
                                        <div className="rounded-3 p-2 h-100" style={{ background: "#f8fafc" }}>
                                          <div className="text-muted small">Drivers</div>
                                          <div className="fw-semibold">{fmt(svc.driverCount || 0)}</div>
                                        </div>
                                      </div>
                                      <div className="col-6">
                                        <div className="rounded-3 p-2 h-100" style={{ background: "#f8fafc" }}>
                                          <div className="text-muted small">Fare Setup</div>
                                          <div className="fw-semibold" style={{ color: svc.fareConfigured ? "#166534" : "#9d174d" }}>
                                            {svc.fareConfigured ? "Ready" : "Missing"}
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="small mb-2">
                                      <span className="text-muted">Vehicles:</span>{" "}
                                      <span className="fw-semibold">
                                        {svc.vehicleNames?.length ? svc.vehicleNames.join(", ") : "No mapped vehicles"}
                                      </span>
                                    </div>
                                    <div className="small mb-3">
                                      <span className="text-muted">Action:</span>{" "}
                                      <span style={{ color: "#334155" }}>{svc.actionHint || "No operational guidance available."}</span>
                                    </div>

                                    <div className="d-flex justify-content-between align-items-center gap-3 flex-wrap">
                                      <div className="small text-muted">
                                        Commission: <strong>{Number(svc.commissionRate || 0)}%</strong>
                                      </div>
                                      <button
                                        className={`btn btn-sm fw-semibold ${svc.franchiseEnabled ? "btn-outline-danger" : "btn-outline-success"}`}
                                        disabled={serviceToggleMutation.isPending}
                                        onClick={() => serviceToggleMutation.mutate({
                                          franchiseId: viewingFr.id,
                                          serviceKey: svc.serviceKey,
                                          isEnabled: !svc.franchiseEnabled,
                                        })}
                                      >
                                        {svc.franchiseEnabled ? "Disable for Franchise" : "Enable for Franchise"}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                  })()
                )}
              </div>

              <div className="modal-footer border-0 px-4 pb-4 pt-0">
                <button className="btn btn-light px-4" onClick={() => setViewingFr(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
