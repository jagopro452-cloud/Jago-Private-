import { useQuery, useMutation } from "@tanstack/react-query";
import { adminFetch, queryClient, apiRequest, getSavedAdminSession } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";
import { ADMIN_ROLES, adminHasPermission } from "@shared/permissions";

// Canonical role list, single-sourced from shared/permissions.ts (also used
// by the backend's ADMIN_PERMISSION_MATRIX) - "superadmin" not "super_admin",
// matching admins.role/isPrivilegedAdminRole exactly everywhere.
const ROLES: string[] = [...ADMIN_ROLES];
const ROLE_COLORS: Record<string, string> = {
  superadmin: "#dc2626",
  operations_head: "#1a73e8",
  zone_head: "#7c3aed",
  zone_manager: "#9333ea",
  driver_onboarding_exec: "#0891b2",
  support_agent: "#16a34a",
  marketing_exec: "#d97706",
  // legacy fallbacks
  employee: "#64748b", manager: "#1a73e8", zone_manager_old: "#7c3aed",
  support: "#16a34a", admin: "#dc2626",
};

const avatarBg = (name: string) => {
  const colors = ["#1a73e8","#16a34a","#d97706","#9333ea","#0891b2","#dc2626"];
  return colors[(name || "A").charCodeAt(0) % colors.length];
};
const initials = (name: string) => (name || "?").split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();

