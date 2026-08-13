import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const PAGE_TABS = [
  { label: "Business Info", href: "/admin/business-setup" },
  { label: "Pages & Media", href: "/admin/pages-media" },
  { label: "Configurations", href: "/admin/configurations" },
  { label: "System Settings", href: "/admin/settings" },
];

const CONFIG_TABS = [
  { id: "otp", label: "OTP Setup", icon: "bi-shield-lock-fill", color: "#dc2626", bg: "#fee2e2" },
  { id: "payment", label: "Payment Gateway", icon: "bi-credit-card-fill", color: "#1a73e8", bg: "#e8f0fe" },
  { id: "commission", label: "Commission", icon: "bi-percent", color: "#d97706", bg: "#fef9c3" },
  { id: "credit-limits", label: "Credit Limits", icon: "bi-shield-lock", color: "#be123c", bg: "#ffe4e6" },
  { id: "features", label: "Features", icon: "bi-toggles", color: "#16a34a", bg: "#f0fdf4" },
  { id: "dispatch", label: "Dispatch Settings", icon: "bi-broadcast", color: "#0891b2", bg: "#ecfeff" },
  { id: "sound", label: "Sound Alerts", icon: "bi-volume-up-fill", color: "#7c3aed", bg: "#f5f3ff" },
  { id: "firebase", label: "Firebase & SMS", icon: "bi-bell-fill", color: "#f97316", bg: "#fff7ed" },
  { id: "maps", label: "Google Maps", icon: "bi-map-fill", color: "#059669", bg: "#f0fdf4" },
  { id: "ai", label: "Claude AI", icon: "bi-stars", color: "#7c3aed", bg: "#f5f3ff" },
];

const CHANGE_META: Record<string, { label: string; area: string; risk: "high" | "medium" | "low"; note: string }> = {
  otp_pickup_enabled: { label: "Pickup OTP Verification", area: "OTP Setup", risk: "high", note: "Disabling pickup OTP reduces rider-driver handoff safety." },
  otp_drop_enabled: { label: "Drop-off OTP Verification", area: "OTP Setup", risk: "high", note: "Disabling drop OTP weakens trip completion confirmation." },
  otp_length: { label: "OTP Length", area: "OTP Setup", risk: "medium", note: "Changing OTP length affects app verification flow." },
  razorpay_enabled: { label: "Razorpay Gateway", area: "Payment Gateway", risk: "high", note: "Changing the gateway affects live checkout availability." },
  razorpay_mode: { label: "Razorpay Mode", area: "Payment Gateway", risk: "high", note: "Moving to live mode will charge real customer payments." },
  razorpay_key_id: { label: "Razorpay Key ID", area: "Payment Gateway", risk: "high", note: "Publishing a new payment key changes the active processor identity." },
  razorpay_key_secret: { label: "Razorpay Key Secret", area: "Payment Gateway", risk: "high", note: "A new secret immediately changes payment authentication." },
  razorpay_webhook_secret: { label: "Razorpay Webhook Secret", area: "Payment Gateway", risk: "high", note: "Webhook verification will fail until the active secret matches Razorpay dashboard settings." },
  cash_enabled: { label: "Cash Payment", area: "Payment Gateway", risk: "medium", note: "Turning cash off changes customer payment fallback behavior." },
  wallet_enabled: { label: "Wallet Payment", area: "Payment Gateway", risk: "medium", note: "Turning wallet off affects stored-balance settlement flows." },
  driver_commission_percent: { label: "Driver Commission Percent", area: "Commission", risk: "high", note: "Commission changes affect every newly completed ride." },
  b2b_commission_percent: { label: "B2B Commission Percent", area: "Commission", risk: "high", note: "B2B commission changes affect enterprise delivery settlement." },
  acceptance_timeout_sec: { label: "Acceptance Timeout", area: "Dispatch Settings", risk: "medium", note: "Shorter timers can reduce assignment quality during peak load." },
  max_drivers_to_notify: { label: "Max Drivers to Notify", area: "Dispatch Settings", risk: "medium", note: "Broadcast size changes dispatch reach and notification volume." },
  broadcast_radius_km: { label: "Broadcast Radius", area: "Dispatch Settings", risk: "medium", note: "This changes the search scope for driver assignment." },
  first_accept_wins: { label: "First Accept Wins", area: "Dispatch Settings", risk: "high", note: "Changing dispatch winner logic can alter ride assignment outcomes." },
  auto_assign_on_cancel: { label: "Auto Assign on Cancel", area: "Dispatch Settings", risk: "medium", note: "This changes how the system recovers from driver cancellations." },
  sequential_dispatch: { label: "Sequential Dispatch Mode", area: "Dispatch Settings", risk: "high", note: "Sequential dispatch can slow assignment speed if enabled broadly." },
  group_broadcast: { label: "Driver Group Broadcast", area: "Dispatch Settings", risk: "high", note: "Broadcast behavior changes how quickly rides become visible to drivers." },
  helper_booking_enabled: { label: "Helper Booking Enabled", area: "Dispatch Settings", risk: "medium", note: "This affects parcel and porter booking availability." },
  intercity_driver_verification: { label: "Intercity Driver Verification", area: "Dispatch Settings", risk: "high", note: "Turning this off may allow unverified drivers on intercity trips." },
  firebase_enabled: { label: "Firebase Notifications", area: "Firebase & SMS", risk: "medium", note: "This impacts push delivery for app alerts and fallback flows." },
  firebase_web_api_key: { label: "Firebase Web API Key", area: "Firebase & SMS", risk: "high", note: "This key is required for app auth and client-side Firebase flows." },
  sms_provider: { label: "SMS Provider", area: "Firebase & SMS", risk: "high", note: "Provider changes immediately alter OTP delivery routing." },
  sms_api_key: { label: "SMS API Key", area: "Firebase & SMS", risk: "high", note: "Publishing a new key changes the active OTP delivery credential." },
  google_maps_key: { label: "Google Maps Key", area: "Google Maps", risk: "high", note: "Maps key changes affect pickup search, routing and app geolocation." },
  app_base_url: { label: "App Base URL", area: "Google Maps", risk: "medium", note: "Deep links, receipts and customer-facing redirects depend on the public base URL." },
  anthropic_api_key: { label: "Anthropic API Key", area: "Claude AI", risk: "medium", note: "This changes live AI routing for voice booking requests." },
  sound_sos: { label: "SOS Alert Sound", area: "Sound Alerts", risk: "high", note: "Disabling this reduces urgency signalling for active safety incidents." },
  sound_repeat_count: { label: "Alert Sound Repeat Count", area: "Sound Alerts", risk: "medium", note: "This affects how strongly incoming ride alerts are surfaced." },
};

type ReviewMode = "publish" | "discard" | "navigate";
type ReviewState = { mode: ReviewMode; href?: string } | null;
type ChangeSummary = {
  key: string;
  label: string;
  area: string;
  risk: "high" | "medium" | "low";
  note: string;
  previous: string;
  next: string;
};

