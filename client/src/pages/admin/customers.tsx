import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

const avatarBg = (name: string) => {
  const colors = ["#1a73e8", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#dc2626", "#0ea5e9"];
  return colors[(name || "A").charCodeAt(0) % colors.length];
};

const initials = (name: string) =>
  (name || "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

function formatJoinedDate(value: string | undefined) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "-";
  }
}

export default function Customers() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ fullName: "", phone: "", email: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/users", { userType: "customer", search, page, status }],
    queryFn: async () => {
      const params = new URLSearchParams({ userType: "customer", page: String(page), limit: "15" });
      if (search) params.set("search", search);
      if (status !== "all") params.set("isActive", status === "active" ? "true" : "false");

      const response = await adminFetch(`/api/users?${params}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.message || "Error");
      }

      const body = await response.json();
      return body?.data ? body : { data: Array.isArray(body) ? body : [], total: 0 };
    },
  });

  const addCustomer = useMutation({
    mutationFn: () => apiRequest("POST", "/api/users", { ...form, userType: "customer" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Customer added successfully" });
      setShowAdd(false);
      setForm({ fullName: "", phone: "", email: "" });
    },
    onError: (error: any) =>
      toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/users/${id}/status`, { isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Customer status updated" });
    },
  });

  const deleteCustomer = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/users/${id}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Customer deleted" });
    },
  });

  const totalPages = Math.ceil((data?.total || 0) / 15);
  const total = data?.total || 0;
  const rows = Array.isArray(data?.data) ? data.data : [];

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="mb-0 fw-bold" data-testid="page-title">
            Customer Management
          </h4>
          <div className="text-muted small">All registered riders and parcel users</div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className="text-muted small">Total:</span>
          <span className="fw-bold text-primary fs-5 me-3" data-testid="total-count">
            {total}
          </span>
          <button
            className="btn btn-primary btn-sm d-flex align-items-center gap-1"
            onClick={() => setShowAdd(true)}
            data-testid="btn-add-customer"
          >
            <i className="bi bi-person-plus-fill"></i>
            Add Customer
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="modal show d-block" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg" style={{ borderRadius: 16 }}>
              <div className="modal-header border-0 pb-0">
                <h5 className="modal-title fw-bold">Add New Customer</h5>
                <button className="btn-close" onClick={() => setShowAdd(false)}></button>
              </div>
              <div className="modal-body px-4 pb-4">
                <div className="mb-3">
                  <label className="form-label fw-semibold small">
                    Full Name <span className="text-danger">*</span>
                  </label>
                  <input
                    className="form-control"
                    placeholder="e.g. Ravi Kumar"
                    value={form.fullName}
                    onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                    data-testid="input-customer-name"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold small">
                    Phone Number <span className="text-danger">*</span>
                  </label>
                  <input
                    className="form-control"
                    placeholder="+91 9876543210"
                    type="tel"
                    value={form.phone}
                    onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                    data-testid="input-customer-phone"
                  />
                </div>
                <div className="mb-4">
                  <label className="form-label fw-semibold small">
                    Email <span className="text-muted">(optional)</span>
                  </label>
                  <input
                    className="form-control"
                    placeholder="ravi@example.com"
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                    data-testid="input-customer-email"
                  />
                </div>
                <div className="d-flex gap-2">
                  <button className="btn btn-light flex-1" onClick={() => setShowAdd(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary flex-1"
                    disabled={!form.fullName || !form.phone || addCustomer.isPending}
                    onClick={() => addCustomer.mutate()}
                    data-testid="btn-save-customer"
                  >
                    {addCustomer.isPending ? "Saving..." : "Add Customer"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
            <ul className="nav nav--tabs p-1 rounded bg-light" role="tablist">
              {["all", "active", "inactive"].map((entry) => (
                <li key={entry} className="nav-item">
                  <button
                    className={`nav-link${status === entry ? " active" : ""} d-flex align-items-center gap-1`}
                    onClick={() => {
                      setStatus(entry);
                      setPage(1);
                    }}
                    data-testid={`tab-${entry}`}
                  >
                    {entry.charAt(0).toUpperCase() + entry.slice(1)}
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="search-form search-form_style-two"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
              }}
            >
              <div className="input-group search-form__input_group">
                <span className="search-form__icon">
                  <i className="bi bi-search"></i>
                </span>
                <input
                  type="search"
                  className="theme-input-style search-form__input"
                  placeholder="Search by name, phone, email..."
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  data-testid="input-search"
                />
              </div>
              <button type="submit" className="btn btn-primary" data-testid="btn-search">
                Search
              </button>
            </form>
          </div>
        </div>

        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover mb-0">
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  {["#", "Customer", "Contact", "Wallet", "Trips", "Joined", "Status", "Actions"].map((heading, index) => (
                    <th
                      key={index}
                      className={index === 0 ? "ps-4" : index === 7 ? "text-center pe-4" : ""}
                      style={{
                        fontSize: 11,
                        color: "#94a3b8",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: ".5px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, rowIndex) => (
                    <tr key={rowIndex}>
                      {Array.from({ length: 8 }).map((__, columnIndex) => (
                        <td key={columnIndex}>
                          <div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : rows.length ? (
                  rows.map((item: any, idx: number) => {
                    const user = item.user || item;
                    const name =
                      user.fullName ||
                      `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
                      "Customer";
                    const wallet = Number(user.walletBalance || 0).toFixed(0);

                    return (
                      <tr key={user.id} data-testid={`customer-row-${user.id}`}>
                        <td className="ps-4 text-muted small">{(page - 1) * 15 + idx + 1}</td>
                        <td>
                          <div className="d-flex align-items-center gap-3">
                            <div
                              className="d-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                              style={{
                                width: 40,
                                height: 40,
                                background: avatarBg(name),
                                color: "white",
                                fontWeight: 700,
                                fontSize: 14,
                              }}
                            >
                              {initials(name)}
                            </div>
                            <div>
                              <div className="fw-semibold" style={{ fontSize: 13, color: "#0f172a" }}>
                                {name}
                              </div>
                              <div style={{ fontSize: 10, color: "#94a3b8" }}>
                                {user.isActive ? (
                                  <span className="text-success fw-semibold">Active</span>
                                ) : (
                                  <span className="text-muted">Inactive</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div style={{ fontSize: 13 }}>{user.phone || "-"}</div>
                          <div className="text-muted" style={{ fontSize: 11 }}>
                            {user.email || "-"}
                          </div>
                        </td>
                        <td>
                          <div className="d-flex align-items-center gap-1">
                            <i className="bi bi-wallet2" style={{ color: "#1a73e8", fontSize: 13 }}></i>
                            <span className="fw-semibold small" style={{ color: "#1a73e8" }}>
                              Rs. {wallet}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="fw-semibold" style={{ fontSize: 14 }}>
                            {item.tripCount || 0}
                          </div>
                          <div style={{ fontSize: 10, color: "#94a3b8" }}>trips</div>
                        </td>
                        <td className="text-muted" style={{ fontSize: 12 }}>
                          {formatJoinedDate(user.createdAt)}
                        </td>
                        <td>
                          <label className="switcher">
                            <input
                              type="checkbox"
                              className="switcher_input"
                              checked={user.isActive}
                              onChange={() => toggleStatus.mutate({ id: user.id, isActive: !user.isActive })}
                              data-testid={`toggle-customer-${user.id}`}
                            />
                            <span className="switcher_control"></span>
                          </label>
                        </td>
                        <td className="text-center pe-4">
                          <div className="d-flex gap-1 justify-content-center">
                            <button
                              className="btn btn-sm btn-outline-primary rounded-pill px-3"
                              style={{ fontSize: 12 }}
                              data-testid={`btn-view-customer-${user.id}`}
                            >
                              <i className="bi bi-eye me-1"></i>
                              View
                            </button>
                            <button
                              className="btn btn-sm btn-outline-danger rounded-pill"
                              style={{ fontSize: 12 }}
                              onClick={async () => {
                                if (await adminConfirm("Delete this customer?")) deleteCustomer.mutate(user.id);
                              }}
                              data-testid={`btn-delete-customer-${user.id}`}
                            >
                              <i className="bi bi-trash"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8}>
                      <div className="text-center py-5 text-muted">
                        <i className="bi bi-people fs-1 d-block mb-2" style={{ opacity: 0.3 }}></i>
                        <p className="fw-semibold mb-1">No customers found</p>
                        <p className="small mb-3">Customers register via the JAGO mobile app, or add manually above</p>
                        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
                          <i className="bi bi-person-plus-fill me-1"></i>
                          Add Customer
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="card-footer bg-white border-0 py-3 px-4 d-flex align-items-center justify-content-between">
            <div className="text-muted small">Showing page {page} of {totalPages}</div>
            <div className="d-flex gap-1">
              <button
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
              >
                <i className="bi bi-chevron-left"></i>
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, index) => index + 1).map((entry) => (
                <button
                  key={entry}
                  className={`btn btn-sm ${entry === page ? "btn-primary" : "btn-outline-secondary"}`}
                  onClick={() => setPage(entry)}
                >
                  {entry}
                </button>
              ))}
              <button
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page === totalPages}
              >
                <i className="bi bi-chevron-right"></i>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
