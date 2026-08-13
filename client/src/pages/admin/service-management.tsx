import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/queryClient";

interface PlatformService {
  id: string;
  service_key: string;
  service_name: string;
  service_category: string;
  service_status: "active" | "inactive";
  revenue_model: "subscription" | "commission" | "hybrid";
  commission_rate: number;
  sort_order: number;
  icon: string;
  color: string;
  description: string;
}

/* ── Vehicle SVG icons ─────────────────────────────────────── */
const VehicleIcon = ({ serviceKey, color, size = 32 }: { serviceKey: string; color: string; size?: number }) => {
  const icons: Record<string, JSX.Element> = {
    bike_ride: (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        <circle cx="12" cy="34" r="8" stroke={color} strokeWidth="3" fill="none"/>
        <circle cx="36" cy="34" r="8" stroke={color} strokeWidth="3" fill="none"/>
        <circle cx="12" cy="34" r="2.5" fill={color}/>
        <circle cx="36" cy="34" r="2.5" fill={color}/>
        <path d="M12 34 L20 18 L28 18 L36 34" stroke={color} strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
        <path d="M20 18 L24 10 L30 12" stroke={color} strokeWidth="2.5" strokeLinecap="round" fill="none"/>
        <circle cx="30" cy="12" r="2" fill={color}/>
        <path d="M28 18 L32 22 L36 22" stroke={color} strokeWidth="2.5" strokeLinecap="round" fill="none"/>
        <path d="M16 18 L12 22" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    auto_ride: (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        <circle cx="13" cy="35" r="6" stroke={color} strokeWidth="3" fill="none"/>
        <circle cx="35" cy="35" r="6" stroke={color} strokeWidth="3" fill="none"/>
        <circle cx="13" cy="35" r="2" fill={color}/>
        <circle cx="35" cy="35" r="2" fill={color}/>
        <path d="M7 35 L7 22 C7 18 10 15 14 14 L32 14 C36 14 41 18 41 22 L41 35" stroke={color} strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
        <path d="M7 22 L41 22" stroke={color} strokeWidth="2" strokeDasharray="3 2"/>
        <path d="M14 14 L14 22" stroke={color} strokeWidth="2"/>
        <path d="M32 14 L32 22" stroke={color} strokeWidth="2"/>
        <rect x="7" y="29" width="5" height="1" rx="0.5" fill={color}/>
        <rect x="36" y="29" width="5" height="1" rx="0.5" fill={color}/>
      </svg>
    ),
    mini_car: (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        <circle cx="13" cy="35" r="6" stroke={color} strokeWidth="3" fill="none"/>
        <circle cx="35" cy="35" r="6" stroke={color} strokeWidth="3" fill="none"/>
        <circle cx="13" cy="35" r="2" fill={color}/>
        <circle cx="35" cy="35" r="2" fill={color}/>
        <path d="M5 28 L5 35 L7 35 M19 35 L29 35 M41 35 L43 35 L43 28 L38 28 L32 18 L16 18 L10 28 Z" stroke={color} strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
        <path d="M17 18 L15 28 M31 18 L33 28" stroke={color} strokeWidth="1.5"/>
        <path d="M15 28 L33 28" stroke={color} strokeWidth="1.5"/>
        <rect x="19" y="19" width="10" height="7" rx="2" stroke={color} strokeWidth="1.5" fill={color+"30"}/>
        <path d="M5 26 L10 26" stroke={color} strokeWidth="2" strokeLinecap="round"/>
        <path d="M38 26 L43 26" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    sedan: (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        <circle cx="13" cy="36" r="6" stroke={color} strokeWidth="3" fill="none"/>
        <circle cx="35" cy="36" r="6" stroke={color} strokeWidth="3" fill="none"/>
        <circle cx="13" cy="36" r="2" fill={color}/>
        <circle cx="35" cy="36" r="2" fill={color}/>
        <path d="M4 30 L4 36 L7 36 M19 36 L29 36 M41 36 L44 36 L44 30 L40 24 L30 17 L18 17 L8 24 Z" stroke={color} strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
        <path d="M18 17 L16 24 M30 17 L32 24" stroke={color} strokeWidth="1.5"/>
        <rect x="17" y="18" width="14" height="8" rx="2" stroke={color} strokeWidth="1.5" fill={color+"25"}/>
        <path d="M4 28 L9 28" stroke={color} strokeWidth="2" strokeLinecap="round"/>
        <path d="M39 28 L44 28" stroke={color} strokeWidth="2" strokeLinecap="round"/>
        <path d="M8 24 L40 24" stroke={color} strokeWidth="1.5" strokeDasharray="2 2"/>
      </svg>
    ),
    suv: (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        <circle cx="13" cy="36" r="6" stroke={color} strokeWidth="3" fill="none"/>
        <circle cx="35" cy="36" r="6" stroke={color} strokeWidth="3" fill="none"/>
        <circle cx="13" cy="36" r="2" fill={color}/>
        <circle cx="35" cy="36" r="2" fill={color}/>
        <rect x="4" y="19" width="40" height="17" rx="3" stroke={color} strokeWidth="2.5" fill="none"/>
        <path d="M4 27 L44 27" stroke={color} strokeWidth="1.5"/>
        <rect x="7" y="20" width="15" height="7" rx="2" stroke={color} strokeWidth="1.5" fill={color+"25"}/>
        <rect x="26" y="20" width="15" height="7" rx="2" stroke={color} strokeWidth="1.5" fill={color+"25"}/>
        <path d="M4 22 L4 19" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        <path d="M44 22 L44 19" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        <rect x="4" y="31" width="5" height="5" rx="1" fill={color+"40"}/>
        <rect x="39" y="31" width="5" height="5" rx="1" fill={color+"40"}/>
      </svg>
    ),
    parcel_delivery: (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        <rect x="8" y="16" width="32" height="24" rx="3" stroke={color} strokeWidth="2.5" fill="none"/>
        <path d="M8 24 L40 24" stroke={color} strokeWidth="2"/>
        <path d="M24 16 L24 40" stroke={color} strokeWidth="2"/>
        <path d="M16 10 L24 16 L32 10" stroke={color} strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
        <path d="M16 10 L8 16" stroke={color} strokeWidth="2" strokeLinecap="round"/>
        <path d="M32 10 L40 16" stroke={color} strokeWidth="2" strokeLinecap="round"/>
        <path d="M18 28 L22 32 L30 24" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    car_pool: (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        <circle cx="11" cy="36" r="5" stroke={color} strokeWidth="2.5" fill="none"/>
        <circle cx="33" cy="36" r="5" stroke={color} strokeWidth="2.5" fill="none"/>
        <path d="M4 30 L4 36 L6 36 M16 36 L28 36 M38 36 L44 36 L44 30 L40 24 L28 18 L16 18 L10 24 Z" stroke={color} strokeWidth="2" strokeLinejoin="round" fill="none"/>
        <rect x="17" y="19" width="11" height="7" rx="2" stroke={color} strokeWidth="1.5" fill={color+"25"}/>
        <circle cx="20" cy="11" r="3.5" stroke={color} strokeWidth="2" fill="none"/>
        <circle cx="28" cy="11" r="3.5" stroke={color} strokeWidth="2" fill="none"/>
        <path d="M14 18 C14 14 17 13 20 13" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        <path d="M34 18 C34 14 31 13 28 13" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      </svg>
    ),
    outstation: (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        <circle cx="13" cy="36" r="6" stroke={color} strokeWidth="2.5" fill="none"/>
        <circle cx="35" cy="36" r="6" stroke={color} strokeWidth="2.5" fill="none"/>
        <path d="M5 29 L5 36 L7 36 M19 36 L29 36 M41 36 L43 36 L43 29 L38 23 L28 18 L18 18 L10 23 Z" stroke={color} strokeWidth="2" strokeLinejoin="round" fill="none"/>
        <rect x="19" y="19" width="10" height="7" rx="1.5" stroke={color} strokeWidth="1.5" fill={color+"25"}/>
        <path d="M32 8 L32 16 M28 12 L36 12" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        <circle cx="32" cy="8" r="2" fill={color}/>
      </svg>
    ),
    intercity: (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        <rect x="4" y="16" width="40" height="22" rx="4" stroke={color} strokeWidth="2.5" fill="none"/>
        <circle cx="12" cy="38" r="4" stroke={color} strokeWidth="2.5" fill="none"/>
        <circle cx="36" cy="38" r="4" stroke={color} strokeWidth="2.5" fill="none"/>
        <path d="M4 26 L44 26" stroke={color} strokeWidth="1.5"/>
        <rect x="6" y="17" width="8" height="8" rx="1.5" stroke={color} strokeWidth="1.5" fill={color+"25"}/>
        <rect x="17" y="17" width="8" height="8" rx="1.5" stroke={color} strokeWidth="1.5" fill={color+"25"}/>
        <rect x="28" y="17" width="8" height="8" rx="1.5" stroke={color} strokeWidth="1.5" fill={color+"25"}/>
        <path d="M4 20 L4 16" stroke={color} strokeWidth="2.5"/>
        <path d="M44 20 L44 16" stroke={color} strokeWidth="2.5"/>
        <path d="M36 12 L40 16" stroke={color} strokeWidth="2" strokeLinecap="round"/>
        <path d="M12 12 L8 16" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  };

  const fallback = (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="13" cy="35" r="6" stroke={color} strokeWidth="2.5" fill="none"/>
      <circle cx="35" cy="35" r="6" stroke={color} strokeWidth="2.5" fill="none"/>
      <path d="M5 28 L5 35 L7 35 M19 35 L29 35 M41 35 L43 35 L43 28 L38 22 L28 17 L18 17 L10 22 Z" stroke={color} strokeWidth="2" strokeLinejoin="round" fill="none"/>
      <rect x="18" y="18" width="12" height="7" rx="1.5" stroke={color} strokeWidth="1.5" fill={color+"25"}/>
    </svg>
  );

  return icons[serviceKey] || fallback;
};

/* ── Helpers ───────────────────────────────────────────────── */
const CATEGORY_META: Record<string, { label: string; icon: string; desc: string }> = {
  rides:   { label: "Ride Services",       icon: "🚗", desc: "Point-to-point passenger transport" },
  carpool: { label: "Pooling & Shared",    icon: "👥", desc: "Shared rides, carpooling, outstation" },
  parcel:  { label: "Parcel & Logistics",  icon: "📦", desc: "Package pickup and delivery" },
};

const MODEL_CFG: Record<string, { bg: string; text: string; border: string; label: string; icon: string }> = {
  subscription: { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE", label: "Subscription",  icon: "📋" },
  commission:   { bg: "#FFF7ED", text: "#C2410C", border: "#FED7AA", label: "Commission",     icon: "💸" },
  hybrid:       { bg: "#F5F3FF", text: "#6D28D9", border: "#DDD6FE", label: "Hybrid",         icon: "⚡" },
};

const LAUNCH_KEYS = new Set(["bike_ride", "parcel_delivery"]);

function normalizeServices(payload: unknown): PlatformService[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const v = payload as Record<string, unknown>;
    if (Array.isArray(v.data)) return v.data as PlatformService[];
    if (Array.isArray(v.services)) return v.services as PlatformService[];
  }
  return [];
}

/* ── Toggle switch ─────────────────────────────────────────── */
function Toggle({ on, onChange, color }: { on: boolean; onChange: () => void; color: string }) {
  return (
    <button
      onClick={onChange}
      style={{ width: 52, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative", transition: "all .25s", background: on ? `linear-gradient(135deg,${color},${color}cc)` : "#D1D5DB", boxShadow: on ? `0 2px 8px ${color}50` : "none", flexShrink: 0 }}
    >
      <div style={{ position: "absolute", top: 3, left: on ? 27 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left .25s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════
   Main Component
══════════════════════════════════════════════════════════════ */
export default function ServiceManagement() {
  const qc = useQueryClient();
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState({ revenue_model: "commission", commission_rate: "15" });

  const { data: raw = [], isLoading } = useQuery<PlatformService[]>({
    queryKey: ["/api/platform-services"],
    queryFn: async () => {
      const r = await adminFetch("/api/platform-services");
      if (!r.ok) throw new Error("Failed");
      return normalizeServices(await r.json().catch(() => []));
    },
  });

  const services = raw as PlatformService[];

  const toggleMut = useMutation({
    mutationFn: async ({ key, current }: { key: string; current: "active" | "inactive" }) => {
      const r = await adminFetch(`/api/platform-services/${key}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_status: current === "active" ? "inactive" : "active" }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/platform-services"] }),
  });

  const modelMut = useMutation({
    mutationFn: async ({ key, revenue_model, commission_rate }: { key: string; revenue_model: string; commission_rate: string }) => {
      const r = await adminFetch(`/api/platform-services/${key}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revenue_model, commission_rate: parseFloat(commission_rate) }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => { setEditingModel(null); qc.invalidateQueries({ queryKey: ["/api/platform-services"] }); },
  });

  const active = services.filter(s => s.service_status === "active").length;
  const total  = services.length;
  const pct    = total > 0 ? Math.round((active / total) * 100) : 0;

  const grouped = services.reduce<Record<string, PlatformService[]>>((acc, svc) => {
    if (!acc[svc.service_category]) acc[svc.service_category] = [];
    acc[svc.service_category].push(svc);
    return acc;
  }, {});

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1200, fontFamily: "'Inter','Segoe UI',sans-serif" }}>
      <style>{`
        .svc-card { transition: all .2s ease !important; }
        .svc-card:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,0,0,0.1) !important; }
      `}</style>

      {/* ── Page header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 50, height: 50, borderRadius: 15, background: "linear-gradient(135deg,#2F7BFF,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(47,123,255,0.35)" }}>
            <i className="bi bi-toggles2" style={{ color: "#fff", fontSize: 22 }} />
          </div>
          <div>
            <h4 style={{ fontWeight: 800, margin: 0, fontSize: 20, color: "#0F172A", letterSpacing: -0.3 }}>Service Management</h4>
            <p style={{ margin: 0, fontSize: 13, color: "#64748B" }}>Activate services & configure revenue model per vehicle type</p>
          </div>
        </div>

        {/* Launch readiness widget */}
        <div style={{ background: "linear-gradient(135deg,#0F172A,#1E3A8A)", borderRadius: 16, padding: "16px 22px", minWidth: 230, border: "1px solid rgba(47,123,255,0.25)", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, fontWeight: 600 }}>Launch Readiness</span>
            <span style={{ color: "#60A5FA", fontWeight: 800, fontSize: 14 }}>{active}/{total} Active</span>
          </div>
          <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 8, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg,#3B82F6,#0891B2)", borderRadius: 8, transition: "width .4s ease" }} />
          </div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 6, fontWeight: 500 }}>{pct}% services enabled</div>
        </div>
      </div>

      {/* ── Phase 1 banner ── */}
      <div style={{ background: "linear-gradient(135deg,#EFF6FF,#F0F9FF)", border: "1.5px solid #BFDBFE", borderRadius: 16, padding: "16px 20px", marginBottom: 28, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#2F7BFF,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🚀</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#1E3A8A", marginBottom: 3 }}>Phase 1 Launch: Bike Ride + Parcel Delivery only</div>
          <div style={{ fontSize: 12, color: "#3B82F6", lineHeight: 1.6 }}>
            Only these two services are active at launch. Enable additional services as your fleet grows.
            Each service supports an independent <strong>Subscription</strong> or <strong>Commission</strong> revenue model.
          </div>
        </div>
        <div style={{ padding: "6px 16px", borderRadius: 20, background: "linear-gradient(135deg,#2F7BFF,#0891B2)", color: "#fff", fontWeight: 800, fontSize: 11, whiteSpace: "nowrap", boxShadow: "0 2px 10px rgba(47,123,255,0.35)" }}>
          🚀 Phase 1
        </div>
      </div>

      {/* ── Services ── */}
      {isLoading ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div className="spinner-border" style={{ color: "#2F7BFF" }} />
          <p style={{ marginTop: 12, color: "#64748B", fontWeight: 600 }}>Loading services…</p>
        </div>
      ) : (
        Object.entries(grouped).map(([cat, catSvcs]) => {
          const meta = CATEGORY_META[cat] ?? { label: cat, icon: "🚗", desc: "" };
          const catActive = catSvcs.filter(s => s.service_status === "active").length;
          return (
            <div key={cat} style={{ marginBottom: 36 }}>
              {/* Category header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, paddingBottom: 12, borderBottom: "2px solid #F1F5F9" }}>
                <span style={{ fontSize: 20 }}>{meta.icon}</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#0F172A" }}>{meta.label}</div>
                  <div style={{ fontSize: 12, color: "#94A3B8" }}>{meta.desc}</div>
                </div>
                <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, padding: "3px 12px", borderRadius: 20, background: catActive === catSvcs.length ? "#D1FAE5" : "#F1F5F9", color: catActive === catSvcs.length ? "#065F46" : "#64748B" }}>
                  {catActive}/{catSvcs.length} active
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 18 }}>
                {catSvcs.map(svc => {
                  const isActive   = svc.service_status === "active";
                  const isLaunch   = LAUNCH_KEYS.has(svc.service_key);
                  const mdl        = MODEL_CFG[svc.revenue_model] ?? MODEL_CFG.commission;
                  const editingThis = editingModel === svc.service_key;
                  const cardColor  = svc.color || "#2F7BFF";

                  return (
                    <div key={svc.service_key} className="svc-card" style={{
                      background: "#fff", borderRadius: 20, overflow: "hidden",
                      boxShadow: isActive ? `0 4px 20px ${cardColor}18, 0 1px 4px rgba(0,0,0,0.05)` : "0 2px 10px rgba(0,0,0,0.06)",
                      border: isActive ? `1.5px solid ${cardColor}35` : "1.5px solid #F1F5F9",
                      position: "relative",
                    }}>
                      {/* Color bar */}
                      <div style={{ height: 4, background: isActive ? `linear-gradient(90deg,${cardColor},${cardColor}88)` : "#E5E7EB" }} />

                      {/* Launch badge */}
                      {isLaunch && (
                        <div style={{ position: "absolute", top: 12, right: 12, background: "linear-gradient(135deg,#2F7BFF,#0891B2)", color: "#fff", fontSize: 9, fontWeight: 800, padding: "3px 9px", borderRadius: 8, letterSpacing: 0.8, boxShadow: "0 2px 8px rgba(47,123,255,0.4)" }}>
                          🚀 LAUNCH
                        </div>
                      )}

                      <div style={{ padding: "18px 20px 16px" }}>
                        {/* Header row — icon + name */}
                        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                          <div style={{
                            width: 60, height: 60, borderRadius: 18, flexShrink: 0,
                            background: isActive ? `linear-gradient(135deg,${cardColor}18,${cardColor}08)` : "#F8FAFC",
                            border: `1.5px solid ${isActive ? cardColor + "30" : "#E5E7EB"}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            <VehicleIcon serviceKey={svc.service_key} color={isActive ? cardColor : "#94A3B8"} size={34} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 800, fontSize: 15, color: "#0F172A" }}>{svc.service_name}</span>
                              <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: isActive ? `${cardColor}18` : "#F1F5F9", color: isActive ? cardColor : "#94A3B8", border: `1px solid ${isActive ? cardColor + "30" : "#E5E7EB"}` }}>
                                {isActive ? "● Active" : "○ Inactive"}
                              </span>
                            </div>
                            <p style={{ margin: 0, fontSize: 12, color: "#64748B", lineHeight: 1.5 }}>{svc.description}</p>
                          </div>
                        </div>

                        {/* Revenue model row */}
                        {!editingThis ? (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: mdl.bg, borderRadius: 10, padding: "9px 13px", marginBottom: 12, border: `1px solid ${mdl.border}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <span style={{ fontSize: 14 }}>{mdl.icon}</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: mdl.text }}>{mdl.label} Model</span>
                              {svc.revenue_model !== "subscription" && (
                                <span style={{ fontSize: 11, color: mdl.text, opacity: 0.8, fontWeight: 600 }}>• {svc.commission_rate}%</span>
                              )}
                            </div>
                            <button
                              onClick={() => { setModelForm({ revenue_model: svc.revenue_model, commission_rate: String(svc.commission_rate) }); setEditingModel(svc.service_key); }}
                              style={{ fontSize: 11, fontWeight: 700, color: mdl.text, background: "#fff", border: `1px solid ${mdl.border}`, borderRadius: 7, padding: "3px 10px", cursor: "pointer" }}
                            >
                              Edit
                            </button>
                          </div>
                        ) : (
                          <div style={{ background: "#F8FAFC", borderRadius: 12, padding: "14px", marginBottom: 12, border: "1px solid #E2E8F0" }}>
                            <div style={{ marginBottom: 10 }}>
                              <label style={{ fontSize: 11, fontWeight: 700, color: "#334155", display: "block", marginBottom: 5 }}>Revenue Model</label>
                              <select
                                value={modelForm.revenue_model}
                                onChange={e => setModelForm(f => ({ ...f, revenue_model: e.target.value }))}
                                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: 13, outline: "none", background: "#fff" }}
                              >
                                <option value="subscription">📋 Subscription — drivers buy plans</option>
                                <option value="commission">💸 Commission — % deducted per trip</option>
                                <option value="hybrid">⚡ Hybrid — both apply</option>
                              </select>
                            </div>
                            {modelForm.revenue_model !== "subscription" && (
                              <div style={{ marginBottom: 10 }}>
                                <label style={{ fontSize: 11, fontWeight: 700, color: "#334155", display: "block", marginBottom: 5 }}>Commission Rate (%)</label>
                                <input
                                  type="number" min="0" max="50" step="0.5"
                                  value={modelForm.commission_rate}
                                  onChange={e => setModelForm(f => ({ ...f, commission_rate: e.target.value }))}
                                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: 13, outline: "none", background: "#fff" }}
                                />
                              </div>
                            )}
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                onClick={() => modelMut.mutate({ key: svc.service_key, ...modelForm })}
                                disabled={modelMut.isPending}
                                style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#2F7BFF,#0891B2)", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                              >
                                {modelMut.isPending ? "Saving…" : "Save Changes"}
                              </button>
                              <button
                                onClick={() => setEditingModel(null)}
                                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontSize: 12, cursor: "pointer", fontWeight: 600 }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Visibility toggle */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: isActive ? `${cardColor}06` : "#F8FAFC", borderRadius: 12, border: `1px solid ${isActive ? cardColor + "20" : "#E5E7EB"}` }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: "#0F172A", marginBottom: 2 }}>
                              {isActive ? "✅ Visible in customer app" : "🚫 Hidden from customers"}
                            </div>
                            <div style={{ fontSize: 11, color: "#94A3B8" }}>
                              {isActive ? "Customers can book this service" : "Shows as Coming Soon"}
                            </div>
                          </div>
                          <Toggle
                            on={isActive}
                            color={cardColor}
                            onChange={() => toggleMut.mutate({ key: svc.service_key, current: svc.service_status })}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {/* ── Revenue model guide ── */}
      <div style={{ marginTop: 16, background: "linear-gradient(135deg,#0F172A,#1E3A8A)", borderRadius: 20, padding: "22px 26px", border: "1px solid rgba(47,123,255,0.18)", boxShadow: "0 4px 24px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 18 }}>💡</span>
          <span style={{ fontWeight: 800, color: "#fff", fontSize: 14 }}>Revenue Model Guide</span>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {[
            { icon: "📋", title: "Subscription", desc: "Drivers buy Daily / Weekly / Monthly plans. No per-trip deduction. Best for Bike & Auto rides.", color: "#3B82F6" },
            { icon: "💸", title: "Commission",   desc: "Platform deducts a % per completed trip. Best for Parcel, Pool & Outstation services.",      color: "#F97316" },
            { icon: "⚡", title: "Hybrid",       desc: "Driver needs an active plan AND platform takes a small commission. Best for premium services.", color: "#8B5CF6" },
          ].map(g => (
            <div key={g.title} style={{ flex: "1 1 200px", background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: "16px 18px", border: `1px solid ${g.color}30` }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{g.icon}</div>
              <div style={{ fontWeight: 800, color: g.color, fontSize: 13, marginBottom: 6 }}>{g.title}</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>{g.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
