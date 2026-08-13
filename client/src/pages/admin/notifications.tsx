import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const TARGET_LABELS: any = { all: "All Users", customer: "Customers", driver: "Drivers" };
const TYPE_COLORS: any = { all: "primary", customer: "info", driver: "success" };
const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  sent: { label: "sent", cls: "bg-success bg-opacity-10 text-success" },
  partial: { label: "partial", cls: "bg-warning bg-opacity-10 text-warning" },
  queued: { label: "queued", cls: "bg-info bg-opacity-10 text-info" },
  no_devices: { label: "no devices", cls: "bg-secondary bg-opacity-10 text-secondary" },
  push_failed: { label: "legacy failed", cls: "bg-warning bg-opacity-10 text-warning" },
};

export default function NotificationsPage() {
  const { toast } = useToast();
  const [form, setForm] = useState({ title: "", message: "", userType: "all" });

  const { data: historyData, isLoading: histLoading } = useQuery<any>({
    queryKey: ["/api/notifications"],
    refetchInterval: 30000,
  });
  const history = historyData?.data || [];

  const sendMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/notifications/send", payload).then(r => r.json()),
    onSuccess: (data: any) => {
      toast({ title: data.message || `Notification saved for ${data.recipientCount || 0} devices` });
      if (data.pushWarning) {
        toast({ title: `Delivery warning: ${data.failedCount || 0} device token(s) need refresh`, variant: "default" });
      }
      setForm({ title: "", message: "", userType: "all" });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
    onError: (error: any) => toast({
      title: "Failed to send notification",
      description: error?.message || "Server rejected the notification request.",
      variant: "destructive",
    }),
  });

  const totalSent = history.reduce((s: number, n: any) => s + (n.recipientCount || 0), 0);
  const todaySent = history.filter((n: any) => {
    const d = new Date(n.sentAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
            <h2 className="h5 mb-0">Push Notifications</h2>
          </div>
        </div>
      </div>
      <div className="container-fluid">
        <div className="row g-3 mb-4">
          {[
            { label: "Total Campaigns", val: history.length, icon: "bi-bell-fill", color: "#4f46e5", bg: "linear-gradient(135deg,#4f46e515,#818cf815)" },
            { label: "Today Sent", val: todaySent, icon: "bi-calendar-check-fill", color: "#059669", bg: "linear-gradient(135deg,#05966915,#34d39915)" },
            { label: "Target Devices", val: totalSent.toLocaleString(), icon: "bi-people-fill", color: "#0284c7", bg: "linear-gradient(135deg,#0284c715,#38bdf815)" },
            { label: "This Month", val: history.filter((n: any) => new Date(n.sentAt) >= new Date(new Date().getFullYear(), new Date().getMonth(), 1)).length, icon: "bi-bar-chart-fill", color: "#d97706", bg: "linear-gradient(135deg,#d9770615,#fbbf2415)" },
          ].map((s, i) => (
            <div className="col-6 col-md-3" key={i}>
              <div className="card border-0" style={{ background: s.bg }}>
                <div className="card-body d-flex align-items-center gap-3 p-3">
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: s.color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className={`bi ${s.icon}`} style={{ color: s.color, fontSize: "1.1rem" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.val}</div>
                    <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 2 }}>{s.label}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="row g-4">
          <div className="col-lg-5">
            <div className="card h-100">
              <div className="card-header border-bottom py-3">
                <h5 className="card-title mb-0"><i className="bi bi-send-fill me-2 text-primary"></i>Send New Notification</h5>
              </div>
              <div className="card-body">
                <div className="mb-3">
                  <label className="form-label fw-semibold">Target User Type</label>
                  <select className="form-select" value={form.userType} onChange={e => setForm({ ...form, userType: e.target.value })} data-testid="select-user-type">
                    <option value="all">All Users (Customers + Drivers)</option>
                    <option value="customer">Customers Only</option>
                    <option value="driver">Drivers Only</option>
                  </select>
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold">Notification Title <span className="text-danger">*</span></label>
                  <input
                    className="form-control"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    placeholder="e.g. Weekend Offer!"
                    data-testid="input-notif-title"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold">Message <span className="text-danger">*</span></label>
                  <textarea
                    className="form-control"
                    rows={5}
                    value={form.message}
                    onChange={e => setForm({ ...form, message: e.target.value })}
                    placeholder="Enter notification message..."
                    data-testid="input-notif-message"
                  />
                  <small className="text-muted">{form.message.length}/250 chars</small>
                </div>
                <div className="mb-3 p-3 rounded" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: 4 }}>Preview</div>
                  <div className="d-flex gap-2 align-items-start">
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: "#4f46e5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <i className="bi bi-car-front-fill text-white" style={{ fontSize: "1rem" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>{form.title || "Notification Title"}</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{form.message || "Your message will appear here..."}</div>
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-primary w-100"
                  disabled={!form.title || !form.message || sendMutation.isPending}
                  onClick={() => sendMutation.mutate(form)}
                  data-testid="btn-send-notif"
                >
                  <i className="bi bi-send-fill me-2"></i>
                  {sendMutation.isPending ? "Sending..." : "Send Notification"}
                </button>
              </div>
            </div>
          </div>

          <div className="col-lg-7">
            <div className="card h-100">
              <div className="card-header border-bottom py-3 d-flex align-items-center justify-content-between">
                <h5 className="card-title mb-0"><i className="bi bi-clock-history me-2 text-secondary"></i>Notification History</h5>
                <span className="badge bg-secondary">{history.length} total</span>
              </div>
              <div className="card-body p-0" style={{ maxHeight: "520px", overflowY: "auto" }}>
                {histLoading ? (
                  <div className="text-center py-4"><div className="spinner-border spinner-border-sm text-primary" /></div>
                ) : history.length === 0 ? (
                  <div className="text-center py-5 text-muted">
                    <i className="bi bi-bell-slash fs-2 d-block mb-2 opacity-25"></i>
                    <p className="mb-0">No notifications sent yet</p>
                  </div>
                ) : history.map((n: any, i: number) => {
                  const status = STATUS_BADGES[n.status] || STATUS_BADGES.sent;
                  return (
                    <div key={n.id} data-testid={`notif-row-${n.id}`} className="p-3 border-bottom" style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                      <div className="d-flex align-items-start gap-3">
                        <div style={{
                          width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                          background: TYPE_COLORS[n.userType] === "primary" ? "#4f46e522" : TYPE_COLORS[n.userType] === "info" ? "#0284c722" : "#05966922",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <i className="bi bi-bell-fill" style={{
                            fontSize: "0.9rem",
                            color: TYPE_COLORS[n.userType] === "primary" ? "#4f46e5" : TYPE_COLORS[n.userType] === "info" ? "#0284c7" : "#059669"
                          }} />
                        </div>
                        <div className="flex-grow-1 min-w-0">
                          <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{n.title}</span>
                            <span className={`badge bg-${TYPE_COLORS[n.userType] || "secondary"} bg-opacity-10 text-${TYPE_COLORS[n.userType] || "secondary"}`} style={{ fontSize: "0.68rem" }}>
                              {TARGET_LABELS[n.userType] || n.userType}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "#64748b", marginBottom: 4 }}>{n.message}</div>
                          <div className="d-flex gap-3 flex-wrap" style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                            <span><i className="bi bi-people me-1"></i>{(n.recipientCount || 0).toLocaleString()} devices</span>
                            <span><i className="bi bi-check2-circle me-1"></i>{(n.deliveredCount || 0).toLocaleString()} delivered</span>
                            <span><i className="bi bi-clock me-1"></i>{timeAgo(n.sentAt)}</span>
                            <span className={`badge ${status.cls}`} style={{ fontSize: "0.68rem" }}>{status.label}</span>
                          </div>
                          {n.errorMessage && (
                            <div className="mt-2 text-muted" style={{ fontSize: "0.72rem" }}>
                              <i className="bi bi-info-circle me-1"></i>{n.errorMessage}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
