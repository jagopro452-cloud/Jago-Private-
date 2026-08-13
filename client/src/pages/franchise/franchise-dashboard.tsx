import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";

type Tab = "overview" | "services" | "fares" | "earnings" | "payouts" | "reports" | "drivers" | "pending" | "settings";
type Period = "7d" | "30d" | "90d" | "all";
const VALID_TABS: Tab[] = ["overview", "services", "fares", "earnings", "payouts", "reports", "drivers", "pending", "settings"];

/* ══════════════════════════════════════════════════════════════
   Micro components
══════════════════════════════════════════════════════════════ */
function TripBadge({ status }: { status: string }) {
  const m: Record<string, [string, string]> = {
    completed:  ["#D1FAE5", "#065F46"], cancelled: ["#FEE2E2", "#991B1B"],
    searching:  ["#FEF9C3", "#92400E"], accepted:  ["#DBEAFE", "#1E40AF"],
    on_the_way: ["#EDE9FE", "#5B21B6"],
  };
  const [bg, fg] = m[status] ?? ["#F1F5F9", "#334155"];
  return <span style={{ padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: bg, color: fg, whiteSpace: "nowrap" }}>{status.replace(/_/g, " ")}</span>;
}

function PayBadge({ status }: { status: string }) {
  const cfg: Record<string, [string, string]> = {
    paid:    ["#D1FAE5", "#065F46"],
    pending: ["#FEF9C3", "#92400E"],
    partial: ["#DBEAFE", "#1E40AF"],
  };
  const [bg, fg] = cfg[status?.toLowerCase()] ?? ["#F1F5F9", "#334155"];
  return <span style={{ padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: bg, color: fg }}>{status || "—"}</span>;
}

function KPI({ icon, label, value, sub, gradient, alert }: { icon: string; label: string; value: string | number; sub?: string; gradient: string; alert?: boolean }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: "18px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: alert ? "1.5px solid #FCD34D" : "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 46, height: 46, borderRadius: 13, background: gradient, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0, boxShadow: "0 3px 10px rgba(0,0,0,0.18)" }}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
        <div style={{ fontSize: 12, color: "#64748B", fontWeight: 600, marginTop: 3 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 1 }}>{sub}</div>}
      </div>
      {alert && <span style={{ fontSize: 18 }}>⚠️</span>}
    </div>
  );
}

function Nav({ icon, label, active, badge, onClick }: { icon: string; label: string; active: boolean; badge?: number; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 13px", borderRadius: 9, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: active ? "rgba(99,179,237,0.18)" : "transparent", color: active ? "#93C5FD" : "rgba(255,255,255,0.6)", transition: "all 0.12s" }}>
      <span style={{ fontSize: 15, width: 19, textAlign: "center", flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
      {badge !== undefined && badge > 0 && <span style={{ background: "#EF4444", color: "#fff", borderRadius: 20, fontSize: 10, fontWeight: 800, padding: "1px 6px" }}>{badge}</span>}
    </button>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #F1F5F9", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", overflow: "hidden", ...style }}>{children}</div>;
}

function CardHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ padding: "16px 20px", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 1 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function TH({ label }: { label: string }) {
  return <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", background: "#F8FAFC" }}>{label}</th>;
}

function TD({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "11px 14px", borderTop: "1px solid #F8FAFC", color: "#334155", fontSize: 13, ...style }}>{children}</td>;
}

function Empty({ icon, msg, sub }: { icon: string; msg: string; sub?: string }) {
  return (
    <tr><td colSpan={20} style={{ padding: "52px 16px", textAlign: "center", color: "#94A3B8" }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 14, color: "#64748B" }}>{msg}</div>
      {sub && <div style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </td></tr>
  );
}

function PeriodBtn({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12, background: active ? "#2F7BFF" : "#F1F5F9", color: active ? "#fff" : "#475569", transition: "all 0.12s" }}>{label}</button>
  );
}

function Spinner() {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}><div style={{ width: 28, height: 28, border: "3px solid #BFDBFE", borderTopColor: "#2F7BFF", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /></div>;
}

function PwdInput({ label, name, value, show, onToggle, onChange }: { label: string; name: string; value: string; show: boolean; onToggle: () => void; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 5 }}>{label}</label>
      <div style={{ position: "relative" }}>
        <input type={show ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)} required style={{ width: "100%", padding: "10px 38px 10px 12px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 13, outline: "none", background: "#F8FAFC", boxSizing: "border-box" }} />
        <button type="button" onClick={onToggle} tabIndex={-1} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#94A3B8", padding: 0, lineHeight: 1 }}>{show ? "🙈" : "👁"}</button>
      </div>
    </div>
  );
}

function FieldInput({ label, name, value, onChange, placeholder }: { label: string; name: string; value: string; onChange: (n: string, v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 5 }}>{label}</label>
      <input value={value} onChange={e => onChange(name, e.target.value)} placeholder={placeholder || label} style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 13, outline: "none", background: "#F8FAFC", color: "#0F172A", boxSizing: "border-box" }}
        onFocus={e => (e.target.style.borderColor = "#2F7BFF")} onBlur={e => (e.target.style.borderColor = "#E2E8F0")} />
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #F1F5F9" }}>
      <span style={{ fontSize: 12, color: "#64748B", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", fontFamily: mono ? "monospace" : undefined }}>{value || "—"}</span>
    </div>
  );
}

