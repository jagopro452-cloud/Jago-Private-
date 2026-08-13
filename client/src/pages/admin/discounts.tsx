import { useQuery, useMutation } from "@tanstack/react-query";
import { adminFetch, queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

const EMPTY_FORM = {
  name: "",
  discountAmount: "",
  discountType: "percentage",
  minOrderAmount: "",
  maxDiscountAmount: "",
  serviceType: "all",
  vehicleCategoryId: "",
  isActive: true,
};

const getDiscountTargetLabel = (discount: any) => {
  if (discount.vehicleCategoryName) return discount.vehicleCategoryName;
  if (discount.serviceType === "ride") return "Ride";
  if (discount.serviceType === "parcel") return "Parcel";
  if (discount.serviceType === "pool") return "Pool";
  return "All Services";
};

const getDiscountValueLabel = (discount: any) => {
  const amount = Number(discount.discountAmount || 0);
  if ((discount.discountType || "").toLowerCase() === "amount") {
    return `Rs. ${amount.toFixed(0)}`;
  }
  return `${amount}%`;
};

const getTargetBadgeStyle = (discount: any) => {
  if (discount.vehicleCategoryName) {
    return {
      background: "linear-gradient(135deg, rgba(59,130,246,.12), rgba(37,99,235,.18))",
      color: "#1d4ed8",
      border: "1px solid rgba(37,99,235,.18)",
    };
  }
  if (discount.serviceType === "parcel") {
    return {
      background: "linear-gradient(135deg, rgba(245,158,11,.12), rgba(217,119,6,.18))",
      color: "#b45309",
      border: "1px solid rgba(217,119,6,.18)",
    };
  }
  if (discount.serviceType === "pool") {
    return {
      background: "linear-gradient(135deg, rgba(139,92,246,.12), rgba(124,58,237,.18))",
      color: "#6d28d9",
      border: "1px solid rgba(124,58,237,.18)",
    };
  }
  if (discount.serviceType === "ride") {
    return {
      background: "linear-gradient(135deg, rgba(16,185,129,.12), rgba(5,150,105,.18))",
      color: "#047857",
      border: "1px solid rgba(5,150,105,.18)",
    };
  }
  return {
    background: "linear-gradient(135deg, rgba(15,23,42,.05), rgba(148,163,184,.12))",
    color: "#475569",
    border: "1px solid rgba(148,163,184,.18)",
  };
};

export default function DiscountsPage() {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/discounts"],
    queryFn: async () => {
      const response = await adminFetch("/api/discounts");
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.message || "Failed to load discounts");
      }
      return response.json();
    },
  });

  const { data: vehicleCategories } = useQuery<any>({
    queryKey: ["/api/vehicle-categories"],
    queryFn: async () => {
      const response = await adminFetch("/api/vehicle-categories");
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.message || "Failed to load vehicle categories");
      }
      return response.json();
    },
  });

  const discounts = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  const categories = Array.isArray(vehicleCategories)
    ? vehicleCategories
    : Array.isArray(vehicleCategories?.data)
      ? vehicleCategories.data
      : [];

  const filteredCategories =
    form.serviceType === "all"
      ? categories
      : categories.filter((category: any) => {
          const serviceType = String(category.serviceType ?? category.type ?? "").toLowerCase();
          if (form.serviceType === "pool") return serviceType === "pool" || serviceType === "carpool";
          return serviceType === form.serviceType;
        });

  const saveMutation = useMutation({
    mutationFn: (payload: any) =>
      editing
        ? apiRequest("PUT", `/api/discounts/${editing.id}`, payload)
        : apiRequest("POST", "/api/discounts", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/discounts"] });
      setShowModal(false);
      toast({ title: editing ? "Discount updated" : "Discount created" });
      setEditing(null);
      setForm({ ...EMPTY_FORM });
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/discounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/discounts"] });
      toast({ title: "Discount deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/discounts/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/discounts"] });
      toast({ title: "Status updated" });
    },
    onError: (e: any) => { queryClient.invalidateQueries({ queryKey: ["/api/discounts"] }); toast({ title: "Failed to update status", description: e.message, variant: "destructive" }); },
  });

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const openEdit = (discount: any) => {
    setEditing(discount);
    setForm({
      name: discount.name,
      discountAmount: discount.discountAmount,
      discountType: discount.discountType,
      minOrderAmount: discount.minOrderAmount || "",
      maxDiscountAmount: discount.maxDiscountAmount || "",
      serviceType: discount.serviceType || "all",
      vehicleCategoryId: discount.vehicleCategoryId || "",
      isActive: discount.isActive,
    });
    setShowModal(true);
  };

  return (
    <>
      <div className="container-fluid">
        <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
          <div>
            <h4 className="mb-0 fw-bold" data-testid="page-title">
              Discount Setup
            </h4>
            <div className="text-muted small">Auto discounts by service and vehicle category</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openAdd} data-testid="btn-add-discount">
            <i className="bi bi-plus me-1"></i>
            Add Discount
          </button>
        </div>

        <div className="card border-0 shadow-sm">
          <div
            className="card-body"
            style={{
              borderRadius: 18,
              background: "linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,250,252,.96))",
              boxShadow: "0 18px 40px rgba(15,23,42,.06)",
            }}
          >
            <div className="table-responsive">
              <table className="table table-borderless align-middle table-hover">
                <thead className="table-light">
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Discount</th>
                    <th>Type</th>
                    <th>Min Order</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="text-center py-4">
                        <div className="spinner-border spinner-border-sm" role="status" />
                      </td>
                    </tr>
                  ) : discounts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-5 text-muted">
                        <i className="bi bi-percent fs-2 d-block mb-2 opacity-25"></i>
                        No discounts found. Click Add Discount to create one.
                      </td>
                    </tr>
                  ) : (
                    discounts.map((discount: any, idx: number) => (
                      <tr
                        key={discount.id}
                        data-testid={`row-discount-${discount.id}`}
                        style={{ borderBottom: "1px solid rgba(226,232,240,.7)" }}
                      >
                        <td>{idx + 1}</td>
                        <td>
                          <div className="fw-semibold text-dark">{discount.name}</div>
                          <div style={{ fontSize: "0.74rem", color: "#64748b" }}>
                            {discount.maxDiscountAmount
                              ? `Cap: Rs. ${Number(discount.maxDiscountAmount).toFixed(0)}`
                              : "No cap"}
                          </div>
                        </td>
                        <td>
                          <span className="fw-semibold" style={{ color: "#0f172a", fontSize: "0.95rem" }}>
                            {getDiscountValueLabel(discount)}
                          </span>
                        </td>
                        <td>
                          <span
                            className="badge rounded-pill text-capitalize"
                            style={{
                              background: "rgba(37,99,235,.08)",
                              color: "#1d4ed8",
                              border: "1px solid rgba(37,99,235,.12)",
                              padding: "0.45rem 0.7rem",
                              fontWeight: 600,
                            }}
                          >
                            {discount.discountType}
                          </span>
                        </td>
                        <td>{discount.minOrderAmount ? `Rs. ${Number(discount.minOrderAmount).toFixed(0)}` : "-"}</td>
                        <td>
                          <span
                            className="badge rounded-pill"
                            style={{
                              ...getTargetBadgeStyle(discount),
                              padding: "0.48rem 0.75rem",
                              fontWeight: 600,
                            }}
                          >
                            {getDiscountTargetLabel(discount)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`badge rounded-pill ${discount.isActive ? "bg-success-subtle text-success" : "bg-secondary-subtle text-secondary"}`}
                            style={{
                              border: discount.isActive
                                ? "1px solid rgba(22,163,74,.18)"
                                : "1px solid rgba(100,116,139,.18)",
                              padding: "0.48rem 0.75rem",
                            }}
                          >
                            {discount.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td>
                          <button
                            className={`btn btn-sm me-1 ${discount.isActive ? "btn-outline-warning" : "btn-outline-success"}`}
                            onClick={() => toggleMutation.mutate({ id: discount.id, isActive: !discount.isActive })}
                            title={discount.isActive ? "Deactivate" : "Activate"}
                            data-testid={`btn-toggle-discount-${discount.id}`}
                          >
                            <i className={`bi ${discount.isActive ? "bi-toggle-on" : "bi-toggle-off"}`}></i>
                          </button>
                          <button
                            className="btn btn-sm btn-outline-primary me-1"
                            onClick={() => openEdit(discount)}
                            data-testid={`btn-edit-discount-${discount.id}`}
                          >
                            <i className="bi bi-pencil-fill"></i>
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={async () => {
                              if (await adminConfirm("Delete this discount?")) deleteMutation.mutate(discount.id);
                            }}
                            data-testid={`btn-delete-discount-${discount.id}`}
                          >
                            <i className="bi bi-trash-fill"></i>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal fade show d-block" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{editing ? "Edit Discount" : "Add Discount"}</h5>
                <button className="btn-close" onClick={() => setShowModal(false)} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label fw-semibold">
                    Name <span className="text-danger">*</span>
                  </label>
                  <input
                    className="form-control"
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    data-testid="input-discount-name"
                  />
                </div>
                <div className="row g-3 mb-3">
                  <div className="col-6">
                    <label className="form-label fw-semibold">
                      Discount Amount <span className="text-danger">*</span>
                    </label>
                    <input
                      className="form-control"
                      type="number"
                      min="0"
                      value={form.discountAmount}
                      onChange={(event) => setForm({ ...form, discountAmount: event.target.value })}
                      data-testid="input-discount-amount"
                    />
                  </div>
                  <div className="col-6">
                    <label className="form-label fw-semibold">Type</label>
                    <select
                      className="form-select"
                      value={form.discountType}
                      onChange={(event) => setForm({ ...form, discountType: event.target.value })}
                      data-testid="select-discount-type"
                    >
                      <option value="percentage">Percentage (%)</option>
                      <option value="amount">Fixed Amount (Rs.)</option>
                    </select>
                  </div>
                </div>
                <div className="row g-3 mb-3">
                  <div className="col-6">
                    <label className="form-label fw-semibold">Min Order Amount</label>
                    <input
                      className="form-control"
                      type="number"
                      min="0"
                      value={form.minOrderAmount}
                      onChange={(event) => setForm({ ...form, minOrderAmount: event.target.value })}
                      data-testid="input-min-order"
                    />
                  </div>
                  <div className="col-6">
                    <label className="form-label fw-semibold">Max Discount</label>
                    <input
                      className="form-control"
                      type="number"
                      min="0"
                      value={form.maxDiscountAmount}
                      onChange={(event) => setForm({ ...form, maxDiscountAmount: event.target.value })}
                      data-testid="input-max-discount"
                    />
                  </div>
                </div>
                <div className="row g-3 mb-3">
                  <div className="col-6">
                    <label className="form-label fw-semibold">Service Target</label>
                    <select
                      className="form-select"
                      value={form.serviceType}
                      onChange={(event) =>
                        setForm({ ...form, serviceType: event.target.value, vehicleCategoryId: "" })
                      }
                      data-testid="select-discount-service-type"
                    >
                      <option value="all">All Services</option>
                      <option value="ride">Ride</option>
                      <option value="pool">Pool</option>
                      <option value="parcel">Parcel</option>
                    </select>
                  </div>
                  <div className="col-6">
                    <label className="form-label fw-semibold">Vehicle Category</label>
                    <select
                      className="form-select"
                      value={form.vehicleCategoryId}
                      onChange={(event) => setForm({ ...form, vehicleCategoryId: event.target.value })}
                      data-testid="select-discount-vehicle-category"
                    >
                      <option value="">All in selected service</option>
                      {filteredCategories.map((category: any) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-light" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!form.name || !form.discountAmount || saveMutation.isPending}
                  onClick={() => saveMutation.mutate(form)}
                  data-testid="btn-discount-save"
                >
                  {saveMutation.isPending ? "Saving..." : editing ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