function humanizeSettingKey(key: string) {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSettingValue(value: string | undefined) {
  if (value === undefined || value === "") return "Not set";
  if (value === "true") return "Enabled";
  if (value === "false") return "Disabled";
  return value;
}

function buildChangeSummary(key: string, previous: string | undefined, next: string | undefined): ChangeSummary {
  const meta = CHANGE_META[key];
  return {
    key,
    label: meta?.label || humanizeSettingKey(key),
    area: meta?.area || "Configurations",
    risk: meta?.risk || "low",
    note: meta?.note || "This setting changes operational behavior after publish.",
    previous: formatSettingValue(previous),
    next: formatSettingValue(next),
  };
}

function ReviewModal({
  state,
  changes,
  warnings,
  onClose,
  onConfirm,
  pending,
}: {
  state: ReviewState;
  changes: ChangeSummary[];
  warnings: string[];
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  if (!state) return null;

  const isPublish = state.mode === "publish";
  const isDiscard = state.mode === "discard";
  const isNavigate = state.mode === "navigate";
  const title = isPublish
    ? "Review and Publish Runtime Changes"
    : isDiscard
      ? "Discard Staged Changes"
      : "Leave Without Publishing";
  const description = isPublish
    ? "Confirm the operational impact before these staged settings go live."
    : isDiscard
      ? "This will roll back all staged edits on this page to the last saved values."
      : "You have staged changes that are not yet published. Leaving now will discard them.";

  return (
    <div className="modal-backdrop-jago" onClick={onClose}>
      <div className="modal-jago" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-jago-header">
          <div>
            <h5 className="modal-jago-title">{title}</h5>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{description}</div>
          </div>
          <button className="modal-jago-close" onClick={onClose} aria-label="Close review modal">
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <div style={{ paddingTop: 20 }}>
          {(isPublish || isNavigate) && changes.length > 0 && (
            <div className={`card border-0 shadow-sm mb-3 ops-safety-panel${warnings.length ? " is-danger" : ""}`}>
              <div className="card-body">
                <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap mb-3">
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Scope of this publish</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      {changes.length} change{changes.length === 1 ? "" : "s"} across {new Set(changes.map((item) => item.area)).size} operational area{new Set(changes.map((item) => item.area)).size === 1 ? "" : "s"}.
                    </div>
                  </div>
                  <span className="ops-chip">
                    <i className="bi bi-shield-check"></i>
                    Review required
                  </span>
                </div>

                {warnings.length > 0 && (
                  <div className="mb-3" style={{ fontSize: 12, color: "#991b1b" }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Operational warnings</div>
                    {warnings.map((warning) => (
                      <div key={warning} className="d-flex align-items-start gap-2" style={{ marginBottom: 6 }}>
                        <i className="bi bi-exclamation-triangle-fill" style={{ marginTop: 2 }}></i>
                        <span>{warning}</span>
                      </div>
                    ))}
                  </div>
                )}

                <ul className="ops-impact-list">
                  {changes.map((change) => (
                    <li key={change.key} className={`ops-impact-item${change.risk === "high" ? " is-high" : change.risk === "medium" ? " is-medium" : ""}`}>
                      <i
                        className={`bi ${
                          change.risk === "high"
                            ? "bi-exclamation-diamond-fill text-danger"
                            : change.risk === "medium"
                              ? "bi-exclamation-circle-fill text-warning"
                              : "bi-check-circle-fill text-success"
                        }`}
                        style={{ marginTop: 2 }}
                      ></i>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{change.label}</span>
                          <span className="ops-chip">{change.area}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#475569", marginBottom: 4 }}>
                          <strong>{change.previous}</strong> to <strong>{change.next}</strong>
                        </div>
                        <div style={{ fontSize: 11.5, color: "#64748b" }}>{change.note}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {(isDiscard || isNavigate) && (
            <div className="card border-0 shadow-sm mb-3">
              <div className="card-body">
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>What happens next</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {isNavigate
                    ? "Your staged edits will be cleared and the page will switch to the destination you selected."
                    : "All staged values on this page will be cleared and the last saved configuration will remain active."}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="d-flex gap-2 justify-content-end flex-wrap" style={{ paddingTop: 4, paddingBottom: 20 }}>
          <button className="btn btn-outline-secondary" onClick={onClose} disabled={pending}>
            Stay Here
          </button>
          <button
            className={`btn ${isPublish ? "btn-primary" : "btn-danger"}`}
            onClick={onConfirm}
            disabled={pending}
            data-testid={isPublish ? "btn-confirm-publish" : isNavigate ? "btn-confirm-leave" : "btn-confirm-discard"}
          >
            {pending
              ? "Processing..."
              : isPublish
                ? "Publish Changes"
                : isNavigate
                  ? "Discard and Leave"
                  : "Discard Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, desc, value, onChange, id }: any) {
  return (
    <div className="d-flex align-items-center justify-content-between"
      style={{ padding: "14px 0", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ flex: 1, paddingRight: 24 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0f172a" }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{desc}</div>}
      </div>
      <label className="switcher mb-0">
        <input type="checkbox" className="switcher_input"
          checked={value === "true" || value === true}
          onChange={e => onChange(e.target.checked ? "true" : "false")}
          data-testid={`toggle-${id}`} />
        <span className="switcher_control"></span>
      </label>
    </div>
  );
}

function Field({ label, desc, value, onChange, type = "text", placeholder, suffix, id }: any) {
  return (
    <div style={{ padding: "14px 0", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>{label}</div>
      {desc && <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 8 }}>{desc}</div>}
      <div className="input-group">
        <input type={type} className="admin-form-control"
          value={value || ""} onChange={e => onChange(e.target.value)}
          placeholder={placeholder || ""} data-testid={`input-${id}`}
          style={{ fontSize: 13 }} />
        {suffix && <span className="input-group-text" style={{ fontSize: 12 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function NumberField({ label, desc, value, onChange, min, max, suffix, id }: any) {
  return (
    <div className="d-flex align-items-center justify-content-between"
      style={{ padding: "14px 0", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ flex: 1, paddingRight: 24 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0f172a" }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{desc}</div>}
      </div>
      <div className="input-group" style={{ width: 130 }}>
        <input type="number" min={min} max={max} className="admin-form-control text-center"
          value={value || ""} onChange={e => onChange(e.target.value)}
          style={{ fontSize: 15, fontWeight: 700, padding: "6px 10px" }}
          data-testid={`input-${id}`} />
        {suffix && <span className="input-group-text fw-semibold">{suffix}</span>}
      </div>
    </div>
  );
}

export default function ConfigurationsPage() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [tab, setTab] = useState("otp");
  const [local, setLocal] = useState<Record<string, string>>({});
  const [reviewState, setReviewState] = useState<ReviewState>(null);
  const [lastPublishedAt, setLastPublishedAt] = useState<string | null>(null);
  const [lastPublishedCount, setLastPublishedCount] = useState(0);

  const { data: settingsData = [] } = useQuery<any[]>({
    queryKey: ["/api/business-settings"],
    queryFn: () => apiRequest("GET", "/api/business-settings")
      .then(r => r.json())
      .then(d => Array.isArray(d) ? d : []),
  });

  const arr = Array.isArray(settingsData) ? settingsData : [];
  const dbMap: Record<string, string> = {};
  arr.forEach((s: any) => { dbMap[s.keyName] = s.value; });

  // Outstanding Revenue Model, Phase 2 - vehicle-wise credit limits. Saved
  // immediately per row (not part of the stage/publish flow above, since
  // these live in their own table, one row per vehicle category, not the
  // flat business_settings key-value blob).
  const { data: creditLimitsData, isLoading: creditLimitsLoading } = useQuery<{ limits: any[] }>({
    queryKey: ["/api/admin/revenue/credit-limits"],
    queryFn: () => apiRequest("GET", "/api/admin/revenue/credit-limits").then(r => r.json()),
    enabled: tab === "credit-limits",
  });
  const [creditLimitDrafts, setCreditLimitDrafts] = useState<Record<string, string>>({});
  const saveCreditLimit = useMutation({
    mutationFn: (vars: { vehicleCategoryId: string; creditLimit: number }) =>
      apiRequest("PUT", `/api/admin/revenue/credit-limits/${vars.vehicleCategoryId}`, { creditLimit: vars.creditLimit }),
    onSuccess: (_data, vars) => {
      toast({ title: "Credit limit saved" });
      setCreditLimitDrafts(p => { const n = { ...p }; delete n[vars.vehicleCategoryId]; return n; });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/revenue/credit-limits"] });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });
  const clearCreditLimit = useMutation({
    mutationFn: (vehicleCategoryId: string) =>
      apiRequest("DELETE", `/api/admin/revenue/credit-limits/${vehicleCategoryId}`),
    onSuccess: () => {
      toast({ title: "Reverted to global limit" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/revenue/credit-limits"] });
    },
    onError: (e: any) => toast({ title: "Failed to revert", description: e?.message, variant: "destructive" }),
  });

  // Phase 2 - vehicle-wise commission %/platform fee/GST %, same table and
  // save-per-row pattern as credit limits above, backed by its own table
  // (vehicle_revenue_config) so it doesn't interfere with credit-limit saves.
  const { data: vehicleRevenueData, isLoading: vehicleRevenueLoading } = useQuery<{ config: any[] }>({
    queryKey: ["/api/admin/revenue/vehicle-config"],
    queryFn: () => apiRequest("GET", "/api/admin/revenue/vehicle-config").then(r => r.json()),
    enabled: tab === "credit-limits",
  });
  const [vehicleRevenueDrafts, setVehicleRevenueDrafts] = useState<Record<string, { commissionPct?: string; platformFeePerRide?: string; gstPct?: string }>>({});
  const saveVehicleRevenue = useMutation({
    mutationFn: (vars: { vehicleCategoryId: string; commissionPct?: string; platformFeePerRide?: string; gstPct?: string }) =>
      apiRequest("PUT", `/api/admin/revenue/vehicle-config/${vars.vehicleCategoryId}`, {
        commissionPct: vars.commissionPct, platformFeePerRide: vars.platformFeePerRide, gstPct: vars.gstPct,
      }),
    onSuccess: (_data, vars) => {
      toast({ title: "Vehicle revenue config saved" });
      setVehicleRevenueDrafts(p => { const n = { ...p }; delete n[vars.vehicleCategoryId]; return n; });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/revenue/vehicle-config"] });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });
  const clearVehicleRevenue = useMutation({
    mutationFn: (vehicleCategoryId: string) =>
      apiRequest("DELETE", `/api/admin/revenue/vehicle-config/${vehicleCategoryId}`),
    onSuccess: () => {
      toast({ title: "Reverted to module/global defaults" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/revenue/vehicle-config"] });
    },
    onError: (e: any) => toast({ title: "Failed to revert", description: e?.message, variant: "destructive" }),
  });

  const get = (key: string) => local[key] !== undefined ? local[key] : (dbMap[key] ?? "");
  const set = (key: string) => (val: string) => setLocal(p => ({ ...p, [key]: val }));

  const hasChanges = Object.keys(local).length > 0;
  const changedSettings = Object.keys(local)
    .map((key) => buildChangeSummary(key, dbMap[key], local[key]))
    .sort((a, b) => {
      const riskWeight = { high: 0, medium: 1, low: 2 };
      return riskWeight[a.risk] - riskWeight[b.risk] || a.area.localeCompare(b.area) || a.label.localeCompare(b.label);
    });
  const changedAreas = Array.from(new Set(changedSettings.map((item) => item.area)));
  const criticalCount = changedSettings.filter((item) => item.risk === "high").length;
  const currentOtpEnabled = get("otp_pickup_enabled") === "true" || get("otp_drop_enabled") === "true";
  const currentLivePayments = get("razorpay_enabled") === "true" && get("razorpay_mode") === "live";
  const runtimeWarnings = [
    currentLivePayments ? "Razorpay is staged in live mode. Real customer payments will be charged after publish." : "",
    !currentOtpEnabled ? "Both pickup and drop OTP are disabled in the staged state." : "",
    currentOtpEnabled && !get("sms_api_key") ? "OTP is enabled but the staged configuration does not include an SMS API key." : "",
    get("sound_sos") === "false" ? "SOS alert sound is staged as disabled, which lowers visibility for active safety incidents." : "",
    get("intercity_driver_verification") === "false" ? "Intercity verification is staged as disabled, which broadens eligible driver scope." : "",
    get("sequential_dispatch") === "true" && get("group_broadcast") !== "true"
      ? "Sequential dispatch is enabled without group broadcast, which may slow ride allocation during peak demand."
      : "",
  ].filter(Boolean);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasChanges) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasChanges]);

  useEffect(() => {
    if (!hasChanges) return;

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/admin/") || href === location) return;
      event.preventDefault();
      setReviewState({ mode: "navigate", href });
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [hasChanges, location]);

  const save = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/business-settings", local),
    onSuccess: () => {
      const publishedCount = Object.keys(local).length;
      queryClient.invalidateQueries({ queryKey: ["/api/business-settings"] });
      setLocal({});
      setLastPublishedAt(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
      setLastPublishedCount(publishedCount);
      setReviewState(null);
      toast({ title: "Settings saved successfully" });
    },
    onError: (e: any) => toast({ title: "Failed to save settings", description: e.message, variant: "destructive" }),
  });

  const curTab = CONFIG_TABS.find(t => t.id === tab)!;
  const openPublishReview = () => {
    if (!hasChanges) return;
    setReviewState({ mode: "publish" });
  };
  const openDiscardReview = () => {
    if (!hasChanges) return;
    setReviewState({ mode: "discard" });
  };
  const handlePageTabClick = (href: string) => {
    if (href === location) return;
    if (hasChanges) {
      setReviewState({ mode: "navigate", href });
      return;
    }
    setLocation(href);
  };
  const handleReviewConfirm = () => {
    if (!reviewState) return;
    if (reviewState.mode === "publish") {
      save.mutate();
      return;
    }
    if (reviewState.mode === "discard") {
      setLocal({});
      setReviewState(null);
      toast({ title: "Staged changes discarded" });
      return;
    }
    if (reviewState.mode === "navigate" && reviewState.href) {
      const destination = reviewState.href;
      setLocal({});
      setReviewState(null);
      setLocation(destination);
    }
  };

  return (
    <div className="container-fluid">
      {/* Header */}
      <div className="ops-page-header">
        <div>
          <h4 className="fw-bold mb-0">Configurations</h4>
          <div className="text-muted small">OTP setup, payment gateway, commission rates and feature toggles</div>
          <div className="ops-page-header__meta">
            <span className="ops-chip">
              <i className="bi bi-diagram-3"></i>
              {changedAreas.length || 1} operational area{changedAreas.length === 1 ? "" : "s"}
            </span>
            <span className="ops-chip">
              <i className="bi bi-shield-exclamation"></i>
              {criticalCount} critical change{criticalCount === 1 ? "" : "s"}
            </span>
            <span className="ops-chip">
              <i className="bi bi-clock-history"></i>
              {lastPublishedAt ? `Last published ${lastPublishedAt}` : "No publish in this session"}
            </span>
          </div>
        </div>
        {hasChanges ? (
          <button className="btn btn-primary" onClick={openPublishReview} disabled={save.isPending}
            data-testid="btn-save-settings">
            {save.isPending
              ? <><span className="spinner-border spinner-border-sm me-2"></span>Saving…</>
              : <><i className="bi bi-send-check-fill me-1"></i>Review and Publish</>}
          </button>
        ) : (
          <div className="ops-chip">
            <i className="bi bi-check2-circle text-success"></i>
            Runtime config is stable
          </div>
        )}
      </div>

      {/* Page-level tabs */}
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <ul className="nav nav--tabs p-1 rounded bg-light">
            {PAGE_TABS.map(t => (
              <li key={t.href} className="nav-item">
                <button type="button" className={`nav-link${t.href === location ? " active" : ""}`} onClick={() => handlePageTabClick(t.href)}>
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Config section tabs — horizontal, icon-based */}
      <div className={`card border-0 shadow-sm mb-4 ops-safety-panel${runtimeWarnings.length ? " is-danger" : ""}`} style={{ borderRadius: 14 }}>
        <div className="card-body">
          <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>Runtime governance safety</div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Staged edits do not go live until you publish them. Review scope, impact and warnings before applying operational changes.
              </div>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <span className="ops-chip">
                <i className="bi bi-layers"></i>
                {hasChanges ? `${changedSettings.length} staged` : "No staged changes"}
              </span>
              <span className="ops-chip">
                <i className="bi bi-arrow-counterclockwise"></i>
                {hasChanges ? "Discard restores last saved state" : `Last publish touched ${lastPublishedCount || 0} setting${lastPublishedCount === 1 ? "" : "s"}`}
              </span>
            </div>
          </div>
          {runtimeWarnings.length > 0 && (
            <div className="mt-3" style={{ fontSize: 12, color: "#991b1b" }}>
              {runtimeWarnings.map((warning) => (
                <div key={warning} className="d-flex align-items-start gap-2" style={{ marginBottom: 6 }}>
                  <i className="bi bi-exclamation-triangle-fill" style={{ marginTop: 2 }}></i>
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="ops-section-grid mb-4">
        {CONFIG_TABS.map(ct => (
          <div key={ct.id}>
            <button
              onClick={() => setTab(ct.id)}
              className="w-100 text-start border-0 ops-section-card"
              style={{
                background: tab === ct.id ? ct.color : "#fff",
                color: tab === ct.id ? "#fff" : "#475569",
                borderRadius: 14,
                padding: "14px 15px",
                cursor: "pointer",
                boxShadow: tab === ct.id ? `0 8px 20px ${ct.color}2f` : "0 1px 4px rgba(0,0,0,0.05)",
                transition: "all .15s",
                border: `1.5px solid ${tab === ct.id ? ct.color : "#e2e8f0"}`,
              }}
              data-testid={`tab-config-${ct.id}`}>
              <div className="d-flex align-items-center gap-2 mb-1">
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: tab === ct.id ? "rgba(255,255,255,0.2)" : ct.bg,
                  color: tab === ct.id ? "#fff" : ct.color,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, flexShrink: 0,
                }}>
                  <i className={`bi ${ct.icon}`}></i>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.2 }}>{ct.label}</span>
              </div>
            </button>
          </div>
        ))}
      </div>

      {/* Section header */}
      <div className="d-flex align-items-center gap-3 mb-3">
        <div style={{
          width: 42, height: 42, borderRadius: 12,
          background: curTab.bg, color: curTab.color,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
        }}>
          <i className={`bi ${curTab.icon}`}></i>
        </div>
        <div>
          <h5 className="fw-bold mb-0">{curTab.label}</h5>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {tab === "otp" && "Configure OTP verification for rides and parcels"}
            {tab === "payment" && "Setup Razorpay, Cash and Wallet payment methods"}
            {tab === "commission" && "Platform fees for B2C rides and B2B deliveries"}
            {tab === "credit-limits" && "Outstanding balance a driver may reach, per vehicle category, before auto-lock"}
            {tab === "features" && "Enable or disable platform features instantly"}
            {tab === "firebase" && "Push notifications and SMS gateway settings"}
            {tab === "maps" && "Google Maps API for location and routing"}
            {tab === "ai" && "Claude AI for voice booking — understands Telugu, Hindi, English"}
          </div>
        </div>
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        <div className="card-body p-4">

          {/* ===== OTP SETUP ===== */}
          {tab === "otp" && (
            <div>
              <div className="d-flex gap-2 mb-4 p-3 rounded-3" style={{ background: "#fef9c3", border: "1px solid #fde047" }}>
                <i className="bi bi-info-circle-fill text-warning mt-1" style={{ fontSize: 13, flexShrink: 0 }}></i>
                <div style={{ fontSize: 12.5, color: "#713f12" }}>
                  OTP verification ensures the right passenger gets into the right vehicle. Enable both pickup and drop OTP for maximum security.
                </div>
              </div>

              <Toggle label="Pickup OTP Verification" id="otp_pickup"
                desc="Driver asks customer to share OTP when reaching pickup location"
                value={get("otp_pickup_enabled")} onChange={set("otp_pickup_enabled")} />

              <Toggle label="Drop-off OTP Verification" id="otp_drop"
                desc="Customer enters OTP at destination before trip ends"
                value={get("otp_drop_enabled")} onChange={set("otp_drop_enabled")} />

              <NumberField label="OTP Length (digits)" id="otp_length"
                desc="Number of digits in OTP code — 4 digits recommended"
                value={get("otp_length")} onChange={set("otp_length")} min={4} max={8} suffix="digits" />

              <div className="row g-3 mt-2">
                {[
                  { key: "otp_pickup_enabled", label: "Pickup OTP", icon: "bi-geo-alt-fill", desc: "When driver arrives" },
                  { key: "otp_drop_enabled", label: "Drop OTP", icon: "bi-flag-fill", desc: "When trip ends" },
                ].map(card => {
                  const isOn = get(card.key) === "true";
                  return (
                    <div key={card.key} className="col-6">
                      <div className="card border-0" style={{
                        borderRadius: 12, padding: 16,
                        background: isOn ? "#f0fdf4" : "#f8fafc",
                        border: `1.5px solid ${isOn ? "#86efac" : "#e2e8f0"}`,
                      }}>
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <i className={`bi ${card.icon}`} style={{ color: isOn ? "#16a34a" : "#94a3b8", fontSize: 16 }}></i>
                          <div style={{ fontSize: 13, fontWeight: 700, color: isOn ? "#166534" : "#475569" }}>{card.label}</div>
                        </div>
                        <div style={{ fontSize: 11.5, color: isOn ? "#16a34a" : "#94a3b8" }}>{card.desc}</div>
                        <div className="mt-2">
                          <span className="badge" style={{
                            background: isOn ? "#16a34a" : "#e2e8f0",
                            color: isOn ? "#fff" : "#475569",
                            fontSize: 10, padding: "3px 8px",
                          }}>
                            {isOn ? "ENABLED" : "DISABLED"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ===== PAYMENT GATEWAY ===== */}
          {tab === "payment" && (
            <div>
              {/* Cash & Wallet */}
              <div className="mb-4">
                <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>
                  Basic Payment Methods
                </div>
                <Toggle label="Cash Payment" id="cash_enabled"
                  desc="Allow customers to pay in cash after the trip"
                  value={get("cash_enabled")} onChange={set("cash_enabled")} />
                <Toggle label="Wallet Payment" id="wallet_enabled"
                  desc="Allow customers to pay from JAGO in-app wallet"
                  value={get("wallet_enabled")} onChange={set("wallet_enabled")} />
              </div>

              {/* Razorpay */}
              <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 16 }}>
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div className="d-flex align-items-center gap-3">
                    <div style={{ width: 42, height: 42, borderRadius: 10, background: "#1a73e808", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontWeight: 900, fontSize: 15, color: "#1a73e8" }}>R</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Razorpay</div>
                      <div style={{ fontSize: 11.5, color: "#94a3b8" }}>India's leading payment gateway</div>
                    </div>
                  </div>
                  <label className="switcher mb-0">
                    <input type="checkbox" className="switcher_input"
                      checked={get("razorpay_enabled") === "true"}
                      onChange={e => set("razorpay_enabled")(e.target.checked ? "true" : "false")}
                      data-testid="toggle-razorpay" />
                    <span className="switcher_control"></span>
                  </label>
                </div>

                {/* Mode toggle */}
                <div className="d-flex gap-2 mb-3">
                  {["test", "live"].map(mode => (
                    <button key={mode}
                      onClick={() => set("razorpay_mode")(mode)}
                      className="btn btn-sm"
                      style={{
                        borderRadius: 8, fontSize: 12, fontWeight: 700,
                        background: get("razorpay_mode") === mode ? (mode === "live" ? "#16a34a" : "#d97706") : "#f8fafc",
                        color: get("razorpay_mode") === mode ? "#fff" : "#64748b",
                        border: `1.5px solid ${get("razorpay_mode") === mode ? (mode === "live" ? "#16a34a" : "#d97706") : "#e2e8f0"}`,
                        padding: "5px 16px",
                      }}
                      data-testid={`btn-razorpay-${mode}`}>
                      {mode === "test" ? "Test Mode" : "Live Mode"}
                    </button>
                  ))}
                  {get("razorpay_mode") === "test" && (
                    <span className="badge align-self-center" style={{ background: "#fef9c3", color: "#713f12", fontSize: 10 }}>
                      Payments will not be charged in Test mode
                    </span>
                  )}
                  {get("razorpay_mode") === "live" && (
                    <span className="badge align-self-center" style={{ background: "#f0fdf4", color: "#166534", fontSize: 10 }}>
                      Real payments will be charged
                    </span>
                  )}
                </div>

                <div className="row g-3">
                  <div className="col-12 col-md-6">
                    <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6, display: "block" }}>
                      Key ID <span className="text-danger">*</span>
                      <span style={{ fontWeight: 400, color: "#94a3b8", marginLeft: 6 }}>
                        (rzp_{get("razorpay_mode") === "live" ? "live" : "test"}_XXXX)
                      </span>
                    </label>
                    <input className="admin-form-control"
                      value={get("razorpay_key_id")} onChange={e => set("razorpay_key_id")(e.target.value)}
                      placeholder={`rzp_${get("razorpay_mode") === "live" ? "live" : "test"}_xxxxxxxxxxxxxxxx`}
                      data-testid="input-razorpay-key-id" style={{ fontSize: 12, fontFamily: "monospace" }} />
                  </div>
                  <div className="col-12 col-md-6">
                    <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6, display: "block" }}>
                      Key Secret <span className="text-danger">*</span>
                    </label>
                    <input type="password" className="admin-form-control"
                      value={get("razorpay_key_secret")} onChange={e => set("razorpay_key_secret")(e.target.value)}
                      placeholder="Enter secret key"
                      data-testid="input-razorpay-secret" style={{ fontSize: 12 }} />
                  </div>
                  <div className="col-12">
                    <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6, display: "block" }}>
                      Webhook Secret <span className="text-danger">*</span>
                    </label>
                    <input type="password" className="admin-form-control"
                      value={get("razorpay_webhook_secret")} onChange={e => set("razorpay_webhook_secret")(e.target.value)}
                      placeholder="Enter Razorpay webhook secret"
                      data-testid="input-razorpay-webhook-secret" style={{ fontSize: 12 }} />
                    <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 6 }}>
                      Payment verification and webhook replay correct ga work avvalante Razorpay dashboard lo set chesina same secret ikkada undali.
                    </div>
                  </div>
                </div>

                <div className="mt-3 p-3 rounded-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
                    <i className="bi bi-info-circle me-1"></i>How to get Razorpay keys:
                  </div>
                  <ol style={{ fontSize: 11.5, color: "#64748b", margin: 0, paddingLeft: 16 }}>
                    <li>Login to <strong>dashboard.razorpay.com</strong></li>
                    <li>Go to Settings → API Keys</li>
                    <li>Click <strong>Generate Test/Live Key</strong></li>
                    <li>Copy Key ID and Secret, paste here</li>
                  </ol>
                </div>
              </div>

              {get("razorpay_enabled") !== "true" && (
                <div className="d-flex gap-2 p-3 rounded-3" style={{ background: "#f0f9ff", border: "1px solid #bae6fd" }}>
                  <i className="bi bi-lightbulb-fill text-info mt-1" style={{ fontSize: 13, flexShrink: 0 }}></i>
                  <div style={{ fontSize: 12, color: "#0c4a6e" }}>
                    Enable Razorpay toggle above to accept UPI, Cards, Net Banking, and EMI payments. Currently only Cash and Wallet payments are active.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== COMMISSION ===== */}
          {tab === "commission" && (
            <div>
              <div className="row g-3 mb-4">
                {[
                  { key: "platform_commission_b2c", label: "B2C Commission", desc: "Customer rides (Bike, Auto, Car, SUV)", color: "#1a73e8", bg: "#e8f0fe" },
                  { key: "platform_commission_b2b", label: "B2B Commission", desc: "Porter and business deliveries", color: "#7c3aed", bg: "#f5f3ff" },
                  { key: "driver_payout_pct", label: "Driver Payout", desc: "Driver gets this % of fare", color: "#16a34a", bg: "#f0fdf4" },
                ].map(card => (
                  <div key={card.key} className="col-12 col-md-4">
                    <div style={{ borderRadius: 14, background: card.bg, border: `1.5px solid ${card.color}22`, padding: 20, textAlign: "center" }}>
                      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8, fontWeight: 600 }}>{card.label}</div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                        <input type="number" min="0" max="100" step="0.5"
                          className="admin-form-control text-center"
                          style={{ width: 80, fontSize: 28, fontWeight: 900, color: card.color, border: "none", background: "transparent", padding: "4px 0" }}
                          value={get(card.key)} onChange={e => set(card.key)(e.target.value)}
                          data-testid={`input-${card.key}`} />
                        <span style={{ fontSize: 24, fontWeight: 900, color: card.color }}>%</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{card.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <NumberField label="Driver Search Radius (km)" id="driver_search_radius"
                desc="How far to search for available drivers from pickup location"
                value={get("driver_search_radius")} onChange={set("driver_search_radius")}
                min={1} max={50} suffix="km" />

              <NumberField label="Ride Request Timeout (sec)" id="ride_request_timeout"
                desc="Seconds before ride request expires if no driver accepts"
                value={get("ride_request_timeout")} onChange={set("ride_request_timeout")}
                min={10} max={120} suffix="sec" />

              <NumberField label="Surge Multiplier Cap" id="surge_max_multiplier"
                desc="Maximum allowed surge pricing multiplier (e.g. 3 = 3× normal fare)"
                value={get("surge_max_multiplier") || "3"} onChange={set("surge_max_multiplier")}
                min={1} max={10} suffix="×" />
            </div>
          )}

          {/* ===== CREDIT LIMITS (Outstanding Revenue Model, Phase 2) ===== */}
          {tab === "credit-limits" && (
            <div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16, lineHeight: 1.5 }}>
                A driver's Outstanding balance is their total dues to the platform (Commission + GST, or
                Platform Fee + GST). When it exceeds the credit limit below for their vehicle category, the
                driver is auto-locked. Any category left blank keeps using the global Auto-Lock Threshold
                configured under Commission.
              </div>
              {creditLimitsLoading && <div className="text-muted small">Loading vehicle categories&hellip;</div>}
              {!creditLimitsLoading && (
                <div className="table-responsive">
                  <table className="table align-middle">
                    <thead>
                      <tr>
                        <th>Vehicle Category</th>
                        <th>Service</th>
                        <th>Credit Limit (&#8377;)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(creditLimitsData?.limits || []).map((row: any) => {
                        const draft = creditLimitDrafts[row.vehicleCategoryId];
                        const displayValue = draft !== undefined ? draft : (row.creditLimit ?? "");
                        return (
                          <tr key={row.vehicleCategoryId}>
                            <td className="fw-semibold">{row.name}</td>
                            <td className="text-muted text-capitalize">{row.serviceType}</td>
                            <td style={{ maxWidth: 160 }}>
                              <input
                                type="number" min="1" step="1"
                                className="admin-form-control"
                                placeholder="Uses global limit"
                                value={displayValue}
                                onChange={e => setCreditLimitDrafts(p => ({ ...p, [row.vehicleCategoryId]: e.target.value }))}
                                data-testid={`input-credit-limit-${row.vehicleCategoryId}`}
                              />
                            </td>
                            <td className="d-flex gap-2">
                              <button
                                className="btn btn-sm btn-primary"
                                disabled={draft === undefined || draft === "" || saveCreditLimit.isPending}
                                onClick={() => saveCreditLimit.mutate({ vehicleCategoryId: row.vehicleCategoryId, creditLimit: parseFloat(draft) })}
                                data-testid={`button-save-credit-limit-${row.vehicleCategoryId}`}
                              >
                                Save
                              </button>
                              {row.creditLimit != null && (
                                <button
                                  className="btn btn-sm btn-outline-secondary"
                                  disabled={clearCreditLimit.isPending}
                                  onClick={() => clearCreditLimit.mutate(row.vehicleCategoryId)}
                                  data-testid={`button-clear-credit-limit-${row.vehicleCategoryId}`}
                                >
                                  Revert to global
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ fontSize: 12, color: "#64748b", margin: "28px 0 16px", lineHeight: 1.5 }}>
                Vehicle-wise revenue rates. Any field left blank keeps using the existing service-level
                config (Commission tab) or global settings for that vehicle category.
              </div>
              {vehicleRevenueLoading && <div className="text-muted small">Loading vehicle categories&hellip;</div>}
              {!vehicleRevenueLoading && (
                <div className="table-responsive">
                  <table className="table align-middle">
                    <thead>
                      <tr>
                        <th>Vehicle Category</th>
                        <th>Service</th>
                        <th>Commission (%)</th>
                        <th>Platform Fee (&#8377;/ride)</th>
                        <th>GST (%)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(vehicleRevenueData?.config || []).map((row: any) => {
                        const draft = vehicleRevenueDrafts[row.vehicleCategoryId] || {};
                        const commissionPct = draft.commissionPct !== undefined ? draft.commissionPct : (row.commissionPct ?? "");
                        const platformFeePerRide = draft.platformFeePerRide !== undefined ? draft.platformFeePerRide : (row.platformFeePerRide ?? "");
                        const gstPct = draft.gstPct !== undefined ? draft.gstPct : (row.gstPct ?? "");
                        const hasDraft = draft.commissionPct !== undefined || draft.platformFeePerRide !== undefined || draft.gstPct !== undefined;
                        const hasOverride = row.commissionPct != null || row.platformFeePerRide != null || row.gstPct != null;
                        const updateDraft = (field: "commissionPct" | "platformFeePerRide" | "gstPct") => (val: string) =>
                          setVehicleRevenueDrafts(p => ({ ...p, [row.vehicleCategoryId]: { ...p[row.vehicleCategoryId], [field]: val } }));
                        return (
                          <tr key={row.vehicleCategoryId}>
                            <td className="fw-semibold">{row.name}</td>
                            <td className="text-muted text-capitalize">{row.serviceType}</td>
                            <td style={{ maxWidth: 130 }}>
                              <input type="number" min="0" step="0.1" className="admin-form-control" placeholder="Service default"
                                value={commissionPct} onChange={e => updateDraft("commissionPct")(e.target.value)}
                                data-testid={`input-vehicle-commission-${row.vehicleCategoryId}`} />
                            </td>
                            <td style={{ maxWidth: 150 }}>
                              <input type="number" min="0" step="0.5" className="admin-form-control" placeholder="Service default"
                                value={platformFeePerRide} onChange={e => updateDraft("platformFeePerRide")(e.target.value)}
                                data-testid={`input-vehicle-platform-fee-${row.vehicleCategoryId}`} />
                            </td>
                            <td style={{ maxWidth: 130 }}>
                              <input type="number" min="0" step="0.1" className="admin-form-control" placeholder="Service default"
                                value={gstPct} onChange={e => updateDraft("gstPct")(e.target.value)}
                                data-testid={`input-vehicle-gst-${row.vehicleCategoryId}`} />
                            </td>
                            <td className="d-flex gap-2">
                              <button className="btn btn-sm btn-primary" disabled={!hasDraft || saveVehicleRevenue.isPending}
                                onClick={() => saveVehicleRevenue.mutate({ vehicleCategoryId: row.vehicleCategoryId, commissionPct, platformFeePerRide, gstPct })}
                                data-testid={`button-save-vehicle-revenue-${row.vehicleCategoryId}`}>
                                Save
                              </button>
                              {hasOverride && (
                                <button className="btn btn-sm btn-outline-secondary" disabled={clearVehicleRevenue.isPending}
                                  onClick={() => clearVehicleRevenue.mutate(row.vehicleCategoryId)}
                                  data-testid={`button-clear-vehicle-revenue-${row.vehicleCategoryId}`}>
                                  Revert to defaults
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ===== FEATURES ===== */}
          {tab === "features" && (
            <div>
              <div className="row g-3 mb-4">
                {[
                  { key: "intercity_enabled", label: "Intercity Pool", icon: "bi-signpost-2-fill", color: "#1a73e8" },
                  { key: "car_sharing_enabled", label: "Local Pool", icon: "bi-people-fill", color: "#7c3aed" },
                  { key: "parcel_subscription_enabled", label: "Parcel Subscriptions", icon: "bi-box-seam-fill", color: "#16a34a" },
                  { key: "ride_subscription_enabled", label: "Ride Subscriptions", icon: "bi-car-front-fill", color: "#d97706" },
                  { key: "surge_pricing_enabled", label: "Surge Pricing", icon: "bi-lightning-charge-fill", color: "#dc2626" },
                  { key: "otp_pickup_enabled", label: "Pickup OTP", icon: "bi-shield-check-fill", color: "#0891b2" },
                  { key: "otp_drop_enabled", label: "Drop OTP", icon: "bi-shield-fill", color: "#0891b2" },
                  { key: "cash_enabled", label: "Cash Payments", icon: "bi-cash-coin", color: "#16a34a" },
                  { key: "wallet_enabled", label: "Wallet Payments", icon: "bi-wallet-fill", color: "#7c3aed" },
                ].map(item => {
                  const isOn = get(item.key) === "true";
                  return (
                    <div key={item.key} className="col-6 col-md-4">
                      <div style={{
                        borderRadius: 12, padding: "12px 14px",
                        background: isOn ? item.color + "10" : "#f8fafc",
                        border: `1.5px solid ${isOn ? item.color + "33" : "#e2e8f0"}`,
                      }}>
                        <div className="d-flex align-items-center justify-content-between mb-1">
                          <div className="d-flex align-items-center gap-2">
                            <i className={`bi ${item.icon}`} style={{ fontSize: 14, color: isOn ? item.color : "#94a3b8" }}></i>
                            <span style={{ fontSize: 12, fontWeight: 600, color: isOn ? "#0f172a" : "#64748b" }}>{item.label}</span>
                          </div>
                        </div>
                        <label className="switcher">
                          <input type="checkbox" className="switcher_input"
                            checked={isOn}
                            onChange={e => set(item.key)(e.target.checked ? "true" : "false")}
                            data-testid={`toggle-feature-${item.key}`} />
                          <span className="switcher_control"></span>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ===== FIREBASE & SMS ===== */}
          {tab === "firebase" && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 12 }}>
                Firebase Push Notifications
              </div>

              <Field label="Firebase Server Key" id="firebase_server_key"
                desc="Found in Firebase Console → Project Settings → Cloud Messaging → Server key"
                value={get("firebase_server_key")} onChange={set("firebase_server_key")}
                type="password" placeholder="AAAAxxxxxxxx:APA91b..." />

              <Field label="Firebase Project ID" id="firebase_project_id"
                desc="Found in Firebase Console → Project Settings → General → Project ID"
                value={get("firebase_project_id")} onChange={set("firebase_project_id")}
                placeholder="jago-app-xxxxx" />

              <Field label="Firebase Service Account JSON" id="firebase_service_account"
                desc='Firebase Console → Project Settings → Service accounts → Generate new private key → JSON content paste cheyyi. Push notifications + phone auth ki required.'
                value={get("firebase_service_account")} onChange={set("firebase_service_account")}
                type="password" placeholder='{"type":"service_account","project_id":"..."}' />

              <Field label="Firebase Web API Key" id="firebase_web_api_key"
                desc="Firebase app auth and client SDK readiness kosam required. Project settings nunchi Web API key paste cheyyi."
                value={get("firebase_web_api_key")} onChange={set("firebase_web_api_key")}
                type="password" placeholder="AIzaSy..." />

              <div style={{ height: 24 }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 12 }}>
                SMS Gateway
              </div>

              <div style={{ padding: "14px 0", borderBottom: "1px solid #f1f5f9" }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0f172a", marginBottom: 8 }}>SMS Provider</div>
                <div className="d-flex gap-2">
                  {["msg91", "twilio", "nexmo"].map(p => (
                    <button key={p}
                      onClick={() => set("sms_provider")(p)}
                      style={{
                        borderRadius: 8, fontSize: 12, fontWeight: 700,
                        background: get("sms_provider") === p ? "#1a73e8" : "#f8fafc",
                        color: get("sms_provider") === p ? "#fff" : "#64748b",
                        border: `1.5px solid ${get("sms_provider") === p ? "#1a73e8" : "#e2e8f0"}`,
                        padding: "7px 18px", cursor: "pointer",
                      }}
                      data-testid={`btn-sms-${p}`}>
                      {p.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <Field label="SMS API Key" id="sms_api_key"
                desc={`API key for ${(get("sms_provider") || "MSG91").toUpperCase()} SMS gateway`}
                value={get("sms_api_key")} onChange={set("sms_api_key")}
                type="password" placeholder="Enter SMS API key" />

              <div className="mt-3 p-3 rounded-3" style={{ background: "#f0f9ff", border: "1px solid #bae6fd" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0369a1", marginBottom: 4 }}>
                  <i className="bi bi-phone-fill me-1"></i>SMS is used for OTP delivery
                </div>
                <div style={{ fontSize: 11.5, color: "#0c4a6e" }}>
                  Make sure SMS gateway is configured before enabling OTP verification. Without it, customers won't receive OTP codes.
                </div>
              </div>
            </div>
          )}

          {/* ===== GOOGLE MAPS ===== */}
          {tab === "maps" && (
            <div>
              <div className="d-flex gap-3 mb-4 p-3 rounded-3" style={{ background: "#f5f3ff", border: "1px solid #c4b5fd" }}>
                <i className="bi bi-map-fill text-purple mt-1" style={{ fontSize: 18, color: "#7c3aed", flexShrink: 0 }}></i>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#4c1d95" }}>Google Maps API</div>
                  <div style={{ fontSize: 12, color: "#6d28d9" }}>Used for pickup/drop location selection, distance calculation, and routing in the Flutter app.</div>
                </div>
              </div>

              <Field label="Google Maps API Key" id="google_maps_key"
                desc="Enable Maps SDK for Android, iOS and Places API in Google Cloud Console"
                value={get("google_maps_key")} onChange={set("google_maps_key")}
                type="password" placeholder="AIzaSy..." />

              <Field label="Public App Base URL" id="app_base_url"
                desc="Receipts, redirects, deep links, and customer-facing callback URLs kosam use ayye public domain. Example: https://jagopro.org"
                value={get("app_base_url")} onChange={set("app_base_url")}
                placeholder="https://your-domain.com" />

              <div className="mt-3 p-3 rounded-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
                  <i className="bi bi-info-circle me-1"></i>Required APIs to enable in Google Cloud:
                </div>
                <div className="row g-2">
                  {["Maps SDK for Android", "Maps SDK for iOS", "Places API", "Directions API", "Distance Matrix API", "Geocoding API"].map(api => (
                    <div key={api} className="col-6 col-md-4">
                      <div style={{ fontSize: 11.5, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
                        <i className="bi bi-check-circle-fill text-success" style={{ fontSize: 10 }}></i>
                        {api}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ===== CLAUDE AI ===== */}
          {tab === "ai" && (
            <div>
              <div className="d-flex gap-3 mb-4 p-3 rounded-3" style={{ background: "linear-gradient(135deg,#f5f3ff,#ede9fe)", border: "1.5px solid #c4b5fd" }}>
                <i className="bi bi-stars mt-1" style={{ fontSize: 22, color: "#7c3aed", flexShrink: 0 }}></i>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#4c1d95" }}>Claude AI — Voice Booking Intelligence</div>
                  <div style={{ fontSize: 12, color: "#6d28d9", marginTop: 3 }}>
                    Users voice lo ride/parcel book cheyagalaru — Telugu, Hindi, English anni support avutundi.
                    API Key paste chesthe immediately activate avutundi. Cost: ~₹0.001 per voice request.
                  </div>
                </div>
              </div>

              <Field label="Anthropic API Key" id="anthropic_api_key"
                desc='console.anthropic.com → API Keys → Create Key. Format: sk-ant-api03-...'
                value={get("anthropic_api_key")} onChange={set("anthropic_api_key")}
                type="password" placeholder="sk-ant-api03-..." />

              <div className="mt-3 p-3 rounded-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 8 }}>
                  <i className="bi bi-info-circle me-1"></i>Voice commands supported:
                </div>
                <div className="row g-2">
                  {[
                    '"Book a bike from JNTU to Hitech City"',
                    '"JNTU nundi Hitech City ki bike kavali"',
                    '"Auto bulao JNTU se Hitech City"',
                    '"Send parcel from Kukatpally to Miyapur"',
                    '"Parcel pampinchu Ameerpet ki"',
                    '"Cancel my ride"',
                  ].map(ex => (
                    <div key={ex} className="col-12 col-md-6">
                      <div style={{ fontSize: 11.5, color: "#64748b", display: "flex", alignItems: "flex-start", gap: 6 }}>
                        <i className="bi bi-mic-fill mt-1" style={{ fontSize: 10, color: "#7c3aed", flexShrink: 0 }}></i>
                        <span style={{ fontStyle: "italic" }}>{ex}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 p-3 rounded-3 d-flex gap-2 align-items-start" style={{ background: "#fefce8", border: "1px solid #fde68a" }}>
                <i className="bi bi-lightning-charge-fill mt-1" style={{ color: "#d97706", flexShrink: 0 }}></i>
                <div style={{ fontSize: 12, color: "#92400e" }}>
                  Key save chesaaka server automatically Claude AI use chestundi. No restart needed.
                  Key lekapothe regex fallback use avutundi (English basic patterns only).
                </div>
              </div>
            </div>
          )}

          {/* ===== DISPATCH SETTINGS ===== */}
          {tab === "dispatch" && (
            <div>
              <div className="mb-4 p-3 rounded-3" style={{ background: "linear-gradient(135deg,#ecfeff,#f0f9ff)", border: "1.5px solid #bae6fd" }}>
                <div className="d-flex align-items-center gap-2 mb-1">
                  <i className="bi bi-broadcast text-info" style={{ fontSize: 18 }}></i>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#0891b2" }}>Auto Dispatch Engine</span>
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Controls how ride requests are assigned to drivers — acceptance timer, smart matching, auto-cancel logic</div>
              </div>

              <div style={{ fontWeight: 700, fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>Driver Acceptance</div>

              <Field label="Acceptance Timeout (seconds)" id="acceptance_timeout_sec"
                desc="Time given to a driver to accept a ride before it moves to the next driver. Recommended: 30 seconds"
                value={get("acceptance_timeout_sec") || "30"} onChange={set("acceptance_timeout_sec")}
                type="number" placeholder="30" suffix="sec" />

              <Field label="Max Drivers to Notify" id="max_drivers_to_notify"
                desc="Maximum number of drivers to simultaneously broadcast a ride request to"
                value={get("max_drivers_to_notify") || "5"} onChange={set("max_drivers_to_notify")}
                type="number" placeholder="5" suffix="drivers" />

              <Field label="Driver Broadcast Radius (km)" id="broadcast_radius_km"
                desc="How far from pickup to search for available drivers"
                value={get("broadcast_radius_km") || "5"} onChange={set("broadcast_radius_km")}
                type="number" placeholder="5" suffix="km" />

              <div style={{ fontWeight: 700, fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8, marginTop: 20 }}>Smart Assignment Logic</div>

              <Toggle label="First Accept Wins" id="first_accept_wins"
                desc="When multiple drivers receive the same request, only the first to accept gets the ride. Others are notified automatically."
                value={get("first_accept_wins") || "true"} onChange={set("first_accept_wins")} />

              <Toggle label="Auto-Assign on Driver Cancel" id="auto_assign_on_cancel"
                desc="If a driver cancels after accepting, automatically assign the next available driver without customer intervention"
                value={get("auto_assign_on_cancel") || "true"} onChange={set("auto_assign_on_cancel")} />

              <Toggle label="Sequential Dispatch Mode" id="sequential_dispatch"
                desc="Send request to one driver at a time in order of proximity. If rejected/timeout, moves to next driver automatically."
                value={get("sequential_dispatch") || "false"} onChange={set("sequential_dispatch")} />

              <Toggle label="Driver Group Broadcast" id="group_broadcast"
                desc="Broadcast ride to a group of nearby drivers simultaneously (like Rapido/Ola). All see it, first to tap gets it."
                value={get("group_broadcast") || "true"} onChange={set("group_broadcast")} />

              <div style={{ fontWeight: 700, fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8, marginTop: 20 }}>Parcel & Helper</div>

              <Toggle label="Helper Booking Enabled" id="helper_booking_enabled"
                desc="Allow customers to request a loading/unloading helper along with vehicle booking"
                value={get("helper_booking_enabled") || "true"} onChange={set("helper_booking_enabled")} />

              <Field label="Helper Charge per Trip (₹)" id="helper_charge_per_trip"
                desc="Fixed charge added when customer requests a helper for loading/unloading"
                value={get("helper_charge_per_trip") || "100"} onChange={set("helper_charge_per_trip")}
                type="number" placeholder="100" suffix="₹" />

              <div style={{ fontWeight: 700, fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8, marginTop: 20 }}>Intercity Dispatch</div>

              <Field label="Intercity Acceptance Timeout (seconds)" id="intercity_acceptance_timeout_sec"
                desc="Longer timeout for intercity bookings (customers plan ahead)"
                value={get("intercity_acceptance_timeout_sec") || "120"} onChange={set("intercity_acceptance_timeout_sec")}
                type="number" placeholder="120" suffix="sec" />

              <Toggle label="Intercity Driver Verification Required" id="intercity_driver_verification"
                desc="Only allow approved/verified drivers to accept intercity trips"
                value={get("intercity_driver_verification") || "true"} onChange={set("intercity_driver_verification")} />
            </div>
          )}

          {/* ===== SOUND ALERTS ===== */}
          {tab === "sound" && (
            <div>
              <div className="mb-4 p-3 rounded-3" style={{ background: "linear-gradient(135deg,#f5f3ff,#faf5ff)", border: "1.5px solid #ddd6fe" }}>
                <div className="d-flex align-items-center gap-2 mb-1">
                  <i className="bi bi-volume-up-fill text-purple" style={{ fontSize: 18, color: "#7c3aed" }}></i>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#7c3aed" }}>Sound Alert Configuration</span>
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Configure alert sounds for driver app, customer app and admin dashboard. These settings sync to Flutter mobile apps.</div>
              </div>

              <div style={{ fontWeight: 700, fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>Driver App Alerts</div>

              <Toggle label="New Ride Request Sound" id="sound_new_ride"
                desc="Play alert sound when a new ride request is dispatched to driver"
                value={get("sound_new_ride") || "true"} onChange={set("sound_new_ride")} />

              <Toggle label="New Parcel Request Sound" id="sound_new_parcel"
                desc="Play distinct alert sound for new parcel delivery requests"
                value={get("sound_new_parcel") || "true"} onChange={set("sound_new_parcel")} />

              <Toggle label="Intercity Request Sound" id="sound_intercity"
                desc="Play premium alert sound for intercity/outstation booking requests"
                value={get("sound_intercity") || "true"} onChange={set("sound_intercity")} />

              <Toggle label="Trip Completed Sound" id="sound_trip_complete"
                desc="Play confirmation sound when trip is completed and fare is settled"
                value={get("sound_trip_complete") || "true"} onChange={set("sound_trip_complete")} />

              <div style={{ fontWeight: 700, fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8, marginTop: 20 }}>Customer App Alerts</div>

              <Toggle label="Driver Accepted Sound" id="sound_driver_accepted"
                desc="Notify customer with sound when driver accepts their booking"
                value={get("sound_driver_accepted") || "true"} onChange={set("sound_driver_accepted")} />

              <Toggle label="Driver Arriving Sound" id="sound_driver_arriving"
                desc="Play alert when driver is 2 minutes away from pickup"
                value={get("sound_driver_arriving") || "true"} onChange={set("sound_driver_arriving")} />

              <Toggle label="Trip Started Sound" id="sound_trip_started"
                desc="Play sound when driver starts the trip meter"
                value={get("sound_trip_started") || "false"} onChange={set("sound_trip_started")} />

              <div style={{ fontWeight: 700, fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8, marginTop: 20 }}>Safety Alerts</div>

              <Toggle label="SOS Alert Sound" id="sound_sos"
                desc="HIGH PRIORITY — always play loud alert for SOS emergency triggers. Cannot be muted by driver."
                value={get("sound_sos") || "true"} onChange={set("sound_sos")} />

              <Toggle label="Accident Detection Alert" id="sound_accident"
                desc="Play alert if sudden motion/impact detected (requires phone accelerometer)"
                value={get("sound_accident") || "true"} onChange={set("sound_accident")} />

              <div style={{ fontWeight: 700, fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8, marginTop: 20 }}>Sound Configuration</div>

              <div style={{ padding: "14px 0", borderBottom: "1px solid #f1f5f9" }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0f172a", marginBottom: 8 }}>Alert Sound Type</div>
                <div className="d-flex gap-2 flex-wrap">
                  {[
                    { val: "bell", label: "🔔 Bell", desc: "Classic bell" },
                    { val: "chime", label: "🎵 Chime", desc: "Soft chime" },
                    { val: "notification", label: "📳 Notification", desc: "Phone ping" },
                    { val: "horn", label: "📯 Horn", desc: "Loud horn" },
                  ].map(s => (
                    <div key={s.val}
                      onClick={() => set("sound_type")(s.val)}
                      style={{
                        padding: "10px 16px", borderRadius: 10, cursor: "pointer",
                        border: `2px solid ${get("sound_type") === s.val || (!get("sound_type") && s.val === "bell") ? "#7c3aed" : "#e2e8f0"}`,
                        background: get("sound_type") === s.val || (!get("sound_type") && s.val === "bell") ? "#f5f3ff" : "#fff",
                        textAlign: "center",
                      }}>
                      <div style={{ fontSize: 18 }}>{s.label.split(' ')[0]}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>{s.label.split(' ')[1]}</div>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>{s.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              <Field label="Alert Sound Repeat Count" id="sound_repeat_count"
                desc="Number of times to repeat the alert sound for incoming ride/parcel requests"
                value={get("sound_repeat_count") || "3"} onChange={set("sound_repeat_count")}
                type="number" placeholder="3" suffix="times" />

              <Toggle label="Vibration with Sound" id="sound_vibration"
                desc="Vibrate device alongside alert sound for better driver attention"
                value={get("sound_vibration") || "true"} onChange={set("sound_vibration")} />
            </div>
          )}

        </div>
      </div>

      {/* Bottom save bar */}
      {hasChanges && (
        <div className="ops-savebar">
          <div className="ops-savebar__summary">
            <strong>{Object.keys(local).length} staged change{Object.keys(local).length === 1 ? "" : "s"} ready for review</strong>
            <span>
              Scope: {changedAreas.join(", ")}
              {runtimeWarnings.length ? ` • ${runtimeWarnings.length} warning${runtimeWarnings.length === 1 ? "" : "s"}` : " • No active warnings"}
            </span>
          </div>
          <button className="btn btn-sm" style={{ background: "#475569", color: "#fff", borderRadius: 8, fontSize: 12, border: "none" }}
            onClick={openDiscardReview}>Discard</button>
          <button className="btn btn-sm btn-primary" style={{ borderRadius: 8, fontSize: 12 }}
            onClick={openPublishReview} disabled={save.isPending}
            data-testid="btn-save-float">
            {save.isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      )}
      <ReviewModal
        state={reviewState}
        changes={changedSettings}
        warnings={runtimeWarnings}
        onClose={() => setReviewState(null)}
        onConfirm={handleReviewConfirm}
        pending={save.isPending}
      />
    </div>
  );
}