function Alert({ ok, msg }: { ok: boolean; msg: string }) {
  return <div style={{ padding: "10px 14px", borderRadius: 10, background: ok ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${ok ? "#BBF7D0" : "#FECACA"}`, color: ok ? "#166534" : "#DC2626", fontSize: 13, fontWeight: 600 }}>{ok ? "✓ " : "✗ "}{msg}</div>;
}

const fmt   = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
function ServiceBadge({ status }: { status: string }) {
  const cfg: Record<string, [string, string, string]> = {
    active: ["#DCFCE7", "#166534", "Live"],
    platform_inactive: ["#FEE2E2", "#991B1B", "Platform Off"],
    franchise_disabled: ["#FEF3C7", "#92400E", "Franchise Off"],
    vehicle_inactive: ["#E0E7FF", "#3730A3", "Vehicle Off"],
    fare_missing: ["#FCE7F3", "#9D174D", "Fare Missing"],
    vehicle_unassigned: ["#F1F5F9", "#475569", "Vehicle Missing"],
    unmapped: ["#F1F5F9", "#475569", "Unmapped"],
  };
  const [bg, fg, label] = cfg[status] || ["#F1F5F9", "#334155", status || "Unknown"];
  return <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 800, background: bg, color: fg, whiteSpace: "nowrap" }}>{label}</span>;
}

const fmtN  = (n: any) => Number(n || 0).toLocaleString("en-IN");
const fdate = (d: any) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/* ══════════════════════════════════════════════════════════════
   Main dashboard
══════════════════════════════════════════════════════════════ */
export default function FranchiseDashboard() {
  const [, setLocation] = useLocation();

  // Core
  const [data,    setData]    = useState<any>(null);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [tab,     setTab]     = useState<Tab>(() => {
    if (typeof window === "undefined") return "overview";
    const next = new URLSearchParams(window.location.search).get("tab") as Tab;
    return VALID_TABS.includes(next) ? next : "overview";
  });

  // Reports
  const [reports,        setReports]        = useState<any>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsPeriod,  setReportsPeriod]  = useState<Period>("30d");

  // Earnings
  const [earnings,        setEarnings]        = useState<any>(null);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsPeriod,  setEarningsPeriod]  = useState<Period>("30d");

  // Payouts
  const [payouts,        setPayouts]        = useState<any>(null);
  const [payoutsLoading, setPayoutsLoading] = useState(false);

  // Services
  const [services, setServices] = useState<any[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [zoneFares, setZoneFares] = useState<any[]>([]);
  const [zoneFaresLoading, setZoneFaresLoading] = useState(false);
  const [monthly, setMonthly] = useState<any[]>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  // Profile form
  const [profileForm, setProfileForm] = useState<Record<string, string>>({ phone: "", whatsapp: "", address: "", city: "", pincode: "", bankName: "", bankAccount: "", bankIfsc: "", bankHolderName: "", gstNumber: "", panNumber: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg,    setProfileMsg]    = useState<{ ok: boolean; msg: string } | null>(null);

  // Password
  const [pwdForm,    setPwdForm]    = useState({ current: "", next: "", confirm: "" });
  const [savingPwd,  setSavingPwd]  = useState(false);
  const [pwdMsg,     setPwdMsg]     = useState<{ ok: boolean; msg: string } | null>(null);
  const [showPwd,    setShowPwd]    = useState<Record<string, boolean>>({});

  // Onboard
  const [onboarding, setOnboarding] = useState<string | null>(null);
  const [onboardMsg, setOnboardMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  const token = typeof window !== "undefined" ? localStorage.getItem("franchise_token") : null;
  const H: Record<string, string> = { Authorization: `Bearer ${token}` };
  const HJ = { ...H, "Content-Type": "application/json" };

  const switchTab = (next: Tab) => {
    setTab(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    }
  };

  /* ── helpers ── */
  const GET = useCallback((url: string) => fetch(url, { headers: H }).then(r => r.json()), [token]);

  /* ── initial load ── */
  const load = () => {
    if (!token) { setLocation("/franchise/login"); return; }
    setLoading(true); setError(null);
    Promise.all([
      fetch("/api/franchise/dashboard", { headers: H }).then(r => r.json().then(d => { if (!r.ok) { if (r.status === 401) { localStorage.removeItem("franchise_token"); setLocation("/franchise/login"); } throw new Error(d.message); } return d; })),
      fetch("/api/franchise/drivers",            { headers: H }).then(r => r.ok ? r.json() : { data: [] }),
      fetch("/api/franchise/drivers/pending-onboard", { headers: H }).then(r => r.ok ? r.json() : []),
      fetch("/api/franchise/me",      { headers: H }).then(r => r.ok ? r.json() : null),
      fetch("/api/franchise/balance", { headers: H }).then(r => r.ok ? r.json() : null),
    ]).then(([dash, drvs, pend, me, bal]) => {
      setData(dash);
      setDrivers(Array.isArray(drvs) ? drvs : (drvs.data || drvs.drivers || []));
      setPending(Array.isArray(pend) ? pend : (pend.data || pend.drivers || []));
      setProfile(me);
      setBalance(bal);
      if (me) setProfileForm({
        phone: me.phone || "", whatsapp: me.whatsapp || "", address: me.address || "",
        city: me.city || "", pincode: me.pincode || "", bankName: me.bankName || "",
        bankAccount: me.bankAccount || "", bankIfsc: me.bankIfsc || "",
        bankHolderName: me.bankHolderName || "", gstNumber: me.gstNumber || "", panNumber: me.panNumber || "",
      });
    }).catch((e: any) => setError(e?.message || "Failed to load")).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  /* ── reports ── */
  const loadReports = useCallback((p: Period) => {
    if (!token) return;
    setReportsLoading(true);
    GET(`/api/franchise/reports?period=${p}`).then(setReports).catch(() => {}).finally(() => setReportsLoading(false));
  }, [token]);

  /* ── earnings ── */
  const loadEarnings = useCallback((p: Period) => {
    if (!token) return;
    setEarningsLoading(true);
    GET(`/api/franchise/earnings?period=${p}`).then(setEarnings).catch(() => {}).finally(() => setEarningsLoading(false));
  }, [token]);

  /* ── payouts ── */
  const loadPayouts = useCallback(() => {
    if (!token) return;
    setPayoutsLoading(true);
    GET("/api/franchise/payouts").then(setPayouts).catch(() => {}).finally(() => setPayoutsLoading(false));
  }, [token]);

  /* ── tab change side effects ── */
  useEffect(() => {
    if (tab === "reports"  && !reports)   loadReports(reportsPeriod);
    if (tab === "earnings" && !earnings)  loadEarnings(earningsPeriod);
    if (tab === "payouts"  && !payouts)   loadPayouts();
  }, [tab]);

  const loadServices = useCallback(() => {
    if (!token) return;
    setServicesLoading(true);
    GET("/api/franchise/services")
      .then((payload) => setServices(Array.isArray(payload?.services) ? payload.services : []))
      .catch(() => setServices([]))
      .finally(() => setServicesLoading(false));
  }, [token]);

  const loadZoneFares = useCallback(() => {
    if (!token) return;
    setZoneFaresLoading(true);
    GET("/api/franchise/zone-fares")
      .then((payload) => setZoneFares(Array.isArray(payload) ? payload : []))
      .catch(() => setZoneFares([]))
      .finally(() => setZoneFaresLoading(false));
  }, [token]);

  const loadMonthly = useCallback(() => {
    if (!token) return;
    setMonthlyLoading(true);
    GET("/api/franchise/monthly")
      .then((payload) => setMonthly(Array.isArray(payload) ? payload : []))
      .catch(() => setMonthly([]))
      .finally(() => setMonthlyLoading(false));
  }, [token]);

  useEffect(() => {
    if (tab === "services" && !services.length) loadServices();
    if (tab === "fares" && !zoneFares.length) loadZoneFares();
    if (tab === "reports" && !monthly.length) loadMonthly();
  }, [tab, services.length, zoneFares.length, monthly.length, loadServices, loadZoneFares, loadMonthly]);

  const switchReportPeriod = (p: Period) => { setReportsPeriod(p); loadReports(p); };
  const switchEarningsPeriod = (p: Period) => { setEarningsPeriod(p); setEarnings(null); loadEarnings(p); };

  /* ── onboard ── */
  const handleOnboard = async (driverId: string) => {
    setOnboarding(driverId);
    setOnboardMsg(null);
    try {
      const res = await fetch(`/api/franchise/drivers/${driverId}/onboard`, { method: "PATCH", headers: HJ });
      const dta = await res.json().catch(() => ({}));
      if (res.ok) {
        const d = pending.find(x => x.id === driverId);
        setPending(p => p.filter(x => x.id !== driverId));
        if (d) setDrivers(p => [d, ...p]);
        setOnboardMsg({ ok: true, msg: dta.message || "Driver onboarded successfully" });
      } else {
        setOnboardMsg({ ok: false, msg: dta.message || "Driver onboarding failed" });
      }
    } finally { setOnboarding(null); }
  };

  /* ── profile save ── */
  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingProfile(true); setProfileMsg(null);
    try {
      const res = await fetch("/api/franchise/profile", { method: "PUT", headers: HJ, body: JSON.stringify(profileForm) });
      const d   = await res.json();
      setProfileMsg({ ok: res.ok, msg: d.message || (res.ok ? "Saved" : "Failed") });
    } catch { setProfileMsg({ ok: false, msg: "Network error" }); }
    finally   { setSavingProfile(false); }
  };

  /* ── password change ── */
  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwdForm.next !== pwdForm.confirm) { setPwdMsg({ ok: false, msg: "Passwords don't match" }); return; }
    if (pwdForm.next.length < 6)          { setPwdMsg({ ok: false, msg: "Min 6 characters" }); return; }
    setSavingPwd(true); setPwdMsg(null);
    try {
      const res = await fetch("/api/franchise/change-password", { method: "POST", headers: HJ, body: JSON.stringify({ currentPassword: pwdForm.current, newPassword: pwdForm.next }) });
      const d   = await res.json();
      setPwdMsg({ ok: res.ok, msg: d.message || (res.ok ? "Changed" : "Failed") });
      if (res.ok) setPwdForm({ current: "", next: "", confirm: "" });
    } catch { setPwdMsg({ ok: false, msg: "Network error" }); }
    finally   { setSavingPwd(false); }
  };

  const logout = async () => {
    try {
      await fetch("/api/franchise/logout", { method: "POST", headers: H });
    } catch {}
    localStorage.removeItem("franchise_token");
    localStorage.removeItem("franchise_info");
    setLocation("/franchise/login");
  };

  /* ── guards ── */
  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC", fontFamily: "'Inter','Segoe UI',sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 44, height: 44, border: "3px solid #2F7BFF", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 12px" }} />
        <div style={{ color: "#64748B", fontWeight: 600 }}>Loading portal…</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC" }}>
      <div style={{ textAlign: "center", background: "#fff", padding: "40px 48px", borderRadius: 20, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontWeight: 800, color: "#DC2626", fontSize: 16, marginBottom: 6 }}>Failed to load</div>
        <div style={{ color: "#64748B", fontSize: 13, marginBottom: 20 }}>{error}</div>
        <button onClick={load} style={{ background: "#2F7BFF", color: "#fff", border: "none", borderRadius: 10, padding: "11px 28px", cursor: "pointer", fontWeight: 700 }}>Retry</button>
      </div>
    </div>
  );

  if (!data) return null;

  const s  = data.summary  || {};
  const fr = data.franchisee || {};
  const zn = data.zone     || {};
  const outstanding = Number(balance?.outstanding ?? 0);

  /* ══════════════════ RENDER ══════════════════ */
  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "'Inter','Segoe UI',sans-serif", background: "#F8FAFC" }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:10px}
        table tr:hover td{background:#F8FAFC !important}
      `}</style>

      {/* ════ SIDEBAR ════ */}
      <aside style={{ width: 228, background: "linear-gradient(180deg,#0F172A 0%,#1E3A8A 100%)", display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh", flexShrink: 0, zIndex: 20 }}>
        {/* Brand */}
        <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(135deg,#3B82F6,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>🏢</div>
            <div>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: 12, lineHeight: 1.3 }}>{fr.name || "Franchise"}</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>Franchise Portal</div>
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 7, padding: "6px 9px", fontSize: 11, color: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", gap: 5 }}>
            <span>📍</span><span style={{ fontWeight: 600 }}>{zn.name || "No zone"}</span>
          </div>
          {(profile?.city || fr.city) && (
            <div style={{ marginTop: 6, background: "rgba(255,255,255,0.06)", borderRadius: 7, padding: "6px 9px", fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
              🏙 {profile?.city || fr.city}{profile?.state ? `, ${profile.state}` : ""}
            </div>
          )}
          {outstanding > 0 && (
            <div style={{ marginTop: 8, background: "rgba(251,191,36,0.15)", borderRadius: 7, padding: "6px 9px", fontSize: 11, color: "#FCD34D", display: "flex", alignItems: "center", gap: 5, fontWeight: 700 }}>
              <span>💰</span><span>₹{fmtN(outstanding)} pending</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 10px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", padding: "6px 12px 4px" }}>Main</div>
          <Nav icon="📊" label="Overview"        active={tab==="overview"}  onClick={() => switchTab("overview")} />
          <Nav icon="🚕" label="Ride Services"   active={tab==="services"}  onClick={() => switchTab("services")} />
          <Nav icon="💳" label="Zone Fares"      active={tab==="fares"}    onClick={() => switchTab("fares")} />
          <Nav icon="💰" label="My Earnings"     active={tab==="earnings"}  onClick={() => switchTab("earnings")} />
          <Nav icon="🏦" label="Payouts"         active={tab==="payouts"}   onClick={() => switchTab("payouts")}  badge={payouts?.summary?.pendingCount > 0 ? payouts.summary.pendingCount : undefined} />
          <Nav icon="📈" label="Reports"         active={tab==="reports"}   onClick={() => switchTab("reports")}  />
          <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 12px 4px" }}>Drivers</div>
          <Nav icon="🚗" label="My Drivers"      active={tab==="drivers"}   onClick={() => switchTab("drivers")}  badge={drivers.length} />
          <Nav icon="⏳" label="Pending Onboard" active={tab==="pending"}   onClick={() => switchTab("pending")}  badge={pending.length} />
          <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 12px 4px" }}>Account</div>
          <Nav icon="⚙️" label="Settings"        active={tab==="settings"}  onClick={() => switchTab("settings")} />
        </nav>

        {/* Footer */}
        <div style={{ padding: "12px 10px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <button onClick={logout} style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", borderRadius: 9, border: "none", cursor: "pointer", background: "rgba(239,68,68,0.13)", color: "#FCA5A5", fontWeight: 600, fontSize: 12 }}>
            <span>🚪</span> Logout
          </button>
        </div>
      </aside>

      {/* ════ MAIN ════ */}
      <main style={{ flex: 1, overflow: "auto", minWidth: 0 }}>
        {/* Topbar */}
        <div style={{ background: "#fff", padding: "0 24px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #E2E8F0", position: "sticky", top: 0, zIndex: 10 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#0F172A" }}>
              {{overview:"Dashboard Overview", services:"Ride Services & Activation", fares:"Zone Fare Configuration", earnings:"My Earnings Ledger", payouts:"Payout History", reports:"Analytics & Reports", drivers:"Driver Management", pending:"Pending Onboarding", settings:"Account Settings"}[tab]}
            </div>
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 1 }}>{new Date().toLocaleDateString("en-IN",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{fr.ownerName || fr.name}</div>
              <div style={{ fontSize: 11, color: "#64748B" }}>{zn.name || "Franchise Owner"}</div>
            </div>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,#2F7BFF,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 13 }}>
              {(fr.ownerName || fr.name || "F")[0].toUpperCase()}
            </div>
          </div>
        </div>

        <div style={{ padding: "22px 24px" }}>

          {/* ══════ OVERVIEW ══════ */}
          {tab === "overview" && (<>
            {/* Outstanding banner */}
            {outstanding > 0 && (
              <div style={{ background: "linear-gradient(135deg,#FEF3C7,#FDE68A)", border: "1.5px solid #FCD34D", borderRadius: 14, padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontSize: 28 }}>💰</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: "#92400E" }}>Outstanding: {fmt(balance?.outstanding)}</div>
                  <div style={{ fontSize: 12, color: "#B45309", marginTop: 2 }}>Total earned {fmt(balance?.totalEarned)} — Paid out {fmt(balance?.totalPaid)}</div>
                </div>
                <button onClick={() => switchTab("payouts")} style={{ background: "#D97706", color: "#fff", border: "none", borderRadius: 9, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>View Payouts →</button>
              </div>
            )}

            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(185px,1fr))", gap: 14, marginBottom: 22 }}>
              <KPI icon="🚗" label="Total Trips"      value={fmtN(s.completed_trips)}                gradient="linear-gradient(135deg,#3B82F6,#1D4ED8)" />
              <KPI icon="📅" label="Today's Trips"    value={fmtN(s.today_trips)}                    gradient="linear-gradient(135deg,#10B981,#047857)" />
              <KPI icon="💵" label="Total Revenue"    value={fmt(s.total_revenue)}                   gradient="linear-gradient(135deg,#8B5CF6,#6D28D9)" />
              <KPI icon="🏆" label="My Earnings"      value={fmt(s.my_earnings)}     sub="All time"  gradient="linear-gradient(135deg,#F59E0B,#B45309)" />
              <KPI icon="📈" label="Today Earnings"   value={fmt(s.today_earnings)}                  gradient="linear-gradient(135deg,#06B6D4,#0E7490)" />
              <KPI icon="👥" label="Active Drivers"   value={fmtN(s.total_drivers)}                  gradient="linear-gradient(135deg,#EC4899,#BE185D)" />
              <KPI icon="💰" label="Outstanding"      value={fmt(balance?.outstanding)} sub="Pending payout" gradient="linear-gradient(135deg,#F97316,#C2410C)" alert={outstanding > 0} />
            </div>

            {/* Recent trips */}
            <Card>
              <CardHead title="Recent Trips" sub="Latest activity in your zone" right={<span style={{ background: "#EFF6FF", color: "#2563EB", borderRadius: 20, fontSize: 12, fontWeight: 700, padding: "3px 10px" }}>{(data.recentTrips||[]).length}</span>} />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Ref ID","Customer","Driver","Pickup","Drop","Fare","Commission","Status","Date"].map(h => <TH key={h} label={h} />)}</tr></thead>
                  <tbody>
                    {!(data.recentTrips||[]).length ? <Empty icon="🚕" msg="No trips yet" sub="Trips will appear here once drivers start completing rides" /> :
                    (data.recentTrips||[]).map((t: any, i: number) => (
                      <tr key={i}>
                        <TD style={{ fontWeight: 700, color: "#2F7BFF", fontFamily: "monospace", fontSize: 12 }}>{t.ref_id}</TD>
                        <TD style={{ fontWeight: 600 }}>{t.customer_name || "—"}</TD>
                        <TD>{t.driver_name || "—"}</TD>
                        <TD style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.pickup_address}</TD>
                        <TD style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.destination_address}</TD>
                        <TD style={{ fontWeight: 700 }}>{fmt(t.total_fare)}</TD>
                        <TD style={{ fontWeight: 700, color: "#10B981" }}>{fmt(t.my_commission)}</TD>
                        <TD><TripBadge status={t.current_status} /></TD>
                        <TD style={{ color: "#94A3B8", fontSize: 11, whiteSpace: "nowrap" }}>{fdate(t.created_at)}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>)}

          {(data.topDrivers || []).length > 0 && tab === "overview" && (
            <Card style={{ marginTop: 18 }}>
              <CardHead title="Top Drivers" sub="Highest completed trips in your zone" />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Driver","Phone","Trips","Revenue"].map(h => <TH key={h} label={h} />)}</tr></thead>
                  <tbody>
                    {(data.topDrivers || []).map((d: any, i: number) => (
                      <tr key={i}>
                        <TD style={{ fontWeight: 700 }}>{d.fullName || d.full_name}</TD>
                        <TD>{d.phone || "—"}</TD>
                        <TD style={{ fontWeight: 700, color: "#2F7BFF" }}>{fmtN(d.completedTrips || d.completed_trips)}</TD>
                        <TD style={{ fontWeight: 700 }}>{fmt(d.revenue)}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ══════ EARNINGS ══════ */}
          {tab === "fares" && (
            zoneFaresLoading ? <Card><Spinner /></Card> : (
              <Card>
                <CardHead title="Zone Fare Configuration" sub={`Read-only fares for ${zn.name || "your zone"}`} right={<span style={{ fontSize: 12, color: "#64748B" }}>{zoneFares.length} vehicles</span>} />
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>{["Vehicle","Base Fare","Per KM","Per Min","Min Fare","Helper","Waiting"].map(h => <TH key={h} label={h} />)}</tr></thead>
                    <tbody>
                      {!zoneFares.length ? <Empty icon="💳" msg="No fares configured" sub="Ask admin to set zone fares in Trip Fares" /> :
                      zoneFares.map((fare: any, i: number) => (
                        <tr key={i}>
                          <TD style={{ fontWeight: 700 }}>{fare.vehicleName || fare.vehicle_name || "—"}</TD>
                          <TD>{fmt(fare.baseFare || fare.base_fare)}</TD>
                          <TD>{fmt(fare.perKmRate || fare.per_km_rate)}</TD>
                          <TD>{fmt(fare.perMinRate || fare.per_min_rate)}</TD>
                          <TD>{fmt(fare.minimumFare || fare.minimum_fare)}</TD>
                          <TD>{fmt(fare.helperCharge || fare.helper_charge)}</TD>
                          <TD>{fmt(fare.waitingCharge || fare.waiting_charge)}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          )}

          {tab === "services" && (
            servicesLoading ? <Card><Spinner /></Card> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
                {!services.length ? (
                  <Card>
                    <div style={{ padding: 36, textAlign: "center", color: "#94A3B8" }}>
                      <div style={{ fontSize: 34, marginBottom: 10 }}>🚕</div>
                      <div style={{ fontWeight: 800, color: "#475569", marginBottom: 4 }}>No ride services mapped yet</div>
                      <div style={{ fontSize: 13 }}>Ask admin to assign ride services for this franchise zone.</div>
                    </div>
                  </Card>
                ) : services.map((service: any) => (
                  <Card key={service.serviceKey}>
                    <CardHead title={service.serviceName || service.serviceKey} sub={(service.serviceCategory || "rides").toUpperCase()} right={<ServiceBadge status={service.status} />} />
                    <div style={{ padding: "16px 18px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                        <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 12 }}>
                          <div style={{ fontSize: 11, color: "#64748B", fontWeight: 700 }}>Platform</div>
                          <div style={{ fontWeight: 800, color: service.platformActive ? "#166534" : "#991B1B", marginTop: 3 }}>{service.platformActive ? "Active" : "Inactive"}</div>
                        </div>
                        <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 12 }}>
                          <div style={{ fontSize: 11, color: "#64748B", fontWeight: 700 }}>Franchise Access</div>
                          <div style={{ fontWeight: 800, color: service.franchiseEnabled ? "#166534" : "#92400E", marginTop: 3 }}>{service.franchiseEnabled ? "Enabled" : "Disabled"}</div>
                        </div>
                        <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 12 }}>
                          <div style={{ fontSize: 11, color: "#64748B", fontWeight: 700 }}>Drivers</div>
                          <div style={{ fontWeight: 800, color: "#0F172A", marginTop: 3 }}>{fmtN(service.driverCount || 0)}</div>
                        </div>
                        <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 12 }}>
                          <div style={{ fontSize: 11, color: "#64748B", fontWeight: 700 }}>Fare Setup</div>
                          <div style={{ fontWeight: 800, color: service.fareConfigured ? "#166534" : "#9D174D", marginTop: 3 }}>{service.fareConfigured ? "Ready" : "Missing"}</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>
                        <strong style={{ color: "#0F172A" }}>Vehicles:</strong> {service.vehicleNames?.length ? service.vehicleNames.join(", ") : "No mapped vehicles"}
                      </div>
                      <div style={{ padding: "11px 12px", borderRadius: 10, background: "#EFF6FF", color: "#1D4ED8", fontSize: 12, fontWeight: 600 }}>
                        {service.actionHint || "No operational guidance available."}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )
          )}

          {tab === "earnings" && (<>
            {/* Period selector */}
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {(["7d","30d","90d","all"] as Period[]).map(p => <PeriodBtn key={p} active={earningsPeriod===p} label={p==="all"?"All Time":p==="7d"?"Last 7 Days":p==="30d"?"Last 30 Days":"Last 90 Days"} onClick={() => switchEarningsPeriod(p)} />)}
            </div>

            {earningsLoading ? <Card><Spinner /></Card> : !earnings ? <Card><div style={{ padding: 32, textAlign: "center", color: "#94A3B8" }}>No data</div></Card> : (<>
              {/* Summary */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 12, marginBottom: 18 }}>
                <KPI icon="🚗" label="Trips Completed"  value={fmtN(earnings.summary?.tripCount)}    gradient="linear-gradient(135deg,#3B82F6,#1D4ED8)" />
                <KPI icon="💵" label="Total Fare"       value={fmt(earnings.summary?.totalFare)}     gradient="linear-gradient(135deg,#8B5CF6,#6D28D9)" />
                <KPI icon="🏆" label="Your Commission"  value={fmt(earnings.summary?.totalEarned)}   gradient="linear-gradient(135deg,#F59E0B,#B45309)" sub={earnings.summary?.commissionRate} />
                <KPI icon="💰" label="Outstanding"      value={fmt(balance?.outstanding)}            gradient="linear-gradient(135deg,#F97316,#C2410C)" alert={outstanding > 0} />
              </div>

              {/* Per-trip ledger */}
              <Card>
                <CardHead title="Per-Trip Commission Ledger" sub={`Showing ${earnings.trips?.length || 0} completed trips`} />
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>{["Ref ID","Customer","Driver","Pickup","Drop","Fare","Your Commission","Date"].map(h => <TH key={h} label={h} />)}</tr></thead>
                    <tbody>
                      {!(earnings.trips||[]).length ? <Empty icon="💸" msg="No completed trips" sub="Your commission per trip will appear here" /> :
                      (earnings.trips||[]).map((t: any, i: number) => (
                        <tr key={i}>
                          <TD style={{ fontWeight: 700, color: "#2F7BFF", fontFamily: "monospace", fontSize: 12 }}>{t.ref_id}</TD>
                          <TD>{t.customer_name || "—"}</TD>
                          <TD>{t.driver_name || "—"}</TD>
                          <TD style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.pickup_address}</TD>
                          <TD style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.destination_address}</TD>
                          <TD style={{ fontWeight: 700 }}>{fmt(t.fare)}</TD>
                          <TD style={{ fontWeight: 800, color: "#10B981" }}>{fmt(t.commission)}</TD>
                          <TD style={{ color: "#94A3B8", fontSize: 11, whiteSpace: "nowrap" }}>{fdate(t.created_at)}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>)}
          </>)}

          {/* ══════ PAYOUTS ══════ */}
          {tab === "payouts" && (<>
            {payoutsLoading ? <Card><Spinner /></Card> : !payouts ? <Card><div style={{ padding: 32, textAlign: "center", color: "#94A3B8" }}>No data</div></Card> : (<>
              {/* Balance summary */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 14, marginBottom: 18 }}>
                <KPI icon="🏆" label="Total Earned"     value={fmt(balance?.totalEarned)}             gradient="linear-gradient(135deg,#F59E0B,#B45309)" />
                <KPI icon="✅" label="Total Received"   value={fmt(payouts.summary?.totalPaid)}       gradient="linear-gradient(135deg,#10B981,#047857)" />
                <KPI icon="💰" label="Outstanding"      value={fmt(balance?.outstanding)}             gradient="linear-gradient(135deg,#F97316,#C2410C)" alert={outstanding > 0} />
                <KPI icon="⏳" label="Pending Payouts"  value={fmtN(payouts.summary?.pendingCount)}   gradient="linear-gradient(135deg,#8B5CF6,#6D28D9)" />
              </div>

              {outstanding > 0 && (
                <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 12, padding: "12px 18px", marginBottom: 16, fontSize: 13, color: "#92400E", fontWeight: 600 }}>
                  ⚠️ You have <strong>{fmt(balance?.outstanding)}</strong> outstanding. Contact your admin to request a payout.
                </div>
              )}

              <Card>
                <CardHead title="Payout History" sub="Payments made by your admin" right={<span style={{ background: "#F0FDF4", color: "#166534", borderRadius: 20, fontSize: 12, fontWeight: 700, padding: "3px 10px" }}>{payouts.payouts?.length || 0} records</span>} />
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>{["Amount","Period","Method","Reference","Status","Notes","Date"].map(h => <TH key={h} label={h} />)}</tr></thead>
                    <tbody>
                      {!(payouts.payouts||[]).length ? <Empty icon="🏦" msg="No payouts yet" sub="Your admin will record payouts here after processing" /> :
                      (payouts.payouts||[]).map((p: any, i: number) => (
                        <tr key={i}>
                          <TD style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{fmt(p.amount)}</TD>
                          <TD style={{ fontSize: 12, color: "#64748B" }}>{p.period_start ? `${fdate(p.period_start)} → ${fdate(p.period_end)}` : "—"}</TD>
                          <TD><span style={{ fontSize: 12, background: "#F1F5F9", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>{p.payment_method?.replace(/_/g," ") || "—"}</span></TD>
                          <TD style={{ fontFamily: "monospace", fontSize: 12, color: "#475569" }}>{p.payment_ref || "—"}</TD>
                          <TD><PayBadge status={p.status} /></TD>
                          <TD style={{ color: "#64748B", fontSize: 12, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.notes || "—"}</TD>
                          <TD style={{ color: "#94A3B8", fontSize: 11, whiteSpace: "nowrap" }}>{fdate(p.paid_at || p.created_at)}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>)}
          </>)}

          {/* ══════ REPORTS ══════ */}
          {tab === "reports" && (<>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {(["7d","30d","90d","all"] as Period[]).map(p => <PeriodBtn key={p} active={reportsPeriod===p} label={p==="all"?"All Time":p==="7d"?"Last 7 Days":p==="30d"?"Last 30 Days":"Last 90 Days"} onClick={() => switchReportPeriod(p)} />)}
            </div>

            {reportsLoading ? <Card><Spinner /></Card> : !reports ? <Card><div style={{ padding: 32, textAlign: "center", color: "#94A3B8" }}>No data</div></Card> : (<>
              {/* Summary pills */}
              <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
                {[
                  { label: "Revenue",       value: fmt(reports.summary?.total_revenue),   color: "#8B5CF6" },
                  { label: "My Earnings",   value: fmt(reports.summary?.total_earnings),  color: "#F59E0B" },
                  { label: "Completed",     value: fmtN(reports.summary?.total_completed),color: "#10B981" },
                  { label: "Cancelled",     value: fmtN(reports.summary?.total_cancelled),color: "#EF4444" },
                  { label: "Completion %",  value: `${reports.summary?.completion_rate}%`,color: "#2F7BFF" },
                ].map(x => (
                  <div key={x.label} style={{ flex: 1, minWidth: 120, background: "#fff", border: `1.5px solid ${x.color}22`, borderRadius: 13, padding: "14px 18px" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: x.color }}>{x.value}</div>
                    <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>{x.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                {/* Daily breakdown */}
                <Card style={{ gridColumn: "1 / -1" }}>
                  <CardHead title="Daily Breakdown" sub={`${reportsPeriod === "7d" ? "7 days" : reportsPeriod === "30d" ? "30 days" : "90 days"} — latest first`} />
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>{["Date","Completed","Cancelled","Total Trips","Revenue","My Earnings"].map(h => <TH key={h} label={h} />)}</tr></thead>
                      <tbody>
                        {!(reports.daily||[]).length ? <Empty icon="📅" msg="No trips in this period" /> :
                        (reports.daily||[]).map((r: any, i: number) => (
                          <tr key={i}>
                            <TD style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{fdate(r.date)}</TD>
                            <TD style={{ color: "#10B981", fontWeight: 700 }}>{fmtN(r.completed)}</TD>
                            <TD style={{ color: "#EF4444", fontWeight: 600 }}>{fmtN(r.cancelled)}</TD>
                            <TD>{fmtN(r.total)}</TD>
                            <TD style={{ fontWeight: 700 }}>{fmt(r.revenue)}</TD>
                            <TD style={{ fontWeight: 800, color: "#F59E0B" }}>{fmt(r.earnings)}</TD>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {/* Top drivers */}
                <Card style={{ gridColumn: "1 / -1" }}>
                  <CardHead title="Top Performing Drivers" sub="By completed trips in this period" />
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>{["Rank","Driver","Phone","Completed Trips","Revenue Generated"].map(h => <TH key={h} label={h} />)}</tr></thead>
                      <tbody>
                        {!(reports.topDrivers||[]).length ? <Empty icon="🚗" msg="No driver data" sub="Drivers will appear here once trips are completed" /> :
                        (reports.topDrivers||[]).map((d: any, i: number) => (
                          <tr key={i}>
                            <TD><span style={{ fontWeight: 800, fontSize: 15, color: i===0?"#F59E0B":i===1?"#9CA3AF":i===2?"#B45309":"#94A3B8" }}>{["🥇","🥈","🥉"][i] || `#${i+1}`}</span></TD>
                            <TD style={{ fontWeight: 700 }}>{d.full_name}</TD>
                            <TD style={{ color: "#64748B" }}>{d.phone}</TD>
                            <TD style={{ fontWeight: 700, color: "#2F7BFF" }}>{fmtN(d.completed_trips)}</TD>
                            <TD style={{ fontWeight: 700 }}>{fmt(d.revenue)}</TD>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

              <Card style={{ marginTop: 18 }}>
                <CardHead title="Monthly Summary" sub="Last 12 months in your zone" />
                {monthlyLoading ? <Spinner /> : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>{["Month","Completed","Cancelled","Revenue","My Earnings"].map(h => <TH key={h} label={h} />)}</tr></thead>
                      <tbody>
                        {!monthly.length ? <Empty icon="📅" msg="No monthly data yet" /> :
                        monthly.map((row: any, i: number) => (
                          <tr key={i}>
                            <TD style={{ fontWeight: 700 }}>{row.month}</TD>
                            <TD style={{ color: "#10B981", fontWeight: 700 }}>{fmtN(row.trips)}</TD>
                            <TD style={{ color: "#EF4444" }}>{fmtN(row.cancelled)}</TD>
                            <TD style={{ fontWeight: 700 }}>{fmt(row.revenue)}</TD>
                            <TD style={{ fontWeight: 800, color: "#F59E0B" }}>{fmt(row.commission)}</TD>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>)}
          </>)}

          {/* ══════ DRIVERS ══════ */}
          {tab === "drivers" && (
            <Card>
              <CardHead title="Drivers in My Zone" sub="All onboarded drivers under your franchise" right={<span style={{ background: "#EFF6FF", color: "#2563EB", borderRadius: 20, fontSize: 12, fontWeight: 700, padding: "3px 10px" }}>{drivers.length} total</span>} />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["#","Driver","Phone","Status","Trips","Rating","Vehicle","Service","Joined"].map(h => <TH key={h} label={h} />)}</tr></thead>
                  <tbody>
                    {!drivers.length ? <Empty icon="👤" msg="No drivers yet" sub="Onboard drivers from the Pending Onboard tab" /> :
                    drivers.map((d: any, i: number) => (
                      <tr key={i}>
                        <TD style={{ color: "#94A3B8", fontWeight: 600 }}>{i+1}</TD>
                        <TD>
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#DBEAFE,#BFDBFE)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, color: "#1D4ED8", flexShrink: 0 }}>{(d.full_name||"D")[0].toUpperCase()}</div>
                            <div>
                              <div style={{ fontWeight: 700, color: "#0F172A", fontSize: 13 }}>{d.full_name||"—"}</div>
                              <div style={{ fontSize: 11, color: "#94A3B8" }}>{d.email||"No email"}</div>
                            </div>
                          </div>
                        </TD>
                        <TD>{d.phone}</TD>
                        <TD><span style={{ padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: (d.is_online||d.availability_status==="online") ? "#D1FAE5" : "#F1F5F9", color: (d.is_online||d.availability_status==="online") ? "#065F46" : "#64748B" }}>{(d.is_online||d.availability_status==="online") ? "● Online" : "○ Offline"}</span></TD>
                        <TD style={{ fontWeight: 700 }}>{d.total_trips ?? d.completed_trips ?? 0}</TD>
                        <TD>{d.avg_rating ? <span style={{ fontWeight: 700, color: "#F59E0B" }}>★ {Number(d.avg_rating).toFixed(1)}</span> : <span style={{ color: "#94A3B8" }}>—</span>}</TD>
                        <TD style={{ fontSize: 12, color: "#64748B" }}>
                          <div>{d.vehicleCategoryName || d.vehicle_category_name || d.vehicleModel || d.vehicle_model || "—"}</div>
                          {(d.vehicleNumber || d.vehicle_number) && <div style={{ fontSize: 11, color: "#94A3B8" }}>{d.vehicleNumber || d.vehicle_number}</div>}
                        </TD>
                        <TD><ServiceBadge status={d.serviceStatus || "unmapped"} /></TD>
                        <TD style={{ color: "#94A3B8", fontSize: 11 }}>{fdate(d.created_at)}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ══════ PENDING ══════ */}
          {tab === "pending" && (
            <Card>
              <CardHead title="Drivers Pending Onboarding" sub="Approve to assign to your zone" right={pending.length > 0 ? <span style={{ background: "#FEF9C3", color: "#92400E", borderRadius: 20, fontSize: 12, fontWeight: 700, padding: "3px 10px" }}>{pending.length} waiting</span> : undefined} />
              {onboardMsg && <div style={{ padding: "14px 18px 0" }}><Alert ok={onboardMsg.ok} msg={onboardMsg.msg} /></div>}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["#","Driver","Phone","Email","Vehicle","Service","Verified","Registered","Action"].map(h => <TH key={h} label={h} />)}</tr></thead>
                  <tbody>
                    {!pending.length ? <Empty icon="✅" msg="All clear — no pending drivers" sub="New driver registrations will appear here" /> :
                    pending.map((d: any, i: number) => (
                      <tr key={i}>
                        <TD style={{ color: "#94A3B8", fontWeight: 600 }}>{i+1}</TD>
                        <TD>
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#FEF3C7,#FDE68A)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, color: "#92400E" }}>{(d.full_name||"D")[0]?.toUpperCase()||"?"}</div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: "#0F172A" }}>{d.full_name||"—"}</div>
                          </div>
                        </TD>
                        <TD>{d.phone}</TD>
                        <TD style={{ color: "#64748B" }}>{d.email||"—"}</TD>
                        <TD style={{ fontSize: 12, color: "#64748B" }}>
                          <div>{d.vehicleCategoryName || d.vehicle_category_name || d.vehicleModel || d.vehicle_model || "—"}</div>
                          {(d.vehicleNumber || d.vehicle_number) && <div style={{ fontSize: 11, color: "#94A3B8" }}>{d.vehicleNumber || d.vehicle_number}</div>}
                        </TD>
                        <TD>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <ServiceBadge status={d.serviceStatus || "vehicle_unassigned"} />
                            {d.serviceName && <span style={{ fontSize: 11, color: "#64748B" }}>{d.serviceName}</span>}
                          </div>
                        </TD>
                        <TD><span style={{ padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: d.verification_status==="approved"?"#D1FAE5":"#FEF9C3", color: d.verification_status==="approved"?"#065F46":"#92400E" }}>{d.verification_status||"pending"}</span></TD>
                        <TD style={{ color: "#94A3B8", fontSize: 11, whiteSpace: "nowrap" }}>{fdate(d.created_at)}</TD>
                        <TD>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                            <button disabled={onboarding===d.id || d.serviceEnabled === false} onClick={() => handleOnboard(d.id)} style={{ padding: "6px 14px", borderRadius: 8, background: onboarding===d.id || d.serviceEnabled === false ? "#CBD5E1" : "linear-gradient(135deg,#2F7BFF,#0891B2)", color: onboarding===d.id || d.serviceEnabled === false ? "#475569" : "#fff", border: "none", cursor: onboarding===d.id ? "wait" : d.serviceEnabled === false ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>
                              {onboarding===d.id ? "Adding…" : "Onboard ✓"}
                            </button>
                            {d.serviceActionHint && (
                              <span style={{ fontSize: 11, color: d.serviceEnabled === false ? "#B45309" : "#64748B", maxWidth: 220, lineHeight: 1.4 }}>
                                {d.serviceActionHint}
                              </span>
                            )}
                          </div>
                        </TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ══════ SETTINGS ══════ */}
          {tab === "settings" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 18 }}>

              {/* Identity card — read only */}
              <Card style={{ gridColumn: "1 / -1" }}>
                <CardHead title="Franchise Identity" sub="Assigned by admin — contact admin to change" />
                <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 0 }}>
                  {[
                    ["Franchise Name",   profile?.name || fr.name],
                    ["Owner Name",       profile?.ownerName || fr.ownerName],
                    ["Email",            profile?.email],
                    ["Zone",             zn.name || "Not assigned"],
                    ["City",             profile?.city || fr.city || "—"],
                    ["State",            profile?.state || "—"],
                    ["Commission",       fr.commissionType === "flat" ? `₹${fr.commissionFlat}/trip` : `${fr.commissionPercent}% of fare`],
                    ["Payout Cycle",     profile?.payoutCycle || "—"],
                    ["Contract End",     fdate(profile?.contractEndDate)],
                    ["Franchise Type",   profile?.franchiseType || "—"],
                  ].map(([l, v]) => <InfoRow key={l as string} label={l as string} value={v as string} />)}
                </div>
              </Card>

              {/* Editable profile form */}
              <Card style={{ gridColumn: "1 / -1" }}>
                <CardHead title="Contact & Business Details" sub="Update your contact, bank, and tax information" />
                <form onSubmit={saveProfile} style={{ padding: "20px" }}>
                  {/* Contact */}
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>📞 Contact Information</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12 }}>
                      <FieldInput label="Phone"     name="phone"    value={profileForm.phone}    onChange={(n,v) => setProfileForm(p => ({...p,[n]:v}))} placeholder="+91 XXXXXXXXXX" />
                      <FieldInput label="WhatsApp"  name="whatsapp" value={profileForm.whatsapp} onChange={(n,v) => setProfileForm(p => ({...p,[n]:v}))} placeholder="+91 XXXXXXXXXX" />
                      <FieldInput label="City"      name="city"     value={profileForm.city}     onChange={(n,v) => setProfileForm(p => ({...p,[n]:v}))} />
                      <FieldInput label="Pincode"   name="pincode"  value={profileForm.pincode}  onChange={(n,v) => setProfileForm(p => ({...p,[n]:v}))} />
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <FieldInput label="Address"  name="address"  value={profileForm.address}  onChange={(n,v) => setProfileForm(p => ({...p,[n]:v}))} placeholder="Street address" />
                    </div>
                  </div>

                  {/* Banking */}
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>🏦 Bank Details (for payouts)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12 }}>
                      <FieldInput label="Bank Name"        name="bankName"        value={profileForm.bankName}        onChange={(n,v) => setProfileForm(p => ({...p,[n]:v}))} />
                      <FieldInput label="Account Number"   name="bankAccount"     value={profileForm.bankAccount}     onChange={(n,v) => setProfileForm(p => ({...p,[n]:v}))} />
                      <FieldInput label="IFSC Code"        name="bankIfsc"        value={profileForm.bankIfsc}        onChange={(n,v) => setProfileForm(p => ({...p,[n]:v}))} />
                      <FieldInput label="Account Holder"   name="bankHolderName"  value={profileForm.bankHolderName}  onChange={(n,v) => setProfileForm(p => ({...p,[n]:v}))} />
                    </div>
                  </div>

                  {/* Tax */}
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>🧾 Tax & Compliance</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12 }}>
                      <FieldInput label="GST Number"  name="gstNumber"  value={profileForm.gstNumber}  onChange={(n,v) => setProfileForm(p => ({...p,[n]:v}))} placeholder="22AAAAA0000A1Z5" />
                      <FieldInput label="PAN Number"  name="panNumber"  value={profileForm.panNumber}  onChange={(n,v) => setProfileForm(p => ({...p,[n]:v}))} placeholder="AAAAA0000A" />
                    </div>
                  </div>

                  {profileMsg && <div style={{ marginBottom: 14 }}><Alert ok={profileMsg.ok} msg={profileMsg.msg} /></div>}
                  <button type="submit" disabled={savingProfile} style={{ padding: "11px 28px", borderRadius: 10, background: savingProfile ? "#BFDBFE" : "linear-gradient(135deg,#2F7BFF,#0891B2)", color: "#fff", border: "none", cursor: savingProfile ? "wait" : "pointer", fontWeight: 700, fontSize: 13 }}>
                    {savingProfile ? "Saving…" : "Save Changes"}
                  </button>
                </form>
              </Card>

              {/* Change password */}
              <Card>
                <CardHead title="Change Password" sub="Update your login password" />
                <form onSubmit={savePassword} style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 13 }}>
                  <PwdInput label="Current Password" name="current" value={pwdForm.current}  show={showPwd.current||false} onToggle={() => setShowPwd(p=>({...p,current:!p.current}))} onChange={v => setPwdForm(p=>({...p,current:v}))} />
                  <PwdInput label="New Password"     name="next"    value={pwdForm.next}     show={showPwd.next||false}    onToggle={() => setShowPwd(p=>({...p,next:!p.next}))}       onChange={v => setPwdForm(p=>({...p,next:v}))} />
                  <PwdInput label="Confirm Password" name="confirm" value={pwdForm.confirm}  show={showPwd.confirm||false} onToggle={() => setShowPwd(p=>({...p,confirm:!p.confirm}))} onChange={v => setPwdForm(p=>({...p,confirm:v}))} />
                  {pwdMsg && <Alert ok={pwdMsg.ok} msg={pwdMsg.msg} />}
                  <button type="submit" disabled={savingPwd} style={{ padding: "11px", borderRadius: 10, background: savingPwd ? "#BFDBFE" : "linear-gradient(135deg,#2F7BFF,#0891B2)", color: "#fff", border: "none", cursor: savingPwd ? "wait" : "pointer", fontWeight: 700, fontSize: 13 }}>
                    {savingPwd ? "Saving…" : "Update Password"}
                  </button>
                </form>
              </Card>

              {/* Zone info */}
              <Card>
                <CardHead title="Zone Information" sub="Your assigned territory" />
                <div style={{ padding: "16px 20px" }}>
                  <div style={{ background: "linear-gradient(135deg,#EFF6FF,#DBEAFE)", borderRadius: 12, padding: "16px 18px", marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: "#3B82F6", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>📍 Zone</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#1E40AF" }}>{zn.name || "Not assigned"}</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {[["Active Drivers", drivers.length, "#2F7BFF"],["Pending", pending.length, "#F59E0B"],["Total Trips", fmtN(s.completed_trips), "#10B981"],["Outstanding", fmt(balance?.outstanding), "#F97316"]].map(([l, v, c]) => (
                      <div key={l as string} style={{ padding: "13px", background: "#F8FAFC", borderRadius: 11, textAlign: "center", border: "1px solid #F1F5F9" }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: c as string }}>{v}</div>
                        <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600, marginTop: 3 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>

            </div>
          )}

        </div>
      </main>
    </div>
  );
}
