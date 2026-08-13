import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/queryClient";

// ─────────────────────────────────────────────────────────────────────────────
// Admin → Voice Commands
// Monitor voice booking activity, configure AI, test intent parser
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY = "#2F7BFF";
const CARD_BG = "#fff";
const BORDER = "#E8EEF8";

export default function VoiceCommandsPage() {
  const qc = useQueryClient();
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<any>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [saved, setSaved] = useState(false);

  // ── Fetch recent voice logs ───────────────────────────────────────────────
  const { data: logs = [], isLoading: logsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/voice-logs"],
    queryFn: async () => {
      const r = await adminFetch("/api/admin/voice-logs?limit=50");
      if (!r.ok) throw new Error("Failed to load voice logs");
      const d = await r.json();
      return d.logs || [];
    },
    refetchInterval: 30000,
  });

  // ── Fetch AI config ───────────────────────────────────────────────────────
  useQuery({
    queryKey: ["/api/admin/business-settings/anthropic_api_key"],
    queryFn: async () => {
      const r = await adminFetch("/api/admin/business-settings/anthropic_api_key");
      if (r.ok) {
        const d = await r.json();
        if (d.value) setApiKey(d.value.slice(0, 8) + "•".repeat(20));
      }
      return null;
    },
  });

  // ── Save API key ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!apiKey || apiKey.includes("•")) return;
    const r = await adminFetch("/api/admin/business-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key_name: "anthropic_api_key", value: apiKey }),
    });
    if (r.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  };

  // ── Test voice parser ─────────────────────────────────────────────────────
  const handleTest = async () => {
    if (!testText.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const r = await adminFetch("/api/app/voice-booking/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: testText }),
      });
      const d = await r.json();
      setTestResult(d);
    } catch (_) {
      setTestResult({ error: "Network error" });
    }
    setTestLoading(false);
  };

  // ── Stats from logs ───────────────────────────────────────────────────────
  const totalRequests = logs.length;
  const rideCount = logs.filter((l: any) => l.intent === "book_ride").length;
  const parcelCount = logs.filter((l: any) => l.intent === "send_parcel").length;
  const intercityCount = logs.filter((l: any) => l.intent === "book_intercity").length;
  const successCount = logs.filter((l: any) => l.success).length;
  const successRate = totalRequests > 0 ? Math.round((successCount / totalRequests) * 100) : 0;

  // ── Supported commands reference ──────────────────────────────────────────
  const commandExamples = [
    { service: "Bike Ride", lang: "English", cmd: "Book a bike from JNTU to Hitech City", intent: "book_ride" },
    { service: "Auto Ride", lang: "Telugu", cmd: "Auto kavali Ameerpet ki", intent: "book_ride" },
    { service: "Car Ride", lang: "Hindi", cmd: "Car bulao airport ke liye", intent: "book_ride" },
    { service: "Carpool", lang: "English", cmd: "Need carpool seat to Gachibowli", intent: "book_ride" },
    { service: "Bike Parcel", lang: "Telugu", cmd: "Parcel pampali Miyapur ki", intent: "send_parcel" },
    { service: "Mini Truck", lang: "English", cmd: "Mini truck for furniture delivery", intent: "send_parcel" },
    { service: "Pickup Truck", lang: "Hindi", cmd: "Pickup truck chahiye bhari saman ke liye", intent: "send_parcel" },
    { service: "Intercity", lang: "English", cmd: "Outstation to Bangalore tomorrow morning", intent: "book_intercity" },
    { service: "Intercity", lang: "Telugu", cmd: "Hyderabad Bangalore carpool seat kavali", intent: "book_intercity" },
  ];

  const intentBadge = (intent: string) => {
    const colors: Record<string, string> = {
      book_ride: "#2F7BFF",
      send_parcel: "#FF6B35",
      book_intercity: "#10b981",
      unknown: "#94a3b8",
    };
    const labels: Record<string, string> = {
      book_ride: "Ride",
      send_parcel: "Parcel",
      book_intercity: "Intercity",
      unknown: "Unknown",
    };
    const c = colors[intent] || "#94a3b8";
    return (
      <span style={{
        padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
        background: c + "18", color: c, border: `1px solid ${c}40`,
      }}>
        {labels[intent] || intent}
      </span>
    );
  };

  return (
      <div style={{ padding: "24px 0", maxWidth: 1100 }}>
        {/* Header */}
        <div className="d-flex align-items-center gap-3 mb-4">
          <div style={{
            width: 48, height: 48, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg,#4FA9FF,#2F7BFF)", boxShadow: "0 4px 16px rgba(47,123,255,.3)",
          }}>
            <i className="bi bi-mic-fill" style={{ fontSize: 22, color: "#fff" }}></i>
          </div>
          <div>
            <h4 style={{ margin: 0, fontWeight: 800, color: "#1A2332" }}>Voice Booking AI</h4>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              Monitor voice commands · Configure Claude AI · Test intent parser
            </div>
          </div>
          <div className="ms-auto">
            <span style={{
              padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
              background: voiceEnabled ? "rgba(16,185,129,.12)" : "rgba(239,68,68,.12)",
              color: voiceEnabled ? "#059669" : "#dc2626",
              border: `1px solid ${voiceEnabled ? "#6ee7b7" : "#fca5a5"}`,
              cursor: "pointer",
            }} onClick={() => setVoiceEnabled(!voiceEnabled)}>
              {voiceEnabled ? "● Voice Enabled" : "● Voice Disabled"}
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div className="row g-3 mb-4">
          {[
            { label: "Total Requests", value: totalRequests, icon: "bi-mic", color: PRIMARY },
            { label: "Success Rate", value: `${successRate}%`, icon: "bi-check-circle", color: "#10b981" },
            { label: "Ride Intents", value: rideCount, icon: "bi-car-front", color: PRIMARY },
            { label: "Parcel Intents", value: parcelCount, icon: "bi-box-seam", color: "#FF6B35" },
            { label: "Intercity Intents", value: intercityCount, icon: "bi-signpost-split", color: "#10b981" },
          ].map((s) => (
            <div key={s.label} className="col-6 col-md">
              <div style={{
                background: CARD_BG, borderRadius: 16, padding: "16px",
                border: `1px solid ${BORDER}`, boxShadow: "0 2px 8px rgba(0,0,0,.06)",
                textAlign: "center",
              }}>
                <i className={`bi ${s.icon}`} style={{ fontSize: 22, color: s.color }}></i>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#1A2332", marginTop: 6 }}>{s.value}</div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="row g-4">
          {/* Left column */}
          <div className="col-12 col-lg-7">
            {/* AI Configuration */}
            <div style={{
              background: CARD_BG, borderRadius: 18, padding: 24,
              border: `1px solid ${BORDER}`, marginBottom: 20,
              boxShadow: "0 2px 12px rgba(0,0,0,.06)",
            }}>
              <div className="d-flex align-items-center gap-2 mb-3">
                <i className="bi bi-stars" style={{ fontSize: 18, color: "#7c3aed" }}></i>
                <span style={{ fontWeight: 800, fontSize: 15, color: "#1A2332" }}>Claude AI Configuration</span>
              </div>
              <div style={{
                padding: "10px 14px", borderRadius: 10, marginBottom: 16,
                background: "linear-gradient(135deg,#f5f3ff,#ede9fe)", border: "1px solid #c4b5fd",
                fontSize: 12, color: "#6d28d9",
              }}>
                <i className="bi bi-info-circle me-1"></i>
                Claude AI understands Telugu, Hindi, English, Tamil, Kannada and more.
                Detects intent: <strong>Ride · Parcel · Intercity</strong> — and routes to the correct booking screen.
                Cost: ~₹0.001 per voice request.
              </div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 4, display: "block" }}>
                Anthropic API Key
              </label>
              <div className="d-flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-api03-..."
                  style={{
                    flex: 1, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${BORDER}`,
                    fontSize: 14, fontFamily: "monospace",
                  }}
                />
                <button onClick={handleSave} style={{
                  padding: "10px 20px", borderRadius: 10, border: "none",
                  background: saved ? "#10b981" : PRIMARY, color: "#fff",
                  fontWeight: 700, fontSize: 13, cursor: "pointer",
                }}>
                  {saved ? "✓ Saved" : "Save"}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                Get from console.anthropic.com → API Keys → Create Key
              </div>
            </div>

            {/* Test Voice Parser */}
            <div style={{
              background: CARD_BG, borderRadius: 18, padding: 24,
              border: `1px solid ${BORDER}`, marginBottom: 20,
              boxShadow: "0 2px 12px rgba(0,0,0,.06)",
            }}>
              <div className="d-flex align-items-center gap-2 mb-3">
                <i className="bi bi-terminal" style={{ fontSize: 16, color: PRIMARY }}></i>
                <span style={{ fontWeight: 800, fontSize: 15, color: "#1A2332" }}>Test Intent Parser</span>
              </div>
              <div className="d-flex gap-2 mb-3">
                <input
                  type="text"
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleTest()}
                  placeholder='Try: "Bike JNTU to Hitech City" or "Parcel pampali"'
                  style={{
                    flex: 1, padding: "11px 14px", borderRadius: 10,
                    border: `1.5px solid ${BORDER}`, fontSize: 14,
                  }}
                />
                <button onClick={handleTest} disabled={testLoading} style={{
                  padding: "11px 20px", borderRadius: 10, border: "none",
                  background: PRIMARY, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
                }}>
                  {testLoading ? "..." : "Parse"}
                </button>
              </div>
              {testResult && (
                <div style={{
                  padding: 14, borderRadius: 12,
                  background: testResult.error ? "#fef2f2" : "#f0f9ff",
                  border: `1px solid ${testResult.error ? "#fecaca" : "#bae6fd"}`,
                }}>
                  {testResult.error ? (
                    <span style={{ color: "#dc2626", fontSize: 13 }}>{testResult.error}</span>
                  ) : (
                    <div className="row g-2">
                      <div className="col-6">
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Intent</div>
                        <div style={{ marginTop: 3 }}>{intentBadge(testResult.intent)}</div>
                      </div>
                      <div className="col-6">
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Confidence</div>
                        <div style={{ fontWeight: 800, color: PRIMARY, fontSize: 16, marginTop: 3 }}>
                          {Math.round((testResult.confidence || 0) * 100)}%
                        </div>
                      </div>
                      <div className="col-6">
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Pickup</div>
                        <div style={{ fontSize: 13, color: "#1A2332", fontWeight: 600, marginTop: 2 }}>
                          {testResult.pickup || "—"}
                        </div>
                      </div>
                      <div className="col-6">
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Destination</div>
                        <div style={{ fontSize: 13, color: "#1A2332", fontWeight: 600, marginTop: 2 }}>
                          {testResult.destination || "—"}
                        </div>
                      </div>
                      <div className="col-12">
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Vehicle</div>
                        <div style={{ fontSize: 13, color: "#1A2332", fontWeight: 600, marginTop: 2 }}>
                          {testResult.vehicleName || testResult.vehicleType || "Auto-selected"}
                        </div>
                      </div>
                      <div className="col-12">
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 3 }}>Parser</div>
                        <span style={{
                          fontSize: 10, padding: "2px 8px", borderRadius: 6,
                          background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", fontWeight: 700,
                        }}>
                          {testResult.parserSource || "claude-ai"}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Command reference */}
            <div style={{
              background: CARD_BG, borderRadius: 18, padding: 24,
              border: `1px solid ${BORDER}`,
              boxShadow: "0 2px 12px rgba(0,0,0,.06)",
            }}>
              <div className="d-flex align-items-center gap-2 mb-3">
                <i className="bi bi-journal-code" style={{ fontSize: 16, color: PRIMARY }}></i>
                <span style={{ fontWeight: 800, fontSize: 15, color: "#1A2332" }}>Supported Commands</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
                      {["Service", "Language", "Example Command", "Intent"].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#64748b", fontWeight: 700, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {commandExamples.map((ex, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${BORDER}`, background: i % 2 === 0 ? "#fff" : "#fafbff" }}>
                        <td style={{ padding: "10px 10px", fontWeight: 700, color: "#1A2332", whiteSpace: "nowrap" }}>{ex.service}</td>
                        <td style={{ padding: "10px 10px", color: "#64748b" }}>{ex.lang}</td>
                        <td style={{ padding: "10px 10px", fontStyle: "italic", color: "#334155" }}>"{ex.cmd}"</td>
                        <td style={{ padding: "10px 10px" }}>{intentBadge(ex.intent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right column — recent logs */}
          <div className="col-12 col-lg-5">
            <div style={{
              background: CARD_BG, borderRadius: 18, padding: 24,
              border: `1px solid ${BORDER}`,
              boxShadow: "0 2px 12px rgba(0,0,0,.06)", height: "100%",
            }}>
              <div className="d-flex align-items-center gap-2 mb-3">
                <i className="bi bi-clock-history" style={{ fontSize: 16, color: PRIMARY }}></i>
                <span style={{ fontWeight: 800, fontSize: 15, color: "#1A2332" }}>Recent Voice Requests</span>
                {logsLoading && <span style={{ fontSize: 11, color: "#94a3b8" }}>Loading…</span>}
              </div>
              {logs.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8" }}>
                  <i className="bi bi-mic-mute" style={{ fontSize: 40, display: "block", marginBottom: 12 }}></i>
                  <div style={{ fontSize: 13 }}>No voice requests yet.</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Logs appear once users start using voice booking.</div>
                </div>
              ) : (
                <div style={{ maxHeight: 600, overflowY: "auto" }}>
                  {logs.map((log: any, i: number) => (
                    <div key={i} style={{
                      padding: "12px 14px", borderRadius: 12, marginBottom: 8,
                      border: `1px solid ${BORDER}`,
                      background: log.success ? "#fafbff" : "#fef2f2",
                    }}>
                      <div className="d-flex align-items-start justify-content-between gap-2 mb-1">
                        <div style={{ fontSize: 12, color: "#1A2332", fontWeight: 600, fontStyle: "italic" }}>
                          "{log.originalText || log.text || '—'}"
                        </div>
                        {intentBadge(log.intent || "unknown")}
                      </div>
                      <div className="d-flex gap-3">
                        {log.pickup && (
                          <span style={{ fontSize: 10, color: "#64748b" }}>
                            <i className="bi bi-geo-alt me-1" style={{ color: "#10b981" }}></i>{log.pickup}
                          </span>
                        )}
                        {log.destination && (
                          <span style={{ fontSize: 10, color: "#64748b" }}>
                            <i className="bi bi-flag me-1" style={{ color: "#ef4444" }}></i>{log.destination}
                          </span>
                        )}
                      </div>
                      <div className="d-flex gap-2 mt-1">
                        <span style={{ fontSize: 10, color: "#94a3b8" }}>
                          {log.parser_source || log.parserSource || "ai"}
                        </span>
                        <span style={{ fontSize: 10, color: log.success ? "#10b981" : "#ef4444" }}>
                          {log.success ? "✓ Success" : "✗ Failed"}
                        </span>
                        {log.created_at && (
                          <span style={{ fontSize: 10, color: "#94a3b8" }}>
                            {new Date(log.created_at).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
  );
}
