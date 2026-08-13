import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const TABS = [
  { label: "Business Info", href: "/admin/business-setup" },
  { label: "Pages & Media", href: "/admin/pages-media" },
  { label: "Configurations", href: "/admin/configurations" },
  { label: "System Settings", href: "/admin/settings" },
];

const SECTIONS = [
  { id: "business-pages", label: "Business Pages", icon: "bi-file-earmark-text" },
  { id: "landing-page", label: "Landing Page Setup", icon: "bi-house" },
  { id: "social-media", label: "Social Media Links", icon: "bi-share" },
  { id: "change-password", label: "Change Password", icon: "bi-shield-lock" },
];

const PAGE_KEYS = [
  { key: "about_us", label: "About Us", icon: "bi-info-circle" },
  { key: "privacy_policy", label: "Privacy Policy", icon: "bi-shield-check" },
  { key: "terms_and_conditions", label: "Terms & Conditions", icon: "bi-file-earmark-check" },
  { key: "refund_policy", label: "Refund Policy", icon: "bi-arrow-return-left" },
];

const SOCIAL_KEYS = [
  { key: "facebook_link", label: "Facebook", icon: "bi-facebook", placeholder: "https://facebook.com/..." },
  { key: "instagram_link", label: "Instagram", icon: "bi-instagram", placeholder: "https://instagram.com/..." },
  { key: "twitter_link", label: "Twitter / X", icon: "bi-twitter-x", placeholder: "https://twitter.com/..." },
  { key: "youtube_link", label: "YouTube", icon: "bi-youtube", placeholder: "https://youtube.com/..." },
  { key: "linkedin_link", label: "LinkedIn", icon: "bi-linkedin", placeholder: "https://linkedin.com/..." },
];

const LANDING_KEYS = [
  { key: "hero_title", label: "Hero Title", type: "text", placeholder: "Your Ride, Your Way — JAGO" },
  { key: "hero_subtitle", label: "Hero Subtitle", type: "textarea", placeholder: "Safe, affordable, and reliable rides..." },
  { key: "app_store_link", label: "App Store Link", type: "text", placeholder: "https://apps.apple.com/..." },
  { key: "play_store_link", label: "Play Store Link", type: "text", placeholder: "https://play.google.com/..." },
  { key: "company_email", label: "Company Email", type: "text", placeholder: "support@jagopro.org" },
  { key: "company_phone", label: "Company Phone", type: "text", placeholder: "+91-9100000000" },
  { key: "company_address", label: "Company Address", type: "textarea", placeholder: "Hyderabad, Telangana" },
];

function usePageSettings(settingsType: string) {
  return useQuery<any[]>({
    queryKey: ["/api/business-pages", settingsType],
    queryFn: () => apiRequest("GET", `/api/business-pages?type=${settingsType}`)
      .then(r => r.json())
      .then(d => Array.isArray(d) ? d : []),
  });
}

function toMap(rows: any[] = []) {
  return Object.fromEntries(rows.map(r => [r.keyName, r.value]));
}

