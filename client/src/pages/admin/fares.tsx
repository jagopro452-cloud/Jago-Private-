import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";

export function FareCalculator({ zones, vehicleCategories }: { zones: any[]; vehicleCategories: any[] }) {
  const [calc, setCalc] = useState({ zoneId: "", vehicleCategoryId: "", distanceKm: "5", durationMin: "10" });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const calculate = async () => {
    if (!calc.zoneId || !calc.vehicleCategoryId) { setError("Select zone and vehicle category"); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await apiRequest("POST", "/api/fare-calculator", { ...calc, distanceKm: Number(calc.distanceKm), durationMin: Number(calc.durationMin) });
      const json = await res.json();
      setResult(json);
    } catch (e: any) { setError(e.message || "Calculation failed"); }
    setLoading(false);
  };

  return (
    <div className="card mt-4" style={{ border: "2px solid #4f46e522" }}>
      <div className="card-header border-bottom py-3" style={{ background: "linear-gradient(135deg,#4f46e508,#818cf808)" }}>
        <h5 className="card-title mb-0 d-flex align-items-center gap-2">
          <i className="bi bi-calculator-fill text-primary"></i>
          Fare Calculator — Test Tool
          <span className="badge bg-primary bg-opacity-10 text-primary ms-1" style={{ fontSize: "0.7rem" }}>Simulator</span>
        </h5>
        <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: 4 }}>Simulate what a customer will be charged for a trip</div>
      </div>
      <div className="card-body">
        <div className="row g-3 align-items-end">
          <div className="col-md-3">
            <label className="form-label-jago">Zone <span className="text-danger">*</span></label>
            <select className="form-select form-select-sm" value={calc.zoneId} onChange={e => setCalc(c => ({ ...c, zoneId: e.target.value }))} data-testid="calc-zone">
              <option value="">Select Zone</option>
              {zones?.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label-jago">Vehicle Category <span className="text-danger">*</span></label>
            <select className="form-select form-select-sm" value={calc.vehicleCategoryId} onChange={e => setCalc(c => ({ ...c, vehicleCategoryId: e.target.value }))} data-testid="calc-vehicle">
              <option value="">Select Vehicle</option>
              {vehicleCategories?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className="col-md-2">
            <label className="form-label-jago">Distance (km)</label>
            <input type="number" className="form-control form-control-sm" value={calc.distanceKm} min="0.1" step="0.1" onChange={e => setCalc(c => ({ ...c, distanceKm: e.target.value }))} data-testid="calc-distance" />
          </div>
          <div className="col-md-2">
            <label className="form-label-jago">Duration (min)</label>
            <input type="number" className="form-control form-control-sm" value={calc.durationMin} min="0" onChange={e => setCalc(c => ({ ...c, durationMin: e.target.value }))} data-testid="calc-duration" />
          </div>
          <div className="col-md-2">
            <button className="btn btn-primary btn-sm w-100" onClick={calculate} disabled={loading} data-testid="btn-calculate">
              <i className="bi bi-calculator me-1"></i>{loading ? "Calculating..." : "Calculate"}
            </button>
          </div>
        </div>

        {error && <div className="alert alert-danger mt-3 py-2 mb-0" style={{ fontSize: "0.8rem" }}>{error}</div>}

        {result && (
          <div className="mt-4 p-3 rounded" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
            <div className="d-flex align-items-center gap-2 mb-3">
              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                <i className="bi bi-geo-alt-fill text-primary me-1"></i>{result.zoneName} —
                <i className="bi bi-truck-front ms-2 me-1 text-success"></i>{result.vehicleName}
              </span>
              <span style={{ fontSize: "0.72rem", color: "#64748b" }}>{calc.distanceKm} km · {calc.durationMin} min</span>
            </div>
            <div className="row g-2">
              {[
                { label: "Base Fare", val: `₹${result.breakdown.baseFare}`, color: "#374151" },
                { label: `Distance (${calc.distanceKm} km × ₹${result.inputs.perKm}/km)`, val: `₹${result.breakdown.distanceFare}`, color: "#374151" },
                { label: `Time (${calc.durationMin} min × ₹${result.inputs.perMin}/min)`, val: `₹${result.breakdown.timeFare}`, color: "#374151" },
                { label: "Minimum Fare", val: `₹${result.breakdown.minimumFare}`, color: "#64748b" },
                { label: "GST (5%)", val: `₹${result.breakdown.gst}`, color: "#d97706" },
              ].map((item, i) => (
                <div key={i} className="col-sm-4 col-md-3">
                  <div style={{ background: "#fff", border: "1px solid #d1fae5", borderRadius: 8, padding: "8px 12px" }}>
                    <div style={{ fontSize: "0.68rem", color: "#64748b" }}>{item.label}</div>
                    <div style={{ fontSize: "1rem", fontWeight: 700, color: item.color }}>{item.val}</div>
                  </div>
                </div>
              ))}
              <div className="col-sm-4 col-md-3">
                <div style={{ background: "#059669", borderRadius: 8, padding: "8px 12px" }}>
                  <div style={{ fontSize: "0.68rem", color: "#d1fae5" }}>CUSTOMER PAYS</div>
                  <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#fff" }}>₹{result.breakdown.total}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const EMPTY_FORM = { zoneId: "", vehicleCategoryId: "", baseFare: "50", farePerKm: "15", farePerMin: "2", minimumFare: "30", cancellationFee: "5", waitingChargePerMin: "1.50", nightChargeMultiplier: "1.25", helperCharge: "0" };

function FareModal({ open, onClose, editing, zones, vehicleCategories, form, setForm, onSave, saving }: any) {
  if (!open) return null;
  return (
    <div className="modal-backdrop-jago">
      <div className="modal-jago" style={{ maxWidth: "620px" }}>
        <div className="modal-jago-header">
          <h5 className="modal-jago-title">{editing ? "Edit Fare" : "Add Fare"}</h5>
          <button className="modal-jago-close" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>
        <div className="d-flex flex-column gap-3">
          <div className="row g-3">
            <div className="col-6">
              <label className="form-label-jago">Zone <span className="text-danger">*</span></label>
              <select className="form-select" value={form.zoneId} onChange={e => setForm((f: any) => ({ ...f, zoneId: e.target.value }))} data-testid="select-zone">
                <option value="">Select Zone</option>
                {zones?.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>
            <div className="col-6">
              <label className="form-label-jago">Vehicle Category</label>
              <select className="form-select" value={form.vehicleCategoryId} onChange={e => setForm((f: any) => ({ ...f, vehicleCategoryId: e.target.value }))} data-testid="select-vehicle-category">
                <option value="">Select Category</option>
                {vehicleCategories?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          </div>
          <div className="row g-3">
            <div className="col-6">
              <label className="form-label-jago">Base Fare (₹) <span className="text-danger">*</span></label>
              <input type="number" className="form-control" value={form.baseFare} min="0" onChange={e => setForm((f: any) => ({ ...f, baseFare: e.target.value }))} data-testid="input-base-fare" />
            </div>
            <div className="col-6">
              <label className="form-label-jago">Per Km Rate (₹)</label>
              <input type="number" className="form-control" value={form.farePerKm} min="0" onChange={e => setForm((f: any) => ({ ...f, farePerKm: e.target.value }))} data-testid="input-per-km" />
            </div>
          </div>
          <div className="row g-3">
            <div className="col-6">
              <label className="form-label-jago">Per Minute Rate (₹)</label>
              <input type="number" className="form-control" value={form.farePerMin} min="0" onChange={e => setForm((f: any) => ({ ...f, farePerMin: e.target.value }))} />
            </div>
            <div className="col-6">
              <label className="form-label-jago">Minimum Fare (₹)</label>
              <input type="number" className="form-control" value={form.minimumFare} min="0" onChange={e => setForm((f: any) => ({ ...f, minimumFare: e.target.value }))} />
            </div>
          </div>
          <div className="row g-3">
            <div className="col-6">
              <label className="form-label-jago">Cancellation Fee (₹)</label>
              <input type="number" className="form-control" value={form.cancellationFee} min="0" onChange={e => setForm((f: any) => ({ ...f, cancellationFee: e.target.value }))} />
            </div>
            <div className="col-6">
              <label className="form-label-jago">Waiting Charge (₹/min) <i className="bi bi-clock-history ms-1" style={{ fontSize: "0.75rem", color: "#d97706" }}></i></label>
              <input type="number" className="form-control" value={form.waitingChargePerMin} min="0" step="0.25" onChange={e => setForm((f: any) => ({ ...f, waitingChargePerMin: e.target.value }))} data-testid="input-waiting-charge" />
              <small className="text-muted">Charged per minute driver waits at pickup</small>
            </div>
          </div>
          <div className="row g-3">
            <div className="col-6">
              <label className="form-label-jago">Night Charge Multiplier <i className="bi bi-moon-fill ms-1" style={{ fontSize: "0.75rem", color: "#7c3aed" }}></i></label>
              <input type="number" className="form-control" value={form.nightChargeMultiplier} min="1" max="3" step="0.05" onChange={e => setForm((f: any) => ({ ...f, nightChargeMultiplier: e.target.value }))} />
              <small className="text-muted">1.25 = 25% extra charge 10PM–6AM</small>
            </div>
            <div className="col-6">
              <label className="form-label-jago">Helper Charge (₹) <i className="bi bi-person-workspace ms-1" style={{ fontSize: "0.75rem", color: "#0891b2" }}></i></label>
              <input type="number" className="form-control" value={form.helperCharge} min="0" step="0.5" onChange={e => setForm((f: any) => ({ ...f, helperCharge: e.target.value }))} data-testid="input-helper-charge" />
              <small className="text-muted">Flat helper/labour charge per trip</small>
            </div>
          </div>

          <div className="mt-2 p-3 rounded" style={{ background: "#eff6ff", border: "1px solid #bfdbfe" }}>
            <div className="d-flex align-items-center gap-2">
              <i className="bi bi-info-circle text-primary"></i>
              <span style={{ fontSize: "0.82rem", color: "#1e40af" }}>
                Pool / carpool per-seat pricing is configured in <strong>Local Pool</strong> settings, not here.
              </span>
            </div>
          </div>

          <div className="d-flex gap-2 justify-content-end mt-2">
            <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={onSave} disabled={!form.zoneId || saving} data-testid="btn-save-fare">
              {saving ? "Saving..." : editing ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Fares() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [savedId, setSavedId] = useState<string | null>(null);

  const { data: fares, isLoading } = useQuery<any[]>({ queryKey: ["/api/fares"] });
  const { data: zones } = useQuery<any[]>({ queryKey: ["/api/zones"] });
  const { data: vehicleCategories } = useQuery<any[]>({ queryKey: ["/api/vehicle-categories"] });

  const save = useMutation({
    mutationFn: (d: any) => editing
      ? apiRequest("PUT", `/api/fares/${editing.fare.id}`, d)
      : apiRequest("POST", "/api/fares", d),
    onSuccess: async (res) => {
      const savedFareId = editing?.fare?.id ?? null;
      await qc.invalidateQueries({ queryKey: ["/api/fares"] });
      toast({ title: editing ? "Fare updated" : "Fare created" });
      setOpen(false); setEditing(null); setForm({ ...EMPTY_FORM });
      if (savedFareId) {
        setSavedId(savedFareId);
        setTimeout(() => setSavedId(null), 3000);
        setTimeout(() => {
          const el = document.querySelector(`[data-testid="fare-row-${savedFareId}"]`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 150);
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/fares/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/fares"] }); toast({ title: "Fare deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message || "This fare may be referenced by active trips.", variant: "destructive" }),
  });

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_FORM }); setOpen(true); };
  const openEdit = (item: any) => {
    setEditing(item);
    setForm({
      zoneId: String(item.fare.zoneId || ""),
      vehicleCategoryId: String(item.fare.vehicleCategoryId || ""),
      baseFare: String(item.fare.baseFare || "50"),
      farePerKm: String(item.fare.farePerKm || "15"),
      farePerMin: String(item.fare.farePerMin || "2"),
      minimumFare: String(item.fare.minimumFare || "30"),
      cancellationFee: String(item.fare.cancellationFee || "5"),
      waitingChargePerMin: String(item.fare.waitingChargePerMin || "1.50"),
      nightChargeMultiplier: String(item.fare.nightChargeMultiplier || "1.25"),
      helperCharge: String(item.fare.helperCharge || "0"),
    });
    setOpen(true);
  };

  const filtered = fares?.filter((item: any) => {
    if (!search) return true;
    const zone = item.zone?.name || "";
    const cat = item.vehicleCategory?.name || "";
    return zone.toLowerCase().includes(search.toLowerCase()) || cat.toLowerCase().includes(search.toLowerCase());
  }) || [];

  return (
    <div className="container-fluid">
      <div className="mb-4">
        <h2 className="fs-22 mb-2 text-capitalize" data-testid="page-title">Trip Fare Setup</h2>
        <div className="fs-14 text-muted">Manage your ride sharing fares zone wise</div>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="d-flex flex-wrap gap-10 justify-content-between align-items-center mb-4">
            <h5 className="text-primary text-capitalize mb-0">Operation Zone Fare List</h5>
            <div className="d-flex gap-2 align-items-center">
              <div className="input-group search-form__input_group" style={{ maxWidth: "220px" }}>
                <span className="search-form__icon"><i className="bi bi-search"></i></span>
                <input type="search" className="theme-input-style search-form__input" placeholder="Search zone or category..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search" />
              </div>
              <button className="btn btn-primary" onClick={openCreate} data-testid="btn-add-fare">
                <i className="bi bi-plus-circle me-1"></i> Add Fare
              </button>
            </div>
          </div>

          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover">
              <thead className="table-light align-middle text-capitalize" style={{ fontSize: "0.78rem" }}>
                <tr>
                  <th>SL</th>
                  <th>Zone</th>
                  <th>Vehicle</th>
                  <th>Base Fare</th>
                  <th>Per Km</th>
                  <th>Per Min</th>
                  <th>Waiting/min</th>
                  <th>Night ×</th>
                  <th>Min Fare</th>
                  <th>Cancel Fee</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <tr key={i}>{Array(9).fill(0).map((_, j) => <td key={j}><div style={{ height: "14px", background: "#f1f5f9", borderRadius: "4px" }} /></td>)}</tr>
                  ))
                ) : filtered.length ? (
                  filtered.map((item: any, idx: number) => (
                    <tr
                      key={item.fare.id}
                      data-testid={`fare-row-${item.fare.id}`}
                      style={savedId === item.fare.id ? {
                        background: "linear-gradient(90deg, #dcfce7, #f0fdf4)",
                        transition: "background 0.4s ease",
                        outline: "2px solid #22c55e",
                        outlineOffset: "-2px"
                      } : { transition: "background 0.6s ease" }}
                    >
                      <td>{idx + 1}</td>
                      <td>
                        <div className="media align-items-center gap-2">
                          <span className="circle-24 title-color-bg" style={{ width: "24px", height: "24px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 700, background: "#1E5FCC", color: "#fff" }}>{idx + 1}</span>
                          <div className="media-body fw-medium">{item.zone?.name || "—"}</div>
                        </div>
                      </td>
                      <td>{item.vehicleCategory?.name || "—"}</td>
                      <td className="fw-semibold">₹{Number(item.fare.baseFare || 0).toFixed(2)}</td>
                      <td>₹{Number(item.fare.farePerKm || 0).toFixed(2)}</td>
                      <td>₹{Number(item.fare.farePerMin || 0).toFixed(2)}</td>
                      <td style={{ color: "#d97706" }}>₹{Number(item.fare.waitingChargePerMin || 0).toFixed(2)}</td>
                      <td style={{ color: "#7c3aed" }}>{Number(item.fare.nightChargeMultiplier || 1).toFixed(2)}×</td>
                      <td>₹{Number(item.fare.minimumFare || 0).toFixed(2)}</td>
                      <td>₹{Number(item.fare.cancellationFee || 0).toFixed(2)}</td>
                      <td className="text-center">
                        <div className="d-flex justify-content-center gap-2">
                          <button className="btn btn-sm btn-outline-primary" onClick={() => openEdit(item)} data-testid={`btn-edit-fare-${item.fare.id}`}><i className="bi bi-pencil-fill"></i></button>
                          <button className="btn btn-sm btn-outline-danger" onClick={async () => { if (await adminConfirm("Delete this fare?")) remove.mutate(item.fare.id); }} data-testid={`btn-delete-fare-${item.fare.id}`}><i className="bi bi-trash-fill"></i></button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={11}>
                    <div className="d-flex flex-column justify-content-center align-items-center gap-2 py-4">
                      <i className="bi bi-cash-stack" style={{ fontSize: "2rem", color: "#94a3b8" }}></i>
                      <p className="text-muted mb-0">No fare configurations found. Click "Add Fare" to create one.</p>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <FareCalculator zones={zones || []} vehicleCategories={vehicleCategories || []} />

      <FareModal
        open={open}
        onClose={() => setOpen(false)}
        editing={editing}
        zones={zones}
        vehicleCategories={vehicleCategories}
        form={form}
        setForm={setForm}
        onSave={() => save.mutate(form)}
        saving={save.isPending}
      />
    </div>
  );
}