export default function EmployeesPage() {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [zoneFilter, setZoneFilter] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "support_agent", zoneId: "", isActive: true, password: "" });

  const { data, isLoading } = useQuery<any[]>({
    queryKey: ["/api/employees", zoneFilter],
    queryFn: () => {
      const url = zoneFilter ? `/api/employees?zoneId=${zoneFilter}` : "/api/employees";
      return adminFetch(url).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : []));
    },
  });

  const { data: zones = [] } = useQuery<any[]>({
    queryKey: ["/api/zones"],
    queryFn: () => adminFetch("/api/zones").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error") })).then(d => Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : [])),
  });

  const employees = Array.isArray(data) ? data : [];
  const zonesArr = Array.isArray(zones) ? zones : (Array.isArray((zones as any)?.data) ? (zones as any).data : []);

  const saveMutation = useMutation({
    mutationFn: (payload: any) => {
      const body = { ...payload };
      if (editing && !body.password) delete body.password;
      return editing
        ? apiRequest("PUT", `/api/employees/${editing.id}`, body)
        : apiRequest("POST", "/api/employees", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setShowModal(false);
      toast({ title: editing ? "Employee updated" : "Employee created" });
      setEditing(null);
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/employees/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/employees"] }); toast({ title: "Employee deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: any) => apiRequest("PATCH", `/api/employees/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/employees"] }),
    onError: (e: any) => { queryClient.invalidateQueries({ queryKey: ["/api/employees"] }); toast({ title: "Toggle failed", description: e.message, variant: "destructive" }); },
  });

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", email: "", phone: "", role: "support_agent", zoneId: "", isActive: true, password: "" });
    setShowModal(true);
  };
  const openEdit = (e: any) => {
    setEditing(e);
    setForm({ name: e.name, email: e.email, phone: e.phone || "", role: e.role, zoneId: e.zoneId || "", isActive: e.isActive, password: "" });
    setShowModal(true);
  };

  const managerCount = employees.filter(e => e.role === "manager" || e.role === "zone_manager").length;
  const activeCount = employees.filter(e => e.isActive).length;
  // Account provisioning (create/edit/deactivate/delete) is restricted to
  // admin/superadmin per the Business Authorization Matrix - creating a
  // login-capable account is the highest-leverage action in the system.
  // Everyone with User Management access can still view this staff list.
  const canManageAccounts = adminHasPermission(getSavedAdminSession().role, "admin.write");

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">Employee Management</h4>
          <div className="text-muted small">Manage zone managers, support staff, and admin users</div>
        </div>
        {canManageAccounts && (
          <button className="btn btn-primary" onClick={openAdd} data-testid="btn-add-employee">
            <i className="bi bi-person-plus-fill me-1"></i>Add Employee
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="row g-3 mb-3">
        {[
          { label: "Total Staff", val: employees.length, icon: "bi-people-fill", color: "#1a73e8", bg: "#e8f0fe" },
          { label: "Active", val: activeCount, icon: "bi-person-check-fill", color: "#16a34a", bg: "#f0fdf4" },
          { label: "Managers", val: managerCount, icon: "bi-person-badge-fill", color: "#7c3aed", bg: "#f5f3ff" },
          { label: "Zones Covered", val: zonesArr.length, icon: "bi-map-fill", color: "#d97706", bg: "#fefce8" },
        ].map((s, i) => (
          <div key={i} className="col-6 col-xl-3">
            <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: 42, height: 42, background: s.bg, color: s.color, fontSize: "1.1rem" }}>
                  <i className={`bi ${s.icon}`}></i>
                </div>
                <div>
                  <div className="fw-bold lh-1 mb-1" style={{ fontSize: 22, color: s.color }}>
                    {isLoading ? "—" : s.val}
                  </div>
                  <div className="text-muted small">{s.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4 d-flex align-items-center justify-content-between flex-wrap gap-2"
          style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div className="fw-semibold" style={{ fontSize: 14 }}>
            <i className="bi bi-people-fill me-2 text-primary"></i>Staff List
            <span className="badge ms-2" style={{ background: "#e8f0fe", color: "#1a73e8", fontSize: 10 }}>{employees.length}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select className="admin-form-control" style={{ fontSize: 12, width: 180 }}
              value={zoneFilter} onChange={e => setZoneFilter(e.target.value)}
              data-testid="select-zone-filter">
              <option value="">All Zones</option>
              {zonesArr.map((z: any) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover mb-0">
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  {["#", "Employee", "Contact", "Role", "Zone", "Active", "Action"].map((h, i) => (
                    <th key={i} className={i === 0 ? "ps-4" : i === 6 ? "text-center pe-4" : ""}
                      style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", paddingTop: 12, paddingBottom: 12 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? Array(3).fill(0).map((_, i) => (
                  <tr key={i}>{Array(7).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                )) : employees.length === 0 ? (
                  <tr><td colSpan={7}>
                    <div className="text-center py-5 text-muted">
                      <i className="bi bi-person-square fs-1 d-block mb-2" style={{ opacity: 0.25 }}></i>
                      <p className="fw-semibold mb-1">No employees found</p>
                      {canManageAccounts && (
                        <button className="btn btn-sm btn-outline-primary mt-1" onClick={openAdd}>
                          <i className="bi bi-person-plus me-1"></i>Add First Employee
                        </button>
                      )}
                    </div>
                  </td></tr>
                ) : employees.map((e: any, idx: number) => (
                  <tr key={e.id} data-testid={`row-employee-${e.id}`}>
                    <td className="ps-4 text-muted small">{idx + 1}</td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                          style={{ width: 36, height: 36, background: avatarBg(e.name), color: "white", fontSize: 12, fontWeight: 700 }}>
                          {initials(e.name)}
                        </div>
                        <div>
                          <div className="fw-semibold" style={{ fontSize: 13 }}>{e.name}</div>
                          <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{e.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>{e.phone || "—"}</td>
                    <td>
                      <span className="badge rounded-pill"
                        style={{ background: ROLE_COLORS[e.role] + "18" || "#f1f5f9", color: ROLE_COLORS[e.role] || "#64748b", fontSize: 10 }}>
                        {e.role?.replace("_", " ")}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>{e.zoneName || "—"}</td>
                    <td>
                      <label className="switcher">
                        <input className="switcher_input" type="checkbox" checked={!!e.isActive}
                          disabled={!canManageAccounts}
                          onChange={ev => toggleMutation.mutate({ id: e.id, isActive: ev.target.checked })}
                          data-testid={`toggle-employee-${e.id}`} />
                        <span className="switcher_control"></span>
                      </label>
                    </td>
                    <td className="text-center pe-4">
                      {canManageAccounts ? (
                        <div className="d-flex justify-content-center gap-1">
                          <button className="btn btn-sm btn-outline-primary" style={{ borderRadius: 8 }}
                            onClick={() => openEdit(e)} data-testid={`btn-edit-emp-${e.id}`}>
                            <i className="bi bi-pencil-fill"></i>
                          </button>
                          <button className="btn btn-sm btn-outline-danger" style={{ borderRadius: 8 }}
                            onClick={async () => { if (await adminConfirm("Delete employee?")) deleteMutation.mutate(e.id); }}
                            data-testid={`btn-delete-emp-${e.id}`}>
                            <i className="bi bi-trash-fill"></i>
                          </button>
                        </div>
                      ) : (
                        <span className="text-muted" style={{ fontSize: 11 }}>View only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal-backdrop-jago" onClick={() => setShowModal(false)}>
          <div className="modal-jago" onClick={e => e.stopPropagation()}>
            <div className="modal-jago-header">
              <h5 className="modal-jago-title">
                <i className={`bi ${editing ? "bi-pencil-fill" : "bi-person-plus-fill"} me-2 text-primary`}></i>
                {editing ? "Edit Employee" : "Add Employee"}
              </h5>
              <button className="modal-jago-close" onClick={() => setShowModal(false)}><i className="bi bi-x-lg"></i></button>
            </div>

            <div className="d-flex flex-column gap-3">
              <div>
                <label className="form-label-jago">Full Name <span className="text-danger">*</span></label>
                <input className="admin-form-control" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Ravi Kumar" data-testid="input-employee-name" />
              </div>
              <div className="row g-3">
                <div className="col-6">
                  <label className="form-label-jago">Email <span className="text-danger">*</span></label>
                  <input type="email" className="admin-form-control" value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="ravi@jago.com" data-testid="input-employee-email" />
                </div>
                <div className="col-6">
                  <label className="form-label-jago">Phone</label>
                  <input className="admin-form-control" value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="+91 9876543210" data-testid="input-employee-phone" />
                </div>
              </div>
              <div className="row g-3">
                <div className="col-6">
                  <label className="form-label-jago">Role</label>
                  <select className="admin-form-control" value={form.role}
                    onChange={e => setForm({ ...form, role: e.target.value })}
                    data-testid="select-employee-role">
                    {ROLES.map(r => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
                  </select>
                </div>
                <div className="col-6">
                  <label className="form-label-jago">Assign Zone</label>
                  <select className="admin-form-control" value={form.zoneId}
                    onChange={e => setForm({ ...form, zoneId: e.target.value })}
                    data-testid="select-employee-zone">
                    <option value="">No Zone</option>
                    {zonesArr.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="form-label-jago">
                  {editing ? "New Password" : "Password"} {!editing && <span className="text-danger">*</span>}
                </label>
                <input type="password" className="admin-form-control" value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder={editing ? "Leave blank to keep current password" : "Set login password"}
                  data-testid="input-employee-password" />
              </div>
              <div className="d-flex align-items-center gap-3">
                <span className="form-label-jago mb-0">Active</span>
                <label className="switcher">
                  <input type="checkbox" className="switcher_input" checked={form.isActive}
                    onChange={e => setForm({ ...form, isActive: e.target.checked })} />
                  <span className="switcher_control"></span>
                </label>
              </div>
              <div className="d-flex gap-2 justify-content-end pt-2 border-top">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary"
                  disabled={!form.name || !form.email || (!editing && !form.password) || saveMutation.isPending}
                  onClick={() => saveMutation.mutate(form)} data-testid="btn-save-employee">
                  {saveMutation.isPending ? <><span className="spinner-border spinner-border-sm me-2"></span>Saving…</> : editing ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