export default function PagesMediaPage() {
  const [activeSection, setActiveSection] = useState("business-pages");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: pageRows = [], isLoading: pagesLoading } = usePageSettings("pages_settings");
  const { data: socialRows = [], isLoading: socialLoading } = usePageSettings("social_settings");
  const { data: landingRows = [], isLoading: landingLoading } = usePageSettings("landing_settings");

  const pageMap = toMap(pageRows);
  const socialMap = toMap(socialRows);
  const landingMap = toMap(landingRows);

  const [pageEdits, setPageEdits] = useState<Record<string, string>>({});
  const [socialEdits, setSocialEdits] = useState<Record<string, string>>({});
  const [landingEdits, setLandingEdits] = useState<Record<string, string>>({});
  const [pwForm, setPwForm] = useState({ current: "", new_: "", confirm: "" });
  const [pwError, setPwError] = useState("");

  const savePage = useMutation({
    mutationFn: (data: { keyName: string; value: string; settingsType: string }) =>
      apiRequest("POST", "/api/business-pages", data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/business-pages", vars.settingsType] });
      toast({ title: "Saved successfully" });
      setEditingKey(null);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const saveAll = useMutation({
    mutationFn: async (data: { edits: Record<string, string>; settingsType: string }) => {
      for (const [keyName, value] of Object.entries(data.edits)) {
        await apiRequest("POST", "/api/business-pages", { keyName, value, settingsType: data.settingsType });
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/business-pages", vars.settingsType] });
      toast({ title: "All settings saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const changePw = useMutation({
    mutationFn: (d: any) => apiRequest("POST", "/api/admin/change-password", d),
    onSuccess: () => {
      toast({ title: "Password changed successfully" });
      setPwForm({ current: "", new_: "", confirm: "" });
      setPwError("");
    },
    onError: (e: any) => setPwError(e.message || "Failed to change password"),
  });

  const handleChangePassword = () => {
    setPwError("");
    if (!pwForm.current || !pwForm.new_) { setPwError("All fields are required"); return; }
    if (pwForm.new_.length < 8) { setPwError("New password must be at least 8 characters"); return; }
    if (pwForm.new_ !== pwForm.confirm) { setPwError("Passwords do not match"); return; }
    changePw.mutate({ currentPassword: pwForm.current, newPassword: pwForm.new_ });
  };

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
            <h2 className="h5 mb-0">Pages & Media</h2>
          </div>
        </div>
      </div>

      <div className="container-fluid">
        <div className="card">
          <div className="card-header border-bottom py-3">
            <ul className="nav nav--tabs p-1 rounded bg-white">
              {TABS.map(t => (
                <li key={t.href} className="nav-item">
                  <Link href={t.href} className={`nav-link${t.href === "/admin/pages-media" ? " active" : ""}`}>
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="card-body p-0">
            <div className="row g-0" style={{ minHeight: "600px" }}>

              {/* Left sidebar */}
              <div className="col-md-3 border-end" style={{ background: "#f8fafc" }}>
                <ul className="nav flex-column py-3 px-2">
                  {SECTIONS.map(s => (
                    <li key={s.id} className="nav-item mb-1">
                      <button
                        className={`btn w-100 text-start d-flex align-items-center gap-2 px-3 py-2 rounded${activeSection === s.id ? " btn-primary" : " btn-light"}`}
                        style={{ fontSize: "0.82rem", fontWeight: activeSection === s.id ? 600 : 400 }}
                        onClick={() => setActiveSection(s.id)}
                        data-testid={`nav-section-${s.id}`}
                      >
                        <i className={`bi ${s.icon}`}></i>
                        {s.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Right content */}
              <div className="col-md-9 p-4">

                {/* ── Business Pages ── */}
                {activeSection === "business-pages" && (
                  <div>
                    <div className="d-flex align-items-center justify-content-between mb-4">
                      <div>
                        <h6 className="fw-bold mb-1">Business Pages</h6>
                        <p className="text-muted mb-0" style={{ fontSize: "0.82rem" }}>
                          Manage your Terms, Privacy Policy, About Us, and Refund Policy pages
                        </p>
                      </div>
                    </div>

                    {pagesLoading ? (
                      Array(4).fill(0).map((_, i) => (
                        <div key={i} className="card mb-3">
                          <div className="card-body">
                            <div style={{ height: "14px", background: "#f1f5f9", borderRadius: "4px", marginBottom: "8px", width: "40%" }} />
                            <div style={{ height: "80px", background: "#f1f5f9", borderRadius: "4px" }} />
                          </div>
                        </div>
                      ))
                    ) : PAGE_KEYS.map(pg => {
                      const isEditing = editingKey === pg.key;
                      const currentValue = pageEdits[pg.key] ?? pageMap[pg.key] ?? "";
                      const displayValue = pageMap[pg.key] || "";

                      return (
                        <div key={pg.key} className="card mb-3" data-testid={`page-card-${pg.key}`}>
                          <div className="card-header d-flex justify-content-between align-items-center py-2 px-3" style={{ background: "#f8fafc" }}>
                            <div className="d-flex align-items-center gap-2">
                              <i className={`bi ${pg.icon} text-primary`}></i>
                              <h6 className="mb-0 fw-semibold" style={{ fontSize: "0.87rem" }}>{pg.label}</h6>
                              {displayValue && <span className="badge bg-success-subtle text-success">Saved</span>}
                            </div>
                            <div className="d-flex gap-2">
                              {isEditing ? (
                                <>
                                  <button
                                    className="btn btn-sm btn-outline-secondary"
                                    onClick={() => { setEditingKey(null); setPageEdits(e => ({ ...e, [pg.key]: pageMap[pg.key] || "" })); }}
                                  >Cancel</button>
                                  <button
                                    className="btn btn-sm btn-primary"
                                    onClick={() => savePage.mutate({ keyName: pg.key, value: currentValue, settingsType: "pages_settings" })}
                                    disabled={savePage.isPending}
                                    data-testid={`btn-save-${pg.key}`}
                                  >
                                    {savePage.isPending ? <span className="spinner-border spinner-border-sm me-1"></span> : null}
                                    Save
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="btn btn-sm btn-outline-primary"
                                  onClick={() => { setEditingKey(pg.key); setPageEdits(e => ({ ...e, [pg.key]: pageMap[pg.key] || "" })); }}
                                  data-testid={`btn-edit-${pg.key}`}
                                >
                                  <i className="bi bi-pencil me-1"></i>Edit
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="card-body p-3">
                            {isEditing ? (
                              <textarea
                                className="form-control"
                                rows={14}
                                value={currentValue}
                                onChange={e => setPageEdits(pe => ({ ...pe, [pg.key]: e.target.value }))}
                                style={{ fontFamily: "monospace", fontSize: "0.82rem", lineHeight: 1.6 }}
                                data-testid={`textarea-${pg.key}`}
                              />
                            ) : (
                              <div style={{ whiteSpace: "pre-wrap", fontSize: "0.83rem", lineHeight: 1.7, color: "#475569", maxHeight: "160px", overflow: "auto" }}>
                                {displayValue || <span className="text-muted fst-italic">No content yet. Click Edit to add content.</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── Landing Page ── */}
                {activeSection === "landing-page" && (
                  <div>
                    <div className="d-flex align-items-center justify-content-between mb-4">
                      <div>
                        <h6 className="fw-bold mb-1">Landing Page Setup</h6>
                        <p className="text-muted mb-0" style={{ fontSize: "0.82rem" }}>
                          Configure hero text, app store links, and company contact info
                        </p>
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => saveAll.mutate({ edits: landingEdits, settingsType: "landing_settings" })}
                        disabled={saveAll.isPending || Object.keys(landingEdits).length === 0}
                        data-testid="btn-save-landing"
                      >
                        {saveAll.isPending ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-check-lg me-1"></i>}
                        Save All
                      </button>
                    </div>

                    {landingLoading ? (
                      <div className="d-flex justify-content-center py-5"><div className="spinner-border text-primary"></div></div>
                    ) : LANDING_KEYS.map(lk => (
                      <div key={lk.key} className="mb-4">
                        <label className="form-label fw-semibold" style={{ fontSize: "0.85rem" }}>{lk.label}</label>
                        {lk.type === "textarea" ? (
                          <textarea
                            className="form-control"
                            rows={3}
                            value={landingEdits[lk.key] ?? landingMap[lk.key] ?? ""}
                            onChange={e => setLandingEdits(le => ({ ...le, [lk.key]: e.target.value }))}
                            placeholder={lk.placeholder}
                            data-testid={`input-landing-${lk.key}`}
                          />
                        ) : (
                          <input
                            type="text"
                            className="form-control"
                            value={landingEdits[lk.key] ?? landingMap[lk.key] ?? ""}
                            onChange={e => setLandingEdits(le => ({ ...le, [lk.key]: e.target.value }))}
                            placeholder={lk.placeholder}
                            data-testid={`input-landing-${lk.key}`}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Social Media ── */}
                {activeSection === "social-media" && (
                  <div>
                    <div className="d-flex align-items-center justify-content-between mb-4">
                      <div>
                        <h6 className="fw-bold mb-1">Social Media Links</h6>
                        <p className="text-muted mb-0" style={{ fontSize: "0.82rem" }}>
                          Update your social media profile links
                        </p>
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => saveAll.mutate({ edits: socialEdits, settingsType: "social_settings" })}
                        disabled={saveAll.isPending || Object.keys(socialEdits).length === 0}
                        data-testid="btn-save-social"
                      >
                        {saveAll.isPending ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-check-lg me-1"></i>}
                        Save All
                      </button>
                    </div>

                    {socialLoading ? (
                      <div className="d-flex justify-content-center py-5"><div className="spinner-border text-primary"></div></div>
                    ) : SOCIAL_KEYS.map(sk => (
                      <div key={sk.key} className="mb-4">
                        <label className="form-label fw-semibold" style={{ fontSize: "0.85rem" }}>
                          <i className={`bi ${sk.icon} me-2`}></i>{sk.label}
                        </label>
                        <input
                          type="url"
                          className="form-control"
                          value={socialEdits[sk.key] ?? socialMap[sk.key] ?? ""}
                          onChange={e => setSocialEdits(se => ({ ...se, [sk.key]: e.target.value }))}
                          placeholder={sk.placeholder}
                          data-testid={`input-social-${sk.key}`}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Change Password ── */}
                {activeSection === "change-password" && (
                  <div style={{ maxWidth: "480px" }}>
                    <div className="mb-4">
                      <h6 className="fw-bold mb-1">Change Admin Password</h6>
                      <p className="text-muted mb-0" style={{ fontSize: "0.82rem" }}>
                        Update your admin account password
                      </p>
                    </div>

                    {pwError && (
                      <div className="alert alert-danger d-flex align-items-center gap-2 mb-3" style={{ fontSize: "0.83rem" }}>
                        <i className="bi bi-exclamation-triangle-fill"></i>
                        {pwError}
                      </div>
                    )}

                    <div className="mb-3">
                      <label className="form-label fw-semibold" style={{ fontSize: "0.85rem" }}>Current Password</label>
                      <input
                        type="password"
                        className="form-control"
                        value={pwForm.current}
                        onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                        data-testid="input-current-password"
                        placeholder="Enter current password"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label fw-semibold" style={{ fontSize: "0.85rem" }}>New Password</label>
                      <input
                        type="password"
                        className="form-control"
                        value={pwForm.new_}
                        onChange={e => setPwForm(f => ({ ...f, new_: e.target.value }))}
                        data-testid="input-new-password"
                        placeholder="Minimum 8 characters"
                      />
                    </div>
                    <div className="mb-4">
                      <label className="form-label fw-semibold" style={{ fontSize: "0.85rem" }}>Confirm New Password</label>
                      <input
                        type="password"
                        className="form-control"
                        value={pwForm.confirm}
                        onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                        data-testid="input-confirm-password"
                        placeholder="Repeat new password"
                      />
                    </div>

                    <div className="card bg-warning-subtle border-warning mb-4">
                      <div className="card-body py-2 px-3">
                        <p className="mb-0 small text-warning-emphasis">
                          <i className="bi bi-info-circle me-1"></i>
                          Password must be at least 8 characters. You will need to use the new password on your next login.
                        </p>
                      </div>
                    </div>

                    <button
                      className="btn btn-primary"
                      onClick={handleChangePassword}
                      disabled={changePw.isPending}
                      data-testid="btn-change-password"
                    >
                      {changePw.isPending ? <span className="spinner-border spinner-border-sm me-2"></span> : null}
                      Change Password
                    </button>
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
