import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";
import { Link } from "wouter";

const defaultForm = {
  zoneId: "",
  baseFare: "",
  farePerKm: "",
  farePerKg: "",
  minimumFare: "",
  loadingCharge: "",
  helperChargePerHour: "",
  maxHelpers: "",
};

function ParcelFareModal({ open, onClose, editing, zones, form, setForm, onSave, saving }: any) {
  if (!open) return null;
  return (
    <div className="modal-backdrop-jago">
      <div className="modal-jago" style={{ maxWidth: 620 }}>
        <div className="modal-jago-header">
          <h5 className="modal-jago-title">
            <i className={`bi ${editing ? "bi-pencil-fill" : "bi-plus-circle-fill"} me-2 text-primary`} />
            {editing ? "Edit Parcel Fare" : "Add Parcel Fare"}
          </h5>
          <button type="button" className="modal-jago-close" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="d-flex flex-column gap-3">
          <div>
            <label className="form-label-jago">Operation Zone <span className="text-danger">*</span></label>
            <select className="admin-form-control" value={form.zoneId} onChange={(e) => setForm((f: any) => ({ ...f, zoneId: e.target.value }))} data-testid="select-parcel-zone">
              <option value="">Select zone</option>
              {zones?.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          <div className="alert alert-info py-2 mb-0 small">
            <i className="bi bi-info-circle me-1" />
            Vehicle-specific base rates are managed in{" "}
            <Link href="/admin/parcel-vehicle-types" className="alert-link">Parcel Vehicle Types</Link>.
            Zone fares here override per-km/per-kg for that zone.
          </div>
          <p className="text-muted small mb-0 fw-semibold">Base rates (per booking)</p>
          <div className="row g-3">
            <div className="col-6">
              <label className="form-label-jago">Base Fare (₹)</label>
              <input type="number" min="0" className="admin-form-control" value={form.baseFare} onChange={(e) => setForm((f: any) => ({ ...f, baseFare: e.target.value }))} data-testid="input-parcel-base-fare" />
            </div>
            <div className="col-6">
              <label className="form-label-jago">Per Km (₹)</label>
              <input type="number" min="0" className="admin-form-control" value={form.farePerKm} onChange={(e) => setForm((f: any) => ({ ...f, farePerKm: e.target.value }))} data-testid="input-parcel-per-km" />
            </div>
            <div className="col-6">
              <label className="form-label-jago">Per Kg (₹)</label>
              <input type="number" min="0" className="admin-form-control" value={form.farePerKg} onChange={(e) => setForm((f: any) => ({ ...f, farePerKg: e.target.value }))} data-testid="input-parcel-per-kg" />
            </div>
            <div className="col-6">
              <label className="form-label-jago">Minimum Fare (₹)</label>
              <input type="number" min="0" className="admin-form-control" value={form.minimumFare} onChange={(e) => setForm((f: any) => ({ ...f, minimumFare: e.target.value }))} data-testid="input-parcel-min-fare" />
            </div>
          </div>
          <p className="text-muted small mb-0 fw-semibold">Loading &amp; helper charges (optional)</p>
          <div className="row g-3">
            <div className="col-6">
              <label className="form-label-jago">Loading Charge (₹)</label>
              <input type="number" min="0" className="admin-form-control" value={form.loadingCharge} onChange={(e) => setForm((f: any) => ({ ...f, loadingCharge: e.target.value }))} data-testid="input-parcel-loading" />
            </div>
            <div className="col-6">
              <label className="form-label-jago">Helper Charge / hr (₹)</label>
              <input type="number" min="0" className="admin-form-control" value={form.helperChargePerHour} onChange={(e) => setForm((f: any) => ({ ...f, helperChargePerHour: e.target.value }))} data-testid="input-parcel-helper-rate" />
            </div>
            <div className="col-12">
              <label className="form-label-jago">Max Helpers Allowed</label>
              <input type="number" min="0" max="10" className="admin-form-control" value={form.maxHelpers} onChange={(e) => setForm((f: any) => ({ ...f, maxHelpers: e.target.value }))} data-testid="input-parcel-max-helpers" />
            </div>
          </div>
          <div className="d-flex justify-content-end gap-2 pt-2">
            <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={!form.zoneId || saving} onClick={onSave} data-testid="btn-save-parcel-fare">
              {saving ? "Saving..." : editing ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ParcelFaresPage() {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...defaultForm });
  const [search, setSearch] = useState("");

  const { data: fares, isLoading } = useQuery<any[]>({ queryKey: ["/api/parcel-fares"] });
  const { data: zonesData } = useQuery<any[]>({ queryKey: ["/api/zones"] });
  const parcelFares = Array.isArray(fares) ? fares : [];
  const zones = Array.isArray(zonesData) ? zonesData : [];

  const saveMutation = useMutation({
    mutationFn: (d: any) => editing ? apiRequest("PUT", `/api/parcel-fares/${editing.id}`, d) : apiRequest("POST", "/api/parcel-fares", d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parcel-fares"] });
      setShowModal(false);
      toast({ title: editing ? "Parcel fare updated" : "Parcel fare created" });
      setEditing(null);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/parcel-fares/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/parcel-fares"] }); toast({ title: "Deleted" }); },
  });

  const openAdd = () => { setEditing(null); setForm({ ...defaultForm }); setShowModal(true); };
  const openEdit = (f: any) => {
    setEditing(f);
    setForm({
      zoneId: f.zoneId || "",
      baseFare: f.baseFare || "",
      farePerKm: f.farePerKm || "",
      farePerKg: f.farePerKg || "",
      minimumFare: f.minimumFare || "",
      loadingCharge: f.loadingCharge || "",
      helperChargePerHour: f.helperChargePerHour || "",
      maxHelpers: f.maxHelpers != null ? String(f.maxHelpers) : "",
    });
    setShowModal(true);
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return parcelFares;
    const q = search.toLowerCase();
    return parcelFares.filter((f: any) => String(f.zoneName || "").toLowerCase().includes(q));
  }, [parcelFares, search]);

  const f2 = (v: any) => parseFloat(v || 0).toFixed(2);

  return (
    <div className="container-fluid">
      <div className="mb-4">
        <h2 className="fs-22 mb-1 fw-bold">Parcel Delivery Fare Setup</h2>
        <div className="fs-14 text-muted">Zone-wise parcel delivery fares — base, per km, per kg and helper charges</div>
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: 12 }}>
        <div className="card-body">
          <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-4">
            <h5 className="text-primary text-capitalize mb-0">Operation Zone Fare List</h5>
            <div className="d-flex gap-2 align-items-center">
              <div className="input-group search-form__input_group" style={{ maxWidth: 220 }}>
                <span className="search-form__icon"><i className="bi bi-search" /></span>
                <input type="search" className="theme-input-style search-form__input" placeholder="Search zone..." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-parcel-fare-search" />
              </div>
              <button type="button" className="btn btn-primary" onClick={openAdd} data-testid="btn-add-parcel-fare">
                <i className="bi bi-plus-circle me-1" />Add Fare
              </button>
            </div>
          </div>

          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover">
              <thead className="table-light text-capitalize" style={{ fontSize: "0.78rem" }}>
                <tr>
                  <th>SL</th>
                  <th>Zone</th>
                  <th>Base (₹)</th>
                  <th>Per Km (₹)</th>
                  <th>Per Kg (₹)</th>
                  <th>Min (₹)</th>
                  <th>Loading (₹)</th>
                  <th>Helper/hr (₹)</th>
                  <th>Max Helpers</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 10 }).map((__, j) => (
                      <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>
                    ))}</tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-5 text-muted">
                      <i className="bi bi-box fs-2 d-block mb-2 opacity-25" />
                      No parcel delivery fares found. Click &quot;Add Fare&quot; to create one.
                    </td>
                  </tr>
                ) : filtered.map((f: any, idx: number) => (
                  <tr key={f.id} data-testid={`row-parcel-fare-${f.id}`}>
                    <td>{idx + 1}</td>
                    <td className="fw-semibold">{f.zoneName || "—"}</td>
                    <td>₹{f2(f.baseFare)}</td>
                    <td>₹{f2(f.farePerKm)}</td>
                    <td>₹{f2(f.farePerKg)}</td>
                    <td>₹{f2(f.minimumFare)}</td>
                    <td>₹{f2(f.loadingCharge)}</td>
                    <td>₹{f2(f.helperChargePerHour)}</td>
                    <td>{f.maxHelpers ?? 0}</td>
                    <td className="text-center">
                      <div className="d-flex justify-content-center gap-2">
                        <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => openEdit(f)} title="Edit"><i className="bi bi-pencil-fill" /></button>
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={async () => { if (await adminConfirm("Delete this parcel fare?")) deleteMutation.mutate(f.id); }} title="Delete"><i className="bi bi-trash-fill" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ParcelFareModal
        open={showModal}
        onClose={() => setShowModal(false)}
        editing={editing}
        zones={zones}
        form={form}
        setForm={setForm}
        saving={saveMutation.isPending}
        onSave={() => saveMutation.mutate(form)}
      />
    </div>
  );
}
