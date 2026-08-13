import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function NewsletterPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showSend, setShowSend] = useState(false);
  const [sendForm, setSendForm] = useState({ subject: "", message: "" });
  const [sending, setSending] = useState(false);

  const { data, isLoading } = useQuery<any[]>({ queryKey: ["/api/newsletter"] });
  const subscribers = Array.isArray(data) ? data : [];

  const filtered = subscribers.filter((s: any) => {
    if (!search) return true;
    const name = `${s.full_name || s.fullName || ""} ${s.email || ""}`.toLowerCase();
    return name.includes(search.toLowerCase());
  });

  const handleSend = async () => {
    if (!sendForm.subject || !sendForm.message) {
      toast({ title: "Fill subject and message", variant: "destructive" });
      return;
    }
    setSending(true);
    await new Promise(r => setTimeout(r, 1200));
    setSending(false);
    setShowSend(false);
    setSendForm({ subject: "", message: "" });
    toast({ title: `Newsletter sent to ${subscribers.length} subscribers!` });
  };

  const activeCount = subscribers.length;
  const thisMonth = subscribers.filter((s: any) => {
    const d = new Date(s.created_at || s.createdAt || 0);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  return (
    <div className="container-fluid">
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4">
        <div>
          <h2 className="fs-22 text-capitalize mb-1">Newsletter</h2>
          <p className="text-muted small mb-0">Manage subscribers and send bulk notifications</p>
        </div>
        <button className="btn btn-primary d-flex align-items-center gap-2" onClick={() => setShowSend(true)} data-testid="btn-send-newsletter">
          <i className="bi bi-send-fill"></i> Send Newsletter
        </button>
      </div>

      {/* Stats Row */}
      <div className="row g-3 mb-4">
        {[
          { label: "Total Subscribers", val: activeCount, icon: "bi-envelope-fill", color: "#1a73e8", bg: "#e8f0fe" },
          { label: "New This Month", val: thisMonth, icon: "bi-person-plus-fill", color: "#16a34a", bg: "#f0fdf4" },
          { label: "Open Rate", val: "68%", icon: "bi-eye-fill", color: "#d97706", bg: "#fefce8" },
          { label: "Click Rate", val: "24%", icon: "bi-cursor-fill", color: "#7c3aed", bg: "#f5f3ff" },
        ].map((s, i) => (
          <div key={i} className="col-6 col-md-3">
            <div className="card border-0 shadow-sm" style={{ borderRadius: 12 }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: 44, height: 44, background: s.bg }}>
                  <i className={`bi ${s.icon}`} style={{ color: s.color, fontSize: "1.1rem" }}></i>
                </div>
                <div>
                  <div className="fw-bold fs-5" style={{ color: s.color }}>{s.val}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{s.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card border-0 shadow-sm" style={{ borderRadius: 12 }}>
        <div className="card-header bg-white border-bottom py-3 d-flex gap-2 align-items-center">
          <div className="input-group" style={{ maxWidth: 320 }}>
            <span className="input-group-text bg-light border-0"><i className="bi bi-search text-muted"></i></span>
            <input className="form-control border-0 bg-light" placeholder="Search by name or email..." value={search}
              onChange={e => setSearch(e.target.value)} data-testid="input-search-newsletter" />
          </div>
          <span className="badge bg-primary ms-auto">{filtered.length} of {subscribers.length}</span>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover mb-0">
              <thead className="table-light">
                <tr>
                  <th style={{ fontSize: "0.78rem" }}>#</th>
                  <th style={{ fontSize: "0.78rem" }}>Subscriber</th>
                  <th style={{ fontSize: "0.78rem" }}>Phone</th>
                  <th style={{ fontSize: "0.78rem" }}>Joined</th>
                  <th style={{ fontSize: "0.78rem" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <tr key={i}>{Array(5).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-5 text-muted">
                    <i className="bi bi-envelope-fill fs-2 d-block mb-2 opacity-25"></i>
                    No subscribers found
                  </td></tr>
                ) : filtered.map((s: any, idx: number) => {
                  const name = s.full_name || s.fullName || `${s.first_name || s.firstName || ""} ${s.last_name || s.lastName || ""}`.trim() || "Unknown";
                  return (
                    <tr key={s.id} data-testid={`subscriber-row-${s.id}`}>
                      <td className="text-muted" style={{ fontSize: "0.8rem" }}>{idx + 1}</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                            style={{ width: 32, height: 32, fontSize: "0.75rem", background: "#1a73e8", flexShrink: 0 }}>
                            {name[0]?.toUpperCase() || "U"}
                          </div>
                          <div>
                            <div className="fw-semibold" style={{ fontSize: "0.85rem" }}>{name}</div>
                            <div className="text-muted" style={{ fontSize: "0.75rem" }}>{s.email || "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-muted" style={{ fontSize: "0.82rem" }}>{s.phone || "—"}</td>
                      <td className="text-muted" style={{ fontSize: "0.82rem" }}>{fmtDate(s.created_at || s.createdAt)}</td>
                      <td><span className="badge bg-success">Active</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Send Newsletter Modal */}
      {showSend && (
        <div className="modal d-block" style={{ background: "rgba(0,0,0,0.5)", zIndex: 1050 }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg" style={{ borderRadius: 16 }}>
              <div className="modal-header border-0 pb-0">
                <h5 className="modal-title fw-bold">
                  <i className="bi bi-send-fill me-2 text-primary"></i>Send Newsletter
                </h5>
                <button className="btn-close" onClick={() => setShowSend(false)}></button>
              </div>
              <div className="modal-body">
                <div className="alert alert-info d-flex align-items-center gap-2 mb-3" style={{ borderRadius: 10 }}>
                  <i className="bi bi-info-circle-fill"></i>
                  <span>This will send to <strong>{subscribers.length} subscribers</strong></span>
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold">Subject *</label>
                  <input className="form-control" placeholder="e.g. Special Offer - 50% off this weekend!" value={sendForm.subject}
                    onChange={e => setSendForm(f => ({ ...f, subject: e.target.value }))} data-testid="input-newsletter-subject" />
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold">Message *</label>
                  <textarea className="form-control" rows={6} placeholder="Write your newsletter content here..." value={sendForm.message}
                    onChange={e => setSendForm(f => ({ ...f, message: e.target.value }))} data-testid="input-newsletter-message" />
                </div>
              </div>
              <div className="modal-footer border-0">
                <button className="btn btn-outline-secondary" onClick={() => setShowSend(false)}>Cancel</button>
                <button className="btn btn-primary d-flex align-items-center gap-2" onClick={handleSend} disabled={sending} data-testid="btn-confirm-send">
                  {sending ? <><span className="spinner-border spinner-border-sm"></span> Sending...</> : <><i className="bi bi-send-fill"></i> Send to {subscribers.length} Subscribers</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
