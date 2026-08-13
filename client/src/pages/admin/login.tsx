import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { clearAdminSession, saveAdminSession, verifyAdminSession } from "@/lib/queryClient";

function useAdminBootstrap() {
  useEffect(() => {
    const cssFiles = [
      { id: "admin-bootstrap-icons-css", href: "/admin-module/css/bootstrap-icons.min.css" },
      { id: "admin-bootstrap-css", href: "/admin-module/css/bootstrap.min.css" },
    ];
    const added: HTMLLinkElement[] = [];
    cssFiles.forEach(({ id, href }) => {
      let link = document.getElementById(id) as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.id = id;
        document.head.appendChild(link);
        added.push(link);
      }
    });
    return () => {
      added.forEach(el => el.remove());
      cssFiles.forEach(({ id }) => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
    };
  }, []);
}

const FEATURES = [
  { icon: "bi-geo-alt-fill", label: "Real-time GPS fleet tracking" },
  { icon: "bi-shield-fill-check", label: "Secure pilot verification & KYC" },
  { icon: "bi-graph-up-arrow", label: "Live revenue & analytics dashboard" },
  { icon: "bi-bell-fill", label: "Smart alerts & surge pricing" },
];

export default function AdminLogin() {
  useAdminBootstrap();
  const [, setLocation] = useLocation();
  const getAdminDeviceId = () => {
    try {
      const key = "jago-admin-device-id";
      const existing = localStorage.getItem(key);
      if (existing) return existing;
      const created = `admin-web-${crypto.randomUUID()}`;
      localStorage.setItem(key, created);
      return created;
    } catch {
      return "admin-web-fallback";
    }
  };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState(() =>
    new URLSearchParams(window.location.search).get("reason") === "timeout"
      ? "Session expired due to 20 minutes of inactivity. Please login again."
      : ""
  );
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<{drivers: number; trips: number; zones: number} | null>(null);
  // Forgot password state
  const [forgotMode, setForgotMode] = useState<"login"|"forgot"|"reset">("login");
  const [loginMode, setLoginMode] = useState<"password"|"otp">("password");
  const [loginOtp, setLoginOtp] = useState("");
  const [twoFaHint, setTwoFaHint] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotOtp, setForgotOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotError, setForgotError] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  useEffect(() => {
    fetch("/api/health").then(r => r.json()).then(d => {
      if (d.status === "ok") setStats({ drivers: 0, trips: 0, zones: 0 });
    }).catch(() => {});
  }, []);
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("jago-admin");
    if (!saved) return;
    verifyAdminSession()
      .then(() => window.location.replace("/admin/dashboard"))
      .catch(() => clearAdminSession("stale-login-session"));
  }, [setLocation]);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(""); setForgotMsg(""); setForgotLoading(true);
    try {
      const res = await fetch("/api/admin/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await res.json();
      if (res.ok) {
        setForgotMsg(data.message);
        if (data.otp) setForgotMsg(`${data.message} OTP: ${data.otp}`);
        setForgotMode("reset");
      } else {
        setForgotError(data.message || "Failed to send OTP");
      }
    } catch { setForgotError("Connection error. Please try again."); }
    finally { setForgotLoading(false); }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(""); setForgotMsg(""); setForgotLoading(true);
    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail, otp: forgotOtp, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setForgotMsg(data.message);
        setTimeout(() => { setForgotMode("login"); setPassword(""); }, 2000);
      } else {
        setForgotError(data.message || "Failed to reset password");
      }
    } catch { setForgotError("Connection error. Please try again."); }
    finally { setForgotLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Device-Id": getAdminDeviceId() },
        body: JSON.stringify({ email, password, deviceId: getAdminDeviceId() }),
      });
      const data = await res.json();
      if (res.ok && data?.token) {
        saveAdminSession({ ...(data.admin || data), token: data.token, refreshToken: data.refreshToken || null, expiresAt: data.expiresAt });
        window.location.replace("/admin/dashboard");
      } else {
        // 2FA disabled - just show error message
        setError(data.message || "Invalid credentials. Please try again.");
      }
    } catch {
      setError("Connection error. Please check your network and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Device-Id": getAdminDeviceId() },
        body: JSON.stringify({ email, otp: loginOtp, deviceId: getAdminDeviceId() }),
      });
      const data = await res.json();
      if (res.ok && data?.token) {
        saveAdminSession({ ...(data.admin || data), token: data.token, refreshToken: data.refreshToken || null, expiresAt: data.expiresAt });
        window.location.replace("/admin/dashboard");
      } else {
        setError(data.message || "Invalid OTP. Please try again.");
      }
    } catch {
      setError("Connection error. Please check your network and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="jl-root" data-testid="login-page">

      {/* ── LEFT — Brand Panel ── */}
      <div className="jl-brand">
        {/* Animated orbs */}
        <div className="jl-orb jl-orb-1"></div>
        <div className="jl-orb jl-orb-2"></div>
        <div className="jl-orb jl-orb-3"></div>

        <div className="jl-brand-inner">
          {/* Logo */}
          <div className="jl-logo-img-card" style={{ background: "#ffffff", borderRadius: 16, padding: "12px 24px", display: "inline-flex", alignItems: "center", justifyContent: "center", height: 64, boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}>
            <img src="/jago-logo-new.png" alt="JAGO" className="jl-logo-img" style={{ height: 52, width: "auto", objectFit: "contain", display: "block" }} />
          </div>

          {/* Headline */}
          <h2 className="jl-headline">
            Power your city's<br />
            <span className="jl-headline-accent">mobility network</span>
          </h2>
          <p className="jl-sub">Complete ride & parcel management platform for operators across India.</p>

          {/* Live stat chips */}
          <div className="jl-stats">
            {[
              { icon: "🏍️", value: stats ? String(stats.drivers) : "—", label: "Active Drivers" },
              { icon: "🚗", value: stats ? String(stats.trips) : "—", label: "Total Trips" },
              { icon: "🌆", value: stats ? String(stats.zones) : "—", label: "Zones" },
            ].map((s, i) => (
              <div key={i} className={`jl-stat ${mounted ? "jl-stat-in" : ""}`} style={{ animationDelay: `${i * 0.12}s` }}>
                <span className="jl-stat-icon">{s.icon}</span>
                <div>
                  <div className="jl-stat-val">{s.value}</div>
                  <div className="jl-stat-lbl">{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Feature list */}
          <div className="jl-features">
            {FEATURES.map((f, i) => (
              <div key={i} className="jl-feat">
                <div className="jl-feat-icon"><i className={`bi ${f.icon}`}></i></div>
                <span>{f.label}</span>
              </div>
            ))}
          </div>

          {/* Floating live badge */}
          <div className="jl-live-badge">
            <span className="jl-live-dot"></span>
            Live platform — updated in real time
          </div>
        </div>
      </div>

      {/* ── RIGHT — Form Panel ── */}
      <div className="jl-form-panel">
        <div className="jl-form-card" data-testid="login-form-card">

          {/* Top mark */}
          <div className="jl-form-logo-row">
            <div className="jl-form-logo-circle">
              <i className="bi bi-shield-lock-fill"></i>
            </div>
            <div>
              <div className="jl-form-logo-title">JAGO Admin</div>
              <div className="jl-form-logo-sub">Secure access portal</div>
            </div>
          </div>

          <h1 className="jl-form-title">
            {forgotMode === "forgot" ? "Reset Password" : forgotMode === "reset" ? "Set New Password" : "Welcome back"}
          </h1>
          <p className="jl-form-subtitle">
            {forgotMode === "forgot" ? "Enter your email to receive a reset OTP" : forgotMode === "reset" ? "Enter the OTP and your new password" : "Sign in to manage your platform"}
          </p>

          {error && forgotMode === "login" && (
            <div className="jl-alert" data-testid="login-error">
              <i className="bi bi-exclamation-triangle-fill"></i> {error}
            </div>
          )}
          {forgotError && (
            <div className="jl-alert" data-testid="forgot-error">
              <i className="bi bi-exclamation-triangle-fill"></i> {forgotError}
            </div>
          )}
          {forgotMsg && (
            <div className="jl-alert" style={{ background: "rgba(16,185,129,0.12)", color: "#10b981", border: "1px solid rgba(16,185,129,0.25)" }} data-testid="forgot-success">
              <i className="bi bi-check-circle-fill"></i> {forgotMsg}
            </div>
          )}

          {forgotMode === "forgot" && (
            <form onSubmit={handleForgotPassword}>
              <div className="jl-field">
                <label className="jl-label">Admin Email Address</label>
                <div className="jl-input-wrap">
                  <span className="jl-input-icon"><i className="bi bi-envelope"></i></span>
                  <input type="email" className="jl-input" placeholder="admin@company.com" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required data-testid="input-forgot-email" />
                </div>
              </div>
              <button className={`jl-btn${forgotLoading ? " jl-btn-loading" : ""}`} type="submit" disabled={forgotLoading} data-testid="btn-send-otp">
                {forgotLoading ? <><span className="jl-spinner"></span>Sending…</> : <><i className="bi bi-send me-2"></i>Send Reset OTP</>}
              </button>
              <div style={{ textAlign: "center", marginTop: 16 }}>
                <button type="button" className="jl-forgot-link" onClick={() => setForgotMode("login")}>Back to login</button>
              </div>
            </form>
          )}

          {forgotMode === "reset" && (
            <form onSubmit={handleResetPassword}>
              <div className="jl-field">
                <label className="jl-label">OTP (sent to email)</label>
                <div className="jl-input-wrap">
                  <span className="jl-input-icon"><i className="bi bi-shield-check"></i></span>
                  <input type="text" className="jl-input" placeholder="6-digit OTP" value={forgotOtp} onChange={e => setForgotOtp(e.target.value)} maxLength={6} required data-testid="input-otp" />
                </div>
              </div>
              <div className="jl-field">
                <label className="jl-label">New Password</label>
                <div className="jl-input-wrap">
                  <span className="jl-input-icon"><i className="bi bi-lock"></i></span>
                  <input type="password" className="jl-input" placeholder="Min 6 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={6} required data-testid="input-new-password" />
                </div>
              </div>
              <button className={`jl-btn${forgotLoading ? " jl-btn-loading" : ""}`} type="submit" disabled={forgotLoading} data-testid="btn-reset-password">
                {forgotLoading ? <><span className="jl-spinner"></span>Resetting…</> : <><i className="bi bi-check-circle me-2"></i>Reset Password</>}
              </button>
              <div style={{ textAlign: "center", marginTop: 16 }}>
                <button type="button" className="jl-forgot-link" onClick={() => setForgotMode("forgot")}>Resend OTP</button>
              </div>
            </form>
          )}

          {forgotMode === "login" && loginMode === "password" && <form onSubmit={handleSubmit}>
            <div className="jl-field">
              <label className="jl-label">Email Address</label>
              <div className="jl-input-wrap">
                <span className="jl-input-icon"><i className="bi bi-envelope"></i></span>
                <input
                  type="email"
                  className="jl-input"
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  data-testid="input-email"
                />
              </div>
            </div>

            <div className="jl-field">
              <label className="jl-label">Password</label>
              <div className="jl-input-wrap">
                <span className="jl-input-icon"><i className="bi bi-lock"></i></span>
                <input
                  type={showPassword ? "text" : "password"}
                  className="jl-input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  data-testid="input-password"
                />
                <button
                  type="button"
                  className="jl-eye-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="btn-toggle-password"
                >
                  <i className={`bi ${showPassword ? "bi-eye-fill" : "bi-eye-slash-fill"}`}></i>
                </button>
              </div>
            </div>

            <div className="jl-row">
              <label className="jl-check-label">
                <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} data-testid="input-remember" />
                <span>Remember me</span>
              </label>
              <button type="button" className="jl-forgot-link" onClick={() => { setForgotMode("forgot"); setForgotEmail(email); setForgotError(""); setForgotMsg(""); }} data-testid="btn-forgot-password">
                Forgot password?
              </button>
            </div>

            <button className={`jl-btn${loading ? " jl-btn-loading" : ""}`} type="submit" disabled={loading} data-testid="btn-login">
              {loading
                ? <><span className="jl-spinner"></span>Signing in…</>
                : <><i className="bi bi-box-arrow-in-right me-2"></i>Sign In to Dashboard</>
              }
            </button>
          </form>}

          {forgotMode === "login" && loginMode === "otp" && <form onSubmit={handleVerify2FA}>
            <div className="jl-field">
              <label className="jl-label">Two-Factor OTP</label>
              <div className="jl-input-wrap">
                <span className="jl-input-icon"><i className="bi bi-shield-lock"></i></span>
                <input
                  type="text"
                  className="jl-input"
                  placeholder="Enter 6-digit OTP"
                  value={loginOtp}
                  onChange={e => setLoginOtp(e.target.value)}
                  maxLength={6}
                  required
                  data-testid="input-login-otp"
                />
              </div>
              {twoFaHint && <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>{twoFaHint}</div>}
            </div>

            <button className={`jl-btn${loading ? " jl-btn-loading" : ""}`} type="submit" disabled={loading} data-testid="btn-verify-2fa">
              {loading
                ? <><span className="jl-spinner"></span>Verifying…</>
                : <><i className="bi bi-shield-check me-2"></i>Verify & Continue</>
              }
            </button>

            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button type="button" className="jl-forgot-link" onClick={() => { setLoginMode("password"); setLoginOtp(""); setTwoFaHint(""); }}>
                Back to password login
              </button>
            </div>
          </form>}

        </div>

        <div className="jl-footer">© {new Date().getFullYear()} MindWhile IT Solutions Pvt Ltd · JAGO is a product of MindWhile IT Solutions Pvt Ltd</div>
      </div>
    </div>
  );
}
