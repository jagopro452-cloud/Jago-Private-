import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { adminFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Setting = { keyName: string; value: string; settingsType: string };
type OtpSettings = {
  primaryProvider: string;
  smsEnabled: boolean;
  firebaseEnabled: boolean;
  fallbackEnabled: boolean;
  otpExpirySeconds: number;
  maxAttempts: number;
};

function PasswordChangePanel() {
  const { toast } = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      toast({ title: "New passwords do not match", variant: "destructive" });
      return;
    }
    if (form.newPassword.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      await apiRequest("POST", "/api/admin/change-password", {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
        confirmPassword: form.confirmPassword,
      });
      toast({ title: "Password changed successfully" });
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (error: any) {
      toast({ title: error?.message || "Failed to change password", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleChangePassword}>
      <div className="row g-3">
        <div className="col-12 col-md-6">
          <label className="form-label fw-semibold fs-14">Current Password</label>
          <input
            type="password"
            className="form-control"
            value={form.currentPassword}
            onChange={e => setForm(prev => ({ ...prev, currentPassword: e.target.value }))}
            placeholder="Enter current password"
            required
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label fw-semibold fs-14">New Password</label>
          <input
            type="password"
            className="form-control"
            value={form.newPassword}
            onChange={e => setForm(prev => ({ ...prev, newPassword: e.target.value }))}
            placeholder="Enter new password (min 8 chars)"
            required
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label fw-semibold fs-14">Confirm Password</label>
          <input
            type="password"
            className="form-control"
            value={form.confirmPassword}
            onChange={e => setForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
            placeholder="Confirm new password"
            required
          />
        </div>
        <div className="col-12 mt-3">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            data-testid="btn-change-password"
          >
            {loading ? (
              <><span className="spinner-border spinner-border-sm me-2"></span>Changing...</>
            ) : (
              <><i className="bi bi-check-circle-fill me-2"></i>Change Password</>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}

const settingGroups = [
  {
    title: "Change Password",
    icon: "bi-key-fill",
    type: "password",
    fields: [],
  },
  {
    title: "Business Information",
    icon: "bi-building-fill",
    type: "business",
    fields: [
      { key: "business_name", label: "Business Name" },
      { key: "business_email", label: "Business Email" },
      { key: "business_phone", label: "Business Phone" },
      { key: "business_address", label: "Business Address" },
    ],
  },
  {
    title: "Currency & Region",
    icon: "bi-currency-rupee",
    type: "currency",
    fields: [
      { key: "currency_code", label: "Currency Code" },
      { key: "currency_symbol", label: "Currency Symbol" },
      { key: "country_code", label: "Country Code" },
    ],
  },
  {
    title: "Trip Settings",
    icon: "bi-car-front-fill",
    type: "trip",
    fields: [
      { key: "max_search_radius", label: "Max Search Radius (km)" },
      { key: "driver_cancel_limit", label: "Driver Cancel Limit" },
      { key: "customer_cancel_limit", label: "Customer Cancel Limit" },
    ],
  },
  {
    title: "Payment Gateway",
    icon: "bi-credit-card-2-front-fill",
    type: "payment",
    fields: [
      { key: "razorpay_key_id", label: "Razorpay Key ID" },
      { key: "razorpay_key_secret", label: "Razorpay Key Secret" },
      { key: "payment_gateway_mode", label: "Mode (test / live)" },
      { key: "fast2sms_api_key", label: "Fast2SMS API Key (OTP Fallback)" },
      { key: "smslogin_api_url", label: "SMSLogin API URL" },
      { key: "smslogin_api_key", label: "SMSLogin API Key" },
      { key: "smslogin_sender_id", label: "SMSLogin Sender ID" },
      { key: "smslogin_route", label: "SMSLogin Route (Optional)" },
      { key: "smslogin_template_id", label: "SMSLogin Template ID (Optional)" },
      { key: "smslogin_entity_id", label: "SMSLogin Entity ID (Optional)" },
    ],
  },
  {
    title: "App Configuration",
    icon: "bi-phone-fill",
    type: "app",
    fields: [
      { key: "customer_app_version", label: "Customer App Version" },
      { key: "driver_app_version", label: "Driver App Version" },
      { key: "force_update", label: "Force Update (true / false)" },
      { key: "maintenance_mode", label: "Maintenance Mode (true / false)" },
    ],
  },
  {
    title: "Referral & Wallet",
    icon: "bi-wallet2",
    type: "referral",
    fields: [
      { key: "referral_bonus_driver", label: "Driver Referral Bonus (₹)" },
      { key: "referral_bonus_customer", label: "Customer Referral Bonus (₹)" },
      { key: "min_wallet_withdrawal", label: "Min Withdrawal Amount (₹)" },
      { key: "max_wallet_recharge", label: "Max Recharge Amount (₹)" },
    ],
  },
  {
    title: "OTP Configuration",
    icon: "bi-shield-lock-fill",
    type: "otp",
    fields: [],
  },
];

function OtpSettingsPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<OtpSettings>({
    queryKey: ["/api/otp-settings"],
    queryFn: () => adminFetch("/api/otp-settings").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })),
  });

  const [form, setForm] = useState<OtpSettings>({
    primaryProvider: "sms",
    smsEnabled: true,
    firebaseEnabled: true,
    fallbackEnabled: true,
    otpExpirySeconds: 120,
    maxAttempts: 3,
  });

  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: (d: OtpSettings) => apiRequest("PUT", "/api/otp-settings", d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/otp-settings"] });
      toast({ title: "OTP settings saved" });
    },
    onError: (e: any) => toast({ title: "Error saving OTP settings", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="d-flex justify-content-center py-4"><div className="spinner-border text-primary" role="status"></div></div>;

  const Toggle = ({ label, desc, field }: { label: string; desc: string; field: keyof OtpSettings }) => (
    <div className="d-flex align-items-center justify-content-between p-3 rounded border mb-2" style={{ background: "var(--bs-body-bg)" }}>
      <div>
        <div className="fw-semibold fs-14">{label}</div>
        <div className="text-muted" style={{ fontSize: 12 }}>{desc}</div>
      </div>
      <div className="form-check form-switch mb-0">
        <input
          className="form-check-input"
          type="checkbox"
          role="switch"
          style={{ width: 44, height: 22, cursor: "pointer" }}
          checked={!!form[field]}
          onChange={e => setForm(prev => ({ ...prev, [field]: e.target.checked }))}
          data-testid={`otp-toggle-${String(field)}`}
        />
      </div>
    </div>
  );

  return (
    <div>
      {/* Provider Selection */}
      <div className="mb-4">
        <label className="form-label fw-semibold fs-14">Primary OTP Provider</label>
        <div className="row g-3">
          {[
            { val: "sms", icon: "bi-chat-dots-fill", label: "SMS OTP", desc: "Send OTP via SMSLogin, Twilio or Fast2SMS" },
            { val: "firebase", icon: "bi-phone-vibrate-fill", label: "Firebase OTP", desc: "Use Firebase Phone Authentication" },
          ].map(opt => (
            <div key={opt.val} className="col-md-6">
              <div
                className={`p-3 rounded border-2 border d-flex align-items-center gap-3 cursor-pointer ${form.primaryProvider === opt.val ? "border-primary bg-primary bg-opacity-10" : "border-secondary"}`}
                style={{ cursor: "pointer" }}
                onClick={() => setForm(prev => ({ ...prev, primaryProvider: opt.val }))}
                data-testid={`otp-provider-${opt.val}`}
              >
                <i className={`bi ${opt.icon} fs-4 ${form.primaryProvider === opt.val ? "text-primary" : "text-muted"}`}></i>
                <div>
                  <div className={`fw-bold fs-14 ${form.primaryProvider === opt.val ? "text-primary" : ""}`}>{opt.label}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>{opt.desc}</div>
                </div>
                {form.primaryProvider === opt.val && <i className="bi bi-check-circle-fill text-primary ms-auto"></i>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Enable/Disable toggles */}
      <div className="mb-4">
        <label className="form-label fw-semibold fs-14">Provider Controls</label>
        <Toggle label="SMS OTP Enabled" desc="Allow OTP delivery via SMS providers (SMSLogin / Twilio / Fast2SMS)" field="smsEnabled" />
        <Toggle label="Firebase OTP Enabled" desc="Allow Firebase Phone Authentication as OTP method" field="firebaseEnabled" />
        <Toggle label="Auto-Fallback Enabled" desc="If primary provider fails, automatically switch to the other provider" field="fallbackEnabled" />
      </div>

      {/* Security Settings */}
      <div className="mb-4">
        <label className="form-label fw-semibold fs-14">Security Rules</label>
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label fs-13 text-muted">OTP Expiry (seconds)</label>
            <input
              type="number"
              className="form-control"
              min={60} max={600}
              value={form.otpExpirySeconds}
              onChange={e => setForm(prev => ({ ...prev, otpExpirySeconds: parseInt(e.target.value) || 120 }))}
              data-testid="otp-expiry-seconds"
            />
            <div className="form-text">Minimum 60s, maximum 600s. Default: 120s (2 minutes)</div>
          </div>
          <div className="col-md-6">
            <label className="form-label fs-13 text-muted">Max Attempts per OTP</label>
            <input
              type="number"
              className="form-control"
              min={1} max={10}
              value={form.maxAttempts}
              onChange={e => setForm(prev => ({ ...prev, maxAttempts: parseInt(e.target.value) || 3 }))}
              data-testid="otp-max-attempts"
            />
            <div className="form-text">Block phone after this many wrong attempts. Default: 3</div>
          </div>
        </div>
      </div>

      {/* Status summary */}
      <div className="alert alert-info d-flex align-items-start gap-2 mb-4" role="alert">
        <i className="bi bi-info-circle-fill mt-1"></i>
        <div className="fs-13">
          <strong>Current Flow: </strong>
          {form.primaryProvider === "sms" ? (
            <>SMS OTP is primary. {form.fallbackEnabled && form.firebaseEnabled ? "If SMS fails, app will automatically switch to Firebase Phone Auth." : "No fallback configured."}</>
          ) : (
            <>Firebase Phone Auth is primary. {form.fallbackEnabled && form.smsEnabled ? "If Firebase fails, SMS OTP will be used." : "No fallback configured."}</>
          )}
          {" "}OTP expires in <strong>{form.otpExpirySeconds}s</strong>. Max <strong>{form.maxAttempts}</strong> wrong attempts allowed.
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={() => save.mutate(form)}
        disabled={save.isPending}
        data-testid="btn-save-otp-settings"
      >
        {save.isPending ? (
          <><span className="spinner-border spinner-border-sm me-2"></span>Saving...</>
        ) : (
          <><i className="bi bi-floppy-fill me-2"></i>Save OTP Settings</>
        )}
      </button>
    </div>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [activeGroup, setActiveGroup] = useState("business");

  const { data: settings, isLoading } = useQuery<Setting[]>({
    queryKey: ["/api/settings"],
    queryFn: () => adminFetch("/api/settings").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
  });

  useEffect(() => {
    if (settings) {
      const obj: Record<string, string> = {};
      settings.forEach(s => { obj[s.keyName] = s.value; });
      setFormData(obj);
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: (data: Record<string, string>) => apiRequest("POST", "/api/settings", { settings: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved successfully" });
    },
    onError: (e: any) => toast({ title: "Error saving settings", description: e.message, variant: "destructive" }),
  });

  const activeGroupData = settingGroups.find(g => g.type === activeGroup);

  return (
    <div className="container-fluid">
      <h2 className="fs-22 mb-4 text-capitalize" data-testid="page-title">System Settings</h2>

      <div className="row g-4">
        <div className="col-lg-3">
          <div className="card">
            <div className="card-body p-2">
              <ul className="nav flex-column">
                {settingGroups.map(g => (
                  <li key={g.type} className="nav-item">
                    <button
                      className={`nav-link w-100 text-start d-flex align-items-center gap-2 ${activeGroup === g.type ? "active bg-primary text-white rounded" : "text-muted"}`}
                      style={{ border: "none", background: "none", padding: "0.625rem 0.75rem" }}
                      onClick={() => setActiveGroup(g.type)}
                      data-testid={`settings-tab-${g.type}`}
                    >
                      <i className={`bi ${g.icon}`}></i>
                      <span>{g.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="col-lg-9">
          {activeGroupData && (
            <div className="card">
              <div className="card-header d-flex align-items-center gap-2">
                <i className={`bi ${activeGroupData.icon} text-primary`}></i>
                <h6 className="mb-0">{activeGroupData.title}</h6>
              </div>
              <div className="card-body">
                {activeGroup === "password" ? (
                  <PasswordChangePanel />
                ) : activeGroup === "otp" ? (
                  <OtpSettingsPanel />
                ) : isLoading ? (
                  <div className="d-flex justify-content-center py-4">
                    <div className="spinner-border text-primary" role="status"></div>
                  </div>
                ) : (
                  <div className="row g-3">
                    {activeGroupData.fields.map(field => (
                      <div key={field.key} className="col-md-6">
                        <label className="form-label fw-semibold fs-14">{field.label}</label>
                        <input
                          type="text"
                          className="form-control"
                          value={formData[field.key] || ""}
                          onChange={e => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                          data-testid={`setting-${field.key}`}
                        />
                      </div>
                    ))}
                    <div className="col-12 mt-3">
                      <button
                        className="btn btn-primary"
                        onClick={() => save.mutate(formData)}
                        disabled={save.isPending}
                        data-testid="btn-save-settings"
                      >
                        {save.isPending ? (
                          <><span className="spinner-border spinner-border-sm me-2"></span>Saving...</>
                        ) : (
                          <><i className="bi bi-floppy-fill me-2"></i>Save Changes</>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
