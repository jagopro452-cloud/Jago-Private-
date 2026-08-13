import { useState } from "react";
import { useLocation } from "wouter";

export default function FranchiseLogin() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/franchise/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Invalid credentials"); return; }
      localStorage.setItem("franchise_token", data.token);
      localStorage.setItem("franchise_info", JSON.stringify(data.franchisee));
      setLocation("/franchise/dashboard");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#0F172A 0%,#1E3A8A 60%,#0891B2 100%)", fontFamily: "'Segoe UI',sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "40px 36px", width: "100%", maxWidth: 420, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg,#2F7BFF,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontSize: 26 }}>
            🏢
          </div>
          <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22, color: "#0F172A" }}>Franchise Portal</h2>
          <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: 14 }}>Login to manage your zone</p>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: "#334155", marginBottom: 6 }}>Email Address</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="franchise@example.com"
              style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: 13, color: "#334155", marginBottom: 6 }}>Password</label>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{ width: "100%", padding: "11px 40px 11px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14, outline: "none", boxSizing: "border-box" }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 16, color: "#94A3B8", lineHeight: 1 }}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {error && (
            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 14px", color: "#DC2626", fontSize: 13, fontWeight: 600, marginBottom: 18 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{ width: "100%", padding: "13px 0", borderRadius: 12, background: loading ? "#93C5FD" : "linear-gradient(135deg,#2F7BFF,#0891B2)", color: "#fff", fontWeight: 800, fontSize: 15, border: "none", cursor: loading ? "wait" : "pointer" }}
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 24, fontSize: 12, color: "#94A3B8" }}>
          Contact your admin if you don't have access.
        </p>
      </div>
    </div>
  );
}
